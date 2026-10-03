import { randomUUID } from "node:crypto";
import { assessRequestRisk, assertRiskConfiguration, executionPlanFits, ExecutionPlanLimitsError, findCriticalMissingContext, MissingContextError, plannedProviderCalls, RiskConfigurationError } from "@deliberation-ai/domain";
import {
  councilMembersSchema,
  createScheduleSchema,
  executionLimitsSchema,
  reviewRoundCountSchema,
  type CouncilMemberConfig,
  type ExecutionLimits,
  type CreateScheduleRequest,
  type ScheduleCadence,
  type RiskProfile,
  type UpdateScheduleRequest,
  type ReviewRoundCount,
} from "@deliberation-ai/contracts";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { decryptJson, decryptText, encryptJson, encryptText } from "./crypto";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { enqueueDurableRun } from "./run-repository";
import { localSchedules } from "./schema";
import { lockConversationMembership } from "./conversation-membership";
import { IdempotencyConflictError } from "@deliberation-ai/application";
import { scheduleSnapshotHash, scheduleOccurrenceKey, ScheduleOccurrenceUnavailableError } from "./schedule-occurrences";

export type LocalSchedule = {
  id: string;
  name: string;
  question: string;
  members: CouncilMemberConfig[];
  providerMode: "fake" | "remote";
  riskProfile: RiskProfile;
  reviewRounds: ReviewRoundCount;
  selfRevisionEnabled: boolean;
  executionLimits: ExecutionLimits | null;
  cadence: ScheduleCadence;
  status: "active" | "paused";
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunId: string | null;
  createdAt: string;
};

function mapSchedule(row: typeof localSchedules.$inferSelect): LocalSchedule {
  return {
    id: row.id,
    name: decryptText(row.nameCiphertext, `local-schedule:${row.id}:name`),
    question: decryptText(row.questionCiphertext, `local-schedule:${row.id}:question`),
    members: councilMembersSchema.parse(decryptJson(row.membersCiphertext, `local-schedule:${row.id}:members`)),
    providerMode: row.providerMode === "remote" ? "remote" : "fake",
    riskProfile: row.riskProfile === "high" ? "high" : "standard",
    reviewRounds: reviewRoundCountSchema.parse(row.reviewRounds),
    selfRevisionEnabled: row.selfRevisionEnabled,
    executionLimits: row.executionLimitsCiphertext
      ? executionLimitsSchema.parse(decryptJson(row.executionLimitsCiphertext, `local-schedule:${row.id}:execution-limits`))
      : null,
    cadence: row.cadence === "weekly" ? "weekly" : "daily",
    status: row.status === "active" ? "active" : "paused",
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunId: row.lastRunId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listLocalSchedules(): Promise<LocalSchedule[]> {
  const rows = await getDatabase().select().from(localSchedules)
    .where(and(eq(localSchedules.ownerId, LOCAL_OWNER_ID), isNull(localSchedules.deletedAt))).orderBy(asc(localSchedules.createdAt));
  return rows.map(mapSchedule);
}

export async function createLocalSchedule(request: CreateScheduleRequest): Promise<LocalSchedule> {
  const missing = findCriticalMissingContext(request.question);
  if (missing.length > 0) throw new MissingContextError(missing);
  const risk = assessRequestRisk({ question: request.question, requestedProfile: request.riskProfile });
  assertRiskConfiguration(risk, request.members, request.reviewRounds);
  if (request.executionLimits && !executionPlanFits(request.executionLimits, plannedProviderCalls(request.members.length, request.reviewRounds))) {
    throw new ExecutionPlanLimitsError();
  }
  const normalized = createScheduleSchema.parse(request);
  const creationRequestId = normalized.requestId ?? randomUUID();
  const creationRequestHash = scheduleSnapshotHash({ ...normalized, requestId: creationRequestId });
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const [existing] = await tx.select().from(localSchedules).where(and(eq(localSchedules.ownerId, LOCAL_OWNER_ID), eq(localSchedules.creationRequestId, creationRequestId))).limit(1);
    if (existing) {
      if (existing.deletedAt || existing.creationRequestHash !== creationRequestHash) throw new IdempotencyConflictError();
      return mapSchedule(existing);
    }
    const id = randomUUID();
    const [row] = await tx.insert(localSchedules).values({
      creationRequestId, creationRequestHash,
      id,
      ownerId: LOCAL_OWNER_ID,
      nameCiphertext: encryptText(request.name, `local-schedule:${id}:name`),
      questionCiphertext: encryptText(request.question, `local-schedule:${id}:question`),
      membersCiphertext: encryptJson(request.members, `local-schedule:${id}:members`),
      providerMode: request.providerMode,
      riskProfile: risk.effectiveProfile,
      reviewRounds: request.reviewRounds,
      selfRevisionEnabled: request.selfRevisionEnabled === true,
      executionLimitsCiphertext: request.executionLimits
        ? encryptJson(executionLimitsSchema.parse(request.executionLimits), `local-schedule:${id}:execution-limits`)
        : null,
      cadence: request.cadence,
      status: "paused",
      nextRunAt: new Date(request.nextRunAt),
    }).returning();
    if (!row) throw new Error("Local schedule could not be created.");
    return mapSchedule(row);
  });
}

export async function updateLocalSchedule(id: string, update: UpdateScheduleRequest): Promise<LocalSchedule | undefined> {
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const [existing] = await tx.select().from(localSchedules)
      .where(and(eq(localSchedules.id, id), eq(localSchedules.ownerId, LOCAL_OWNER_ID), isNull(localSchedules.deletedAt))).for("update").limit(1);
    if (!existing) return undefined;
    if (update.status === "active") {
      const schedule = mapSchedule(existing);
      const missing = findCriticalMissingContext(schedule.question);
      if (missing.length > 0) throw new MissingContextError(missing);
      assertRiskConfiguration(assessRequestRisk({ question: schedule.question, requestedProfile: schedule.riskProfile }), schedule.members, schedule.reviewRounds);
      if (schedule.executionLimits && !executionPlanFits(schedule.executionLimits, plannedProviderCalls(schedule.members.length, schedule.reviewRounds))) {
        throw new ExecutionPlanLimitsError();
      }
    }
    const [row] = await tx.update(localSchedules).set({ status: update.status, updatedAt: new Date() })
      .where(and(eq(localSchedules.id, id), eq(localSchedules.ownerId, LOCAL_OWNER_ID))).returning();
    return row ? mapSchedule(row) : undefined;
  });
}

export async function dispatchDueLocalSchedules(now = new Date()): Promise<{ dispatched: number; failed: number }> {
  const db = getDatabase();
  const due = await db.select({ row: localSchedules, exact: sql<unknown>`to_jsonb(${localSchedules})`,
    occurrenceAt: sql<string>`to_char(${localSchedules.nextRunAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` }).from(localSchedules).where(and(
    isNull(localSchedules.deletedAt),
    eq(localSchedules.ownerId, LOCAL_OWNER_ID),
    eq(localSchedules.status, "active"),
    lte(localSchedules.nextRunAt, now),
  )).orderBy(asc(localSchedules.nextRunAt));
  let dispatched = 0;
  let failed = 0;
  for (const candidate of due) {
    const fence = { id: candidate.row.id, fingerprint: scheduleSnapshotHash(candidate.exact), occurrenceAt: candidate.occurrenceAt, now };
    try {
      const schedule = mapSchedule(candidate.row);
      if (schedule.executionLimits && !executionPlanFits(schedule.executionLimits, plannedProviderCalls(schedule.members.length, schedule.reviewRounds))) {
        throw new ExecutionPlanLimitsError();
      }
      await enqueueDurableRun({
        question: schedule.question,
        idempotencyKey: scheduleOccurrenceKey(schedule.id, candidate.occurrenceAt),
        scenario: "success",
        providerMode: schedule.providerMode,
        riskProfile: schedule.riskProfile,
        reviewRounds: schedule.reviewRounds,
        selfRevisionEnabled: schedule.selfRevisionEnabled,
        ...(schedule.executionLimits ? { executionLimits: schedule.executionLimits } : {}),
        memoryEntryIds: [],
        members: schedule.members,
      }, fence);
      dispatched += 1;
    } catch (error) {
      if (error instanceof ScheduleOccurrenceUnavailableError) continue;
      if (error instanceof RiskConfigurationError || error instanceof MissingContextError || error instanceof ExecutionPlanLimitsError) {
        await db.transaction(async (tx) => {
          await lockConversationMembership(tx);
          const [current] = await tx.select({ exact: sql<unknown>`to_jsonb(${localSchedules})` }).from(localSchedules)
            .where(and(eq(localSchedules.id, fence.id), eq(localSchedules.ownerId, LOCAL_OWNER_ID), isNull(localSchedules.deletedAt))).for("update").limit(1);
          if (current && scheduleSnapshotHash(current.exact) === fence.fingerprint) await tx.update(localSchedules)
            .set({ status: "paused", updatedAt: now }).where(and(eq(localSchedules.id, fence.id), eq(localSchedules.ownerId, LOCAL_OWNER_ID)));
        });
      }
      failed += 1;
    }
  }
  return { dispatched, failed };
}
