import { randomUUID } from "node:crypto";
import { assessRequestRisk, assertRiskConfiguration, executionPlanFits, ExecutionPlanLimitsError, findCriticalMissingContext, MissingContextError, plannedProviderCalls, RiskConfigurationError } from "@deliberation-ai/domain";
import {
  councilMembersSchema,
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
import { and, asc, eq, lte } from "drizzle-orm";
import { decryptJson, decryptText, encryptJson, encryptText } from "./crypto";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { enqueueDurableRun } from "./run-repository";
import { localSchedules } from "./schema";

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
    .where(eq(localSchedules.ownerId, LOCAL_OWNER_ID)).orderBy(asc(localSchedules.createdAt));
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
  const id = randomUUID();
  const [row] = await getDatabase().insert(localSchedules).values({
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
}

export async function updateLocalSchedule(id: string, update: UpdateScheduleRequest): Promise<LocalSchedule | undefined> {
  if (update.status === "active") {
    const [existing] = await getDatabase().select().from(localSchedules)
      .where(and(eq(localSchedules.id, id), eq(localSchedules.ownerId, LOCAL_OWNER_ID))).limit(1);
    if (!existing) return undefined;
    const schedule = mapSchedule(existing);
    const missing = findCriticalMissingContext(schedule.question);
    if (missing.length > 0) throw new MissingContextError(missing);
    assertRiskConfiguration(assessRequestRisk({ question: schedule.question, requestedProfile: schedule.riskProfile }), schedule.members, schedule.reviewRounds);
    if (schedule.executionLimits && !executionPlanFits(schedule.executionLimits, plannedProviderCalls(schedule.members.length, schedule.reviewRounds))) {
      throw new ExecutionPlanLimitsError();
    }
  }
  const [row] = await getDatabase().update(localSchedules).set({ status: update.status, updatedAt: new Date() })
    .where(and(eq(localSchedules.id, id), eq(localSchedules.ownerId, LOCAL_OWNER_ID))).returning();
  return row ? mapSchedule(row) : undefined;
}

export async function deleteLocalSchedule(id: string): Promise<boolean> {
  const deleted = await getDatabase().delete(localSchedules)
    .where(and(eq(localSchedules.id, id), eq(localSchedules.ownerId, LOCAL_OWNER_ID)))
    .returning({ id: localSchedules.id });
  return deleted.length > 0;
}

function nextOccurrence(current: Date, cadence: ScheduleCadence): Date {
  return new Date(current.getTime() + (cadence === "weekly" ? 7 : 1) * 24 * 60 * 60 * 1_000);
}

export async function dispatchDueLocalSchedules(now = new Date()): Promise<{ dispatched: number; failed: number }> {
  const db = getDatabase();
  const due = await db.select().from(localSchedules).where(and(
    eq(localSchedules.ownerId, LOCAL_OWNER_ID),
    eq(localSchedules.status, "active"),
    lte(localSchedules.nextRunAt, now),
  )).orderBy(asc(localSchedules.nextRunAt));
  let dispatched = 0;
  let failed = 0;
  for (const row of due) {
    const schedule = mapSchedule(row);
    try {
      if (schedule.executionLimits && !executionPlanFits(schedule.executionLimits, plannedProviderCalls(schedule.members.length, schedule.reviewRounds))) {
        throw new ExecutionPlanLimitsError();
      }
      const run = await enqueueDurableRun({
        question: schedule.question,
        idempotencyKey: `schedule:${schedule.id}:${schedule.nextRunAt}`,
        scenario: "success",
        providerMode: schedule.providerMode,
        riskProfile: schedule.riskProfile,
        reviewRounds: schedule.reviewRounds,
        selfRevisionEnabled: schedule.selfRevisionEnabled,
        ...(schedule.executionLimits ? { executionLimits: schedule.executionLimits } : {}),
        memoryEntryIds: [],
        members: schedule.members,
      });
      await db.update(localSchedules).set({
        lastRunAt: new Date(schedule.nextRunAt),
        lastRunId: run.runId,
        nextRunAt: nextOccurrence(new Date(schedule.nextRunAt), schedule.cadence),
        updatedAt: now,
      }).where(and(
        eq(localSchedules.id, schedule.id),
        eq(localSchedules.ownerId, LOCAL_OWNER_ID),
        eq(localSchedules.nextRunAt, new Date(schedule.nextRunAt)),
      ));
      dispatched += 1;
    } catch (error) {
      if (error instanceof RiskConfigurationError || error instanceof MissingContextError || error instanceof ExecutionPlanLimitsError) {
        await db.update(localSchedules).set({ status: "paused", updatedAt: now }).where(and(
          eq(localSchedules.id, schedule.id), eq(localSchedules.ownerId, LOCAL_OWNER_ID),
          eq(localSchedules.nextRunAt, new Date(schedule.nextRunAt)),
        ));
      }
      failed += 1;
    }
  }
  return { dispatched, failed };
}
