import { createHash, randomUUID } from "node:crypto";
import {
  executeFakeCouncil,
  freezeContinuation,
  validateContinuation,
  prepareContinuationCompaction,
  buildCompactedContinuation,
  validateContinuationArchive,
  hashRunRequest,
  buildRoundZeroPromptPlan,
  buildRiskPreflight,
  IdempotencyConflictError,
  resolveRunMembers,
  type RunRecord,
} from "@deliberation-ai/application";
import {
  councilMembersSchema,
  createRunRequestSchema,
  providerOutputSchema,
  providerCitationSchema,
  riskAssessmentSchema,
  reviewRoundCountSchema,
  executionLimitsSchema,
  defaultFakeCouncilMembers,
  type CouncilMemberConfig,
  type CreateRunRequest,
  type FrozenContinuation,
  type ManualContinuationCompaction,
  type ContinuationArchive,
  type EvidenceState,
  type FrozenMemoryEntry,
  type RunAttachment,
  type FrozenToolContext,
  type SynthesisCoverage,
  type SaveClaimRelationRequest,
  type RiskProfile,
  type RiskAssessment,
  type ReviewRoundCount,
  type PreflightDecision,
  type ExecutionLimits,
} from "@deliberation-ai/contracts";
import {
  reconcileCouncilAgreement,
  buildCouncilReport,
  applyRiskControls,
  assertRiskConfiguration,
  auditPromptRevision,
  composeClarifiedQuestion,
  findCriticalMissingContext,
  MissingContextError,
  PREFLIGHT_CONTEXT_POLICY_VERSION,
  PROMPT_REVISION_VERSION,
  preflightQuestionsSchema,
  removeCouncilClaimRelation,
  updateCouncilClaimScope,
  updateCouncilReportEvidenceState,
  updateCouncilReportSynthesisCoverage,
  upsertCouncilClaimRelation,
  plannedProviderCalls,
  executionPlanFits,
  ExecutionPlanLimitsError,
  type CouncilReport,
  type CouncilMemberResult,
} from "@deliberation-ai/domain";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { fromDrizzle } from "pg-boss";
import { Client } from "pg";
import { getDatabase } from "./database";
import { decryptJson, decryptText, encryptJson, encryptText } from "./crypto";
import { getBoss, RUN_COUNCIL_QUEUE } from "./queue";
import { validateRunAttachments } from "./run-attachments";
import { LOCAL_OWNER_ID } from "./owner";
import { isRunIntentDeleted } from "./run-deletion";
import { attachRunToConversation, lockConversationMembership } from "./conversation-membership";
import { loadFrozenMemoryEntries } from "./memory-entries";
import { loadFrozenToolContexts, loadRelevantToolContexts } from "./mcp-connections";
import { claimOccurrences, claims, evidenceSources, modelRuns, preflightDrafts, providerConnections, providerOperations, runEvents, runs } from "./schema";
import * as schema from "./schema";

export { LOCAL_OWNER_ID } from "./owner";

export type DurableRunWork = {
  runId: string;
  question: string;
  snapshotId: string;
  scenario: "success" | "member-b-fails";
  providerMode: "fake" | "remote";
  riskProfile: RiskProfile;
  riskAssessment?: RiskAssessment | null;
  promptVersion: string;
  promptFingerprint: string | null;
  reviewRounds: ReviewRoundCount;
  selfRevisionEnabled: boolean;
  executionLimits?: ExecutionLimits | null;
  members: CouncilMemberConfig[];
  memoryContext: FrozenMemoryEntry[];
  attachments: RunAttachment[];
  toolContext: FrozenToolContext[];
  continuationContext?: FrozenContinuation | null | undefined;
  reusedInitialResults: CouncilMemberResult[];
  followUp: Pick<FollowUpSnapshot, "version" | "sourceRunId" | "rerunMemberId" | "reusedMemberIds"> | null;
};

type FollowUpSnapshot = {
  version: "member-rerun-v1";
  sourceRunId: string;
  rerunMemberId: string;
  reusedMemberIds: string[];
  maximumProviderCalls: number;
  reusedInitialResults: CouncilMemberResult[];
};

export class FollowUpUnavailableError extends Error {
  constructor(message = "Bu çalışma için seçili üye tekrar çalıştırılamıyor.") {
    super(message);
    this.name = "FollowUpUnavailableError";
  }
}

export type DurableCouncilExecutor = (work: DurableRunWork) => Promise<CouncilReport>;

export type DurableRunEvent = {
  sequence: number;
  type: string;
  payload: unknown;
  createdAt: string;
};

export type RunHistoryItem = {
  runId: string;
  question: string;
  status: RunRecord["status"];
  riskProfile: RiskProfile;
  memberCount: number;
  attachmentCount: number;
  createdAt: string;
  hasReport: boolean;
};

export type RunHistoryPage = {
  runs: RunHistoryItem[];
  nextCursor: string | null;
};

export const RUN_HISTORY_PAGE_SIZE = 20;

type RunRow = typeof runs.$inferSelect;

export class PreflightMismatchError extends Error {
  constructor() {
    super("Önizleme değişti; güncel istemi inceleyip yeniden gönderin.");
    this.name = "PreflightMismatchError";
  }
}

function promptPlanForRun(input: {
  question: string;
  continuationContext?: FrozenContinuation | null | undefined;
  members: CouncilMemberConfig[];
  memoryContext: FrozenMemoryEntry[];
  toolContext: FrozenToolContext[];
  attachments: RunAttachment[];
}) {
  return buildRoundZeroPromptPlan({
    question: input.question,
    continuationContext: input.continuationContext,
    members: input.members,
    memoryContext: input.memoryContext,
    toolContext: input.toolContext,
    documents: input.attachments.filter((attachment) => attachment.mimeType === "application/pdf")
      .map((attachment) => ({ name: attachment.name, sha256: attachment.sha256, content: attachment.extractedText })),
    images: input.attachments.filter((attachment) => attachment.mimeType !== "application/pdf")
      .map((attachment) => ({ mimeType: attachment.mimeType, sha256: attachment.sha256 })),
  });
}

function isCouncilReport(value: unknown): value is CouncilReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.status === "string" &&
    Array.isArray(candidate.sharedClaims) &&
    Array.isArray(candidate.distinctClaims) &&
    Array.isArray(candidate.memberResults) &&
    Array.isArray(candidate.failures)
  );
}

function reportMembers(row: RunRow): CouncilMemberConfig[] {
  return row.membersCiphertext
    ? councilMembersSchema.parse(decryptJson<unknown>(row.membersCiphertext, `run:${row.id}:members`))
    : defaultFakeCouncilMembers;
}

function hydrateCouncilReport(value: unknown, members: CouncilMemberConfig[]): CouncilReport | null {
  if (!isCouncilReport(value)) return null;
  const hydrateClaims = (
    groups: CouncilReport["sharedClaims"],
    defaultCoverage: SynthesisCoverage,
  ): CouncilReport["sharedClaims"] =>
    groups.map((claim) => ({
      ...claim,
      evidenceState: claim.evidenceState ?? "unsupported",
      synthesisCoverage: claim.synthesisCoverage ?? defaultCoverage,
    }));
  return reconcileCouncilAgreement({
    ...value,
    claimRelations: Array.isArray(value.claimRelations) ? value.claimRelations : [],
    sharedClaims: hydrateClaims(value.sharedClaims, "included"),
    distinctClaims: hydrateClaims(value.distinctClaims, "unresolved"),
    memberResults: value.memberResults.map((member) => ({
      ...member,
      councilRole: member.councilRole === "red-team" ? "red-team" as const : "analyst" as const,
      citations: Array.isArray(member.citations) ? member.citations : [],
    })),
    redTeamChallenges: hydrateClaims(
      Array.isArray(value.redTeamChallenges) ? value.redTeamChallenges : [],
      "unresolved",
    ),
    reviews: Array.isArray(value.reviews)
      ? value.reviews.map((review) => ({
          ...review,
          round: review.round === 2 || review.round === 3 ? review.round : 1 as const,
          reviewerCouncilRole:
            review.reviewerCouncilRole === "red-team"
              ? "red-team" as const
              : "analyst" as const,
          citations: Array.isArray(review.citations) ? review.citations : [],
        }))
      : [],
    reviewFailures: Array.isArray(value.reviewFailures) ? value.reviewFailures : [],
    reviewPromptPlans: Array.isArray(value.reviewPromptPlans)
      ? value.reviewPromptPlans.map((plan) => ({
          ...plan,
          round: plan.round === 2 || plan.round === 3 ? plan.round : 1 as const,
        }))
      : [],
  }, members);
}

export function mapStoredRun(row: RunRow): RunRecord {
  const question = row.questionCiphertext
    ? decryptText(row.questionCiphertext, `run:${row.id}:question`)
    : row.question;
  const storedReport = row.reportCiphertext
    ? decryptJson<CouncilReport>(row.reportCiphertext, `run:${row.id}:report`)
    : row.report;
  const report = hydrateCouncilReport(storedReport, reportMembers(row));
  const followUp = row.followUpCiphertext
    ? decryptJson<FollowUpSnapshot>(row.followUpCiphertext, `run:${row.id}:follow-up`)
    : null;
  return {
    runId: row.id,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    question,
    promptVersion: row.promptVersion,
    promptFingerprint: row.promptFingerprint,
    providerMode: row.providerMode === "fake" ? "fake" : "remote",
    reviewRounds: reviewRoundCountSchema.parse(row.reviewRounds),
    executionLimits: row.executionLimitsCiphertext
      ? executionLimitsSchema.parse(decryptJson(row.executionLimitsCiphertext, `run:${row.id}:execution-limits`)) : null,
    riskProfile: row.riskProfile === "high" ? "high" : "standard",
    riskAssessment: row.riskAssessmentCiphertext
      ? riskAssessmentSchema.parse(decryptJson(row.riskAssessmentCiphertext, `run:${row.id}:risk-assessment`))
      : null,
    preflightDecision: row.preflightDecisionCiphertext
      ? decryptJson<NonNullable<RunRecord["preflightDecision"]>>(row.preflightDecisionCiphertext, `run:${row.id}:preflight-decision`)
      : null,
    promptRevision: row.promptRevisionCiphertext
      ? decryptJson<NonNullable<RunRecord["promptRevision"]>>(row.promptRevisionCiphertext, `run:${row.id}:prompt-revision`)
      : null,
    snapshotId: row.snapshotId,
    memberCount: row.memberCount,
    memoryEntryCount: row.memoryEntryCount,
    attachmentCount: row.attachmentCount,
    toolResultCount: row.toolResultCount,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    report,
    continuationContext: readContinuation(row),
    continuationArchive: readContinuationArchive(row),
    followUp: followUp ? {
      version: followUp.version,
      sourceRunId: followUp.sourceRunId,
      rerunMemberId: followUp.rerunMemberId,
      reusedMemberIds: followUp.reusedMemberIds,
      maximumProviderCalls: followUp.maximumProviderCalls,
    } : null,
  };
}

const mapRun = mapStoredRun;

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readContinuation(row: RunRow): FrozenContinuation | null {
  return row.continuationContextCiphertext
    ? validateContinuation(decryptJson(row.continuationContextCiphertext, `run:${row.id}:continuation-context`)) : null;
}

function readContinuationArchive(row: RunRow): ContinuationArchive | null {
  return row.continuationArchiveCiphertext
    ? validateContinuationArchive(decryptJson(row.continuationArchiveCiphertext, `run:${row.id}:continuation-archive`), readContinuation(row)) : null;
}

export class ContinuationUnavailableError extends Error {
  constructor(message = "Devam için kaynak çalışma kullanılamıyor; tamamlanmış raporu yeniden seçin.") {
    super(message);
    this.name = "ContinuationUnavailableError";
  }
}

function continuationMaterialFromRow(row: RunRow, includeArchive = false) {
  const source = mapRun(row);
  if (!["completed", "partially_completed"].includes(source.status) || !source.report || source.report.memberResults.length === 0) {
    throw new ContinuationUnavailableError();
  }
  return { sourceRunId: source.runId, sourceRiskProfile: source.riskProfile, content: JSON.stringify({
      sourceRunId: source.runId, question: source.question, status: source.status,
      promptVersion: source.promptVersion, promptFingerprint: source.promptFingerprint,
      report: source.report, continuationContext: source.continuationContext ?? null,
      ...(includeArchive && source.continuationArchive ? { earlierCompactionArchive: source.continuationArchive } : {}),
      scope: "Source question, complete report and earlier frozen continuation only. Prior attachments, memory and tool inputs are not replayed.",
    }) };
}

function continuationSelectionFromRow(row: RunRow, compaction?: ManualContinuationCompaction) {
  const material = continuationMaterialFromRow(row, Boolean(compaction));
  try {
    if (compaction) {
      const packet = prepareContinuationCompaction(material);
      return { ...buildCompactedContinuation(packet, compaction), sourceSha256: packet.sourceSha256 };
    }
    const context = freezeContinuation(material);
    return { context, archive: readContinuationArchive(row), sourceSha256: context.sha256 };
  } catch {
    throw new ContinuationUnavailableError(compaction
      ? "Özgün geçmiş doğrulanamadı veya 2 MiB arşiv sınırını aşıyor; kısaltma hazırlanamadı."
      : "Geçmiş bağlam doğrulanamadı veya 256 KiB sınırını aşıyor; otomatik kısaltma yapılmadı.");
  }
}

async function ownedContinuationSourceRow(sourceRunId: string) {
  const [row] = await getDatabase().select().from(runs)
    .where(and(eq(runs.id, sourceRunId), eq(runs.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!row) throw new ContinuationUnavailableError();
  return row;
}

export async function loadRunContinuationCompaction(sourceRunId: string) {
  const material = continuationMaterialFromRow(await ownedContinuationSourceRow(sourceRunId), true);
  try { return prepareContinuationCompaction(material); }
  catch { throw new ContinuationUnavailableError("Özgün geçmiş doğrulanamadı veya 2 MiB arşiv sınırını aşıyor; kısaltma hazırlanamadı."); }
}

async function loadContinuationSelection(sourceRunId: string, expectedSha256?: string, compaction?: ManualContinuationCompaction) {
  const selected = continuationSelectionFromRow(await ownedContinuationSourceRow(sourceRunId), compaction);
  if (expectedSha256 && expectedSha256 !== selected.sourceSha256) throw new PreflightMismatchError();
  return selected;
}

export async function loadRunContinuation(sourceRunId: string, expectedSha256?: string, compaction?: ManualContinuationCompaction): Promise<FrozenContinuation> {
  return (await loadContinuationSelection(sourceRunId, expectedSha256, compaction)).context;
}

export async function enqueueDurableRun(request: CreateRunRequest): Promise<RunRecord> {
  const db = getDatabase();
  const requestHash = hashRunRequest(request);
  const [previous] = await db.select().from(runs)
    .where(and(eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.idempotencyKey, request.idempotencyKey)))
    .limit(1);
  if (previous) {
    if (previous.requestHash !== requestHash) throw new IdempotencyConflictError();
    return mapRun(previous);
  }
  const revision = request.promptRevision ?? { version: PROMPT_REVISION_VERSION,
    originalQuestion: request.question, candidateQuestion: request.question, choice: "original" as const };
  const revisionAudit = auditPromptRevision(revision);
  if (revisionAudit.selectedQuestion !== request.question ||
      (revision.choice === "candidate" && !revisionAudit.canSelectCandidate)) throw new PreflightMismatchError();
  const members = resolveRunMembers(request);
  const executionLimits = request.executionLimits ? executionLimitsSchema.parse(request.executionLimits) : null;
  if (executionLimits && !executionPlanFits(executionLimits, plannedProviderCalls(members.length, request.reviewRounds))) {
    throw new ExecutionPlanLimitsError();
  }
  const memoryContext = await loadFrozenMemoryEntries(request.memoryEntryIds);
  const continuationSelection = request.continuationSource
    ? await loadContinuationSelection(request.continuationSource.runId, request.continuationSource.expectedSha256, request.continuationSource.compaction) : null;
  const continuationContext = continuationSelection?.context ?? null;
  const continuationArchive = continuationSelection?.archive ?? null;
  const attachments = request.attachments ?? [];
  const selectedToolContext = await loadFrozenToolContexts(request.toolResultIds ?? []);
  const retrievedToolContext = request.retrieveToolContext
    ? await loadRelevantToolContexts(request.question, 3)
    : [];
  const toolContext = [...new Map(
    [...selectedToolContext, ...retrievedToolContext].map((item) => [item.id, item]),
  ).values()].slice(0, 3);
  await validateRunAttachments(attachments);
  const promptPlan = promptPlanForRun({ question: request.question, members, memoryContext, toolContext, attachments, continuationContext });
  if (request.expectedPreflightFingerprint && request.expectedPreflightFingerprint !== promptPlan.fingerprint) {
    throw new PreflightMismatchError();
  }
  const receivesAttachments = members.some((member) => member.receiveAttachments === true);
  const risk = buildRiskPreflight({
    question: request.question, requestedProfile: request.riskProfile,
    continuationContext,
    documents: receivesAttachments ? attachments.filter((item) => item.mimeType === "application/pdf").map((item) => ({ content: item.extractedText })) : [],
    imageCount: receivesAttachments ? attachments.filter((item) => item.mimeType !== "application/pdf").length : 0,
    memoryContext, toolContext, promptFingerprint: promptPlan.fingerprint, reviewRounds: request.reviewRounds,
  });
  if (request.expectedRiskFingerprint && request.expectedRiskFingerprint !== risk.fingerprint) throw new PreflightMismatchError();
  assertRiskConfiguration(risk.assessment, members, request.reviewRounds);
  if (!request.preflightDecision) {
    const missing = findCriticalMissingContext(revision.originalQuestion);
    if (missing.length > 0) throw new MissingContextError(missing);
  }
  const boss = await getBoss();

  return db.transaction(async (tx) => {
    // Serialize an owner's intent, including the absent-row case. The unique index
    // alone cannot replay two concurrent requests after both observe no run.
    await lockConversationMembership(tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCAL_OWNER_ID}), hashtext(${request.idempotencyKey}))`);
    if (await isRunIntentDeleted(tx, request.idempotencyKey)) throw new IdempotencyConflictError();
    const [alreadyQueued] = await tx.select().from(runs)
      .where(and(eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.idempotencyKey, request.idempotencyKey))).limit(1);
    if (alreadyQueued) {
      if (alreadyQueued.requestHash !== requestHash) throw new IdempotencyConflictError();
      return mapRun(alreadyQueued);
    }
    let approvedDecision: RunRecord["preflightDecision"] = null;
    if (continuationContext) {
      // Same row lock as retention and report edits. Snapshot remains independent
      // of the source after this transaction commits, including source deletion.
      const [source] = await tx.select().from(runs)
        .where(and(eq(runs.id, continuationContext.sourceRunId), eq(runs.ownerId, LOCAL_OWNER_ID))).for("update").limit(1);
      if (!source) throw new ContinuationUnavailableError();
      if (continuationSelectionFromRow(source, request.continuationSource?.compaction).context.sha256 !== continuationContext.sha256) throw new PreflightMismatchError();
    }
    if (request.preflightDecision) {
      const decision = request.preflightDecision;
      const [draft] = await tx.select().from(preflightDrafts).where(and(
        eq(preflightDrafts.id, decision.draftId), eq(preflightDrafts.ownerId, LOCAL_OWNER_ID),
      )).for("update").limit(1);
      if (!draft || draft.status !== "awaiting_input" || !draft.requestCiphertext) throw new PreflightMismatchError();
      const saved = createRunRequestSchema.parse(decryptJson<unknown>(draft.requestCiphertext, `preflight-draft:${draft.id}:request`));
      const frozen = preflightQuestionsSchema.parse(draft.questions);
      const savedOriginal = saved.promptRevision?.originalQuestion ?? saved.question;
      if (frozen.policyVersion !== PREFLIGHT_CONTEXT_POLICY_VERSION || JSON.stringify(frozen.questions) !== JSON.stringify(findCriticalMissingContext(savedOriginal))) {
        throw new PreflightMismatchError();
      }
      const expectedBase = composeClarifiedQuestion(savedOriginal, decision.choice, decision.answer);
      if (revision.originalQuestion !== expectedBase) throw new PreflightMismatchError();
      const originalCandidate = { ...request, question: saved.question,
        expectedPreflightFingerprint: saved.expectedPreflightFingerprint, expectedRiskFingerprint: saved.expectedRiskFingerprint,
        previewImages: saved.previewImages, preflightDecision: undefined, promptRevision: saved.promptRevision };
      if (request.idempotencyKey !== saved.idempotencyKey ||
        hashRunRequest(originalCandidate) !== draft.requestHash || hashRunRequest(saved) !== draft.requestHash) {
        throw new PreflightMismatchError();
      }
      approvedDecision = { ...decision, originalQuestion: savedOriginal, questions: frozen.questions, policyVersion: frozen.policyVersion };
    }
    const runId = randomUUID();
    const snapshotId = randomUUID();
    const [inserted] = await tx
      .insert(runs)
      .values({
        id: runId,
        ownerId: LOCAL_OWNER_ID,
        idempotencyKey: request.idempotencyKey,
        requestHash,
        question: "[encrypted]",
        questionCiphertext: encryptText(request.question, `run:${runId}:question`),
        scenario: request.scenario,
        providerMode: request.providerMode === "fake" ? "fake" : "remote",
        riskProfile: risk.assessment.effectiveProfile,
        riskAssessmentCiphertext: encryptJson(risk.assessment, `run:${runId}:risk-assessment`),
        preflightDecisionCiphertext: approvedDecision ? encryptJson(approvedDecision, `run:${runId}:preflight-decision`) : null,
        promptRevisionCiphertext: encryptJson({ revision, audit: revisionAudit }, `run:${runId}:prompt-revision`),
        continuationContextCiphertext: continuationContext ? encryptJson(continuationContext, `run:${runId}:continuation-context`) : null,
        continuationArchiveCiphertext: continuationArchive ? encryptJson(continuationArchive, `run:${runId}:continuation-archive`) : null,
        branchSourceRunId: continuationContext?.sourceRunId ?? null,
        branchKind: !continuationContext ? "independent" : continuationContext.version === "run-continuation-v2" ? "continuation-compacted" : "continuation-full",
        branchIndexVersion: 1,
        promptVersion: promptPlan.version,
        promptFingerprint: promptPlan.fingerprint,
        reviewRounds: request.reviewRounds,
        selfRevisionEnabled: request.selfRevisionEnabled === true,
        executionLimitsCiphertext: executionLimits ? encryptJson(executionLimits, `run:${runId}:execution-limits`) : null,
        membersCiphertext: encryptJson(members, `run:${runId}:members`),
        memberCount: members.length,
        memoryContextCiphertext: encryptJson(memoryContext, `run:${runId}:memory-context`),
        memoryEntryCount: memoryContext.length,
        attachmentsCiphertext: encryptJson(attachments, `run:${runId}:attachments`),
        attachmentCount: attachments.length,
        toolContextCiphertext: encryptJson(toolContext, `run:${runId}:tool-context`),
        toolResultCount: toolContext.length,
        snapshotId,
        status: "queued",
      })
      .returning();
    if (!inserted) throw new Error("Run could not be inserted.");
    await attachRunToConversation(tx, inserted);

    const jobId = await boss.send(
      RUN_COUNCIL_QUEUE,
      { runId },
      {
        db: fromDrizzle(tx, sql),
        singletonKey: runId,
      },
    );
    if (!jobId) throw new Error("Queue job could not be created.");
    if (request.preflightDecision) {
      await tx.update(preflightDrafts).set({ status: "started", runId, requestCiphertext: null, questionCiphertext: null, updatedAt: new Date() })
        .where(eq(preflightDrafts.id, request.preflightDecision.draftId));
    }

    const [updated] = await tx
      .update(runs)
      .set({
        queueJobId: jobId,
        lastSequence: sql`${runs.lastSequence} + 1`,
        stateVersion: sql`${runs.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning();
    if (!updated) throw new Error("Queued run could not be updated.");
    await tx.insert(runEvents).values({
      runId,
      sequence: updated.lastSequence,
      type: "run.queued",
      payload: { status: "queued" },
    });
    return mapRun(updated);
  });
}

/** Explicit follow-up: one fresh round-0 member, immutable copies of the others, then fresh reviews. */
export async function enqueueSelectedMemberRerun(input: {
  sourceRunId: string;
  memberId: string;
  idempotencyKey: string;
}): Promise<RunRecord> {
  const db = getDatabase();
  const requestHash = fingerprint(JSON.stringify({ version: "member-rerun-v1", sourceRunId: input.sourceRunId, memberId: input.memberId }));
  const boss = await getBoss();
  return db.transaction(async (tx) => {
    await lockConversationMembership(tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCAL_OWNER_ID}), hashtext(${input.idempotencyKey}))`);
    if (await isRunIntentDeleted(tx, input.idempotencyKey)) throw new IdempotencyConflictError();
    const [existing] = await tx.select().from(runs)
      .where(and(eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
      return mapRun(existing);
    }
    const [source] = await tx.select().from(runs)
      .where(and(eq(runs.id, input.sourceRunId), eq(runs.ownerId, LOCAL_OWNER_ID)))
      .for("update").limit(1);
    if (!source || source.status !== "completed" || source.providerMode !== "remote" ||
        !source.membersCiphertext || !source.reportCiphertext || !source.promptFingerprint || !source.riskAssessmentCiphertext) {
      throw new FollowUpUnavailableError("Yalnız tam bitmiş, izlenebilir uzak konsey çalışmaları tekrar çalıştırılabilir.");
    }
    const unresolved = await tx.select({ id: providerOperations.id }).from(providerOperations)
      .where(and(eq(providerOperations.runId, source.id), inArray(providerOperations.status,
        ["prepared", "submitted", "outcome_unknown", "retry_authorized"]))).limit(1);
    if (unresolved.length > 0) throw new FollowUpUnavailableError("Kaynak çalışmada sonucu belirsiz bir sağlayıcı çağrısı var.");
    const members = reportMembers(source);
    const executionLimits = source.executionLimitsCiphertext
      ? executionLimitsSchema.parse(decryptJson(source.executionLimitsCiphertext, `run:${source.id}:execution-limits`)) : null;
    if (executionLimits && !executionPlanFits(executionLimits, plannedProviderCalls(members.length, source.reviewRounds, true))) {
      throw new ExecutionPlanLimitsError();
    }
    const sourceReport = hydrateCouncilReport(decryptJson(source.reportCiphertext, `run:${source.id}:report`), members);
    if (!sourceReport || sourceReport.status !== "completed" || sourceReport.reportQuality?.mechanicalIntegrity !== true ||
        sourceReport.failures.length > 0 ||
        sourceReport.memberResults.length !== members.length ||
        !members.some((member) => member.id === input.memberId) ||
        members.some((member) => !sourceReport.memberResults.some((result) => result.memberId === member.id && result.label === member.label && result.councilRole === member.councilRole)) ||
        sourceReport.memberResults.some((result) => typeof result.rawText !== "string" || !providerOutputSchema.safeParse(result.parsed).success ||
          !Array.isArray(result.citations) || result.citations.some((citation) => !providerCitationSchema.safeParse(citation).success))) {
      throw new FollowUpUnavailableError("Kaynak raporda bütün üyelerin doğrulanmış ilk yanıtları bulunmalı.");
    }
    const requiredMembers = source.reviewRounds > 0 ? members : members.filter((member) => member.id === input.memberId);
    const requiredIds = requiredMembers.flatMap((member) => member.connectionId ? [member.connectionId] : []);
    const connections = requiredIds.length > 0 ? await tx.select({ id: providerConnections.id, provider: providerConnections.provider })
      .from(providerConnections).where(and(inArray(providerConnections.id, requiredIds), eq(providerConnections.ownerId, LOCAL_OWNER_ID))) : [];
    if (requiredMembers.some((member) => !connections.some((connection) => connection.id === member.connectionId && connection.provider === member.provider))) {
      throw new FollowUpUnavailableError("Yeniden analiz veya inceleme için gereken kayıtlı sağlayıcı bağlantısı artık kullanılamıyor.");
    }
    const question = source.questionCiphertext
      ? decryptText(source.questionCiphertext, `run:${source.id}:question`) : source.question;
    const continuationContext = readContinuation(source);
    const continuationArchive = readContinuationArchive(source);
    const memoryContext = source.memoryContextCiphertext
      ? decryptJson<FrozenMemoryEntry[]>(source.memoryContextCiphertext, `run:${source.id}:memory-context`) : [];
    const attachments = source.attachmentsCiphertext
      ? decryptJson<RunAttachment[]>(source.attachmentsCiphertext, `run:${source.id}:attachments`) : [];
    const toolContext = source.toolContextCiphertext
      ? decryptJson<FrozenToolContext[]>(source.toolContextCiphertext, `run:${source.id}:tool-context`) : [];
    const promptPlan = promptPlanForRun({ question, members, memoryContext, toolContext, attachments, continuationContext });
    if (promptPlan.version !== source.promptVersion || promptPlan.fingerprint !== source.promptFingerprint) {
      throw new FollowUpUnavailableError("Kaynak çalışmanın istem parmak izi artık doğrulanamıyor.");
    }
    const receivesAttachments = members.some((member) => member.receiveAttachments === true);
    const currentRisk = buildRiskPreflight({
      question, requestedProfile: source.riskProfile === "high" ? "high" : "standard",
      continuationContext,
      documents: receivesAttachments ? attachments.filter((item) => item.mimeType === "application/pdf").map((item) => ({ content: item.extractedText })) : [],
      imageCount: receivesAttachments ? attachments.filter((item) => item.mimeType !== "application/pdf").length : 0,
      memoryContext, toolContext, promptFingerprint: promptPlan.fingerprint,
      reviewRounds: reviewRoundCountSchema.parse(source.reviewRounds),
    });
    try {
      assertRiskConfiguration(currentRisk.assessment, members, reviewRoundCountSchema.parse(source.reviewRounds));
    } catch {
      throw new FollowUpUnavailableError("Güncel risk kontrolleri kaynak yapılandırmayla karşılanmıyor.");
    }
    if (currentRisk.assessment.effectiveProfile !== source.riskProfile) {
      throw new FollowUpUnavailableError("Güncel risk profili değişti; yeni bir konsey önizlemesi oluşturun.");
    }
    const reusedInitialResults = sourceReport.memberResults
      .filter((result) => result.memberId !== input.memberId)
      .map((result) => ({ ...result, reusedFromRunId: source.id }));
    const followUp: FollowUpSnapshot = {
      version: "member-rerun-v1", sourceRunId: source.id, rerunMemberId: input.memberId,
      reusedMemberIds: reusedInitialResults.map((result) => result.memberId),
      maximumProviderCalls: 1 + members.length * source.reviewRounds,
      reusedInitialResults,
    };
    const runId = randomUUID();
    const [inserted] = await tx.insert(runs).values({
      id: runId, ownerId: LOCAL_OWNER_ID, idempotencyKey: input.idempotencyKey, requestHash,
      question: "[encrypted]", questionCiphertext: encryptText(question, `run:${runId}:question`),
      scenario: "success", providerMode: "remote", riskProfile: source.riskProfile,
      riskAssessmentCiphertext: encryptJson(currentRisk.assessment, `run:${runId}:risk-assessment`),
      preflightDecisionCiphertext: source.preflightDecisionCiphertext
        ? encryptJson(decryptJson(source.preflightDecisionCiphertext, `run:${source.id}:preflight-decision`), `run:${runId}:preflight-decision`) : null,
      promptRevisionCiphertext: source.promptRevisionCiphertext
        ? encryptJson(decryptJson(source.promptRevisionCiphertext, `run:${source.id}:prompt-revision`), `run:${runId}:prompt-revision`) : null,
      followUpCiphertext: encryptJson(followUp, `run:${runId}:follow-up`),
      branchSourceRunId: source.id, branchKind: "member-rerun", branchIndexVersion: 1,
      continuationContextCiphertext: continuationContext ? encryptJson(continuationContext, `run:${runId}:continuation-context`) : null,
      continuationArchiveCiphertext: continuationArchive ? encryptJson(continuationArchive, `run:${runId}:continuation-archive`) : null,
      executionLimitsCiphertext: executionLimits ? encryptJson(executionLimits, `run:${runId}:execution-limits`) : null,
      promptVersion: promptPlan.version, promptFingerprint: promptPlan.fingerprint,
      reviewRounds: source.reviewRounds, selfRevisionEnabled: source.selfRevisionEnabled,
      membersCiphertext: encryptJson(members, `run:${runId}:members`), memberCount: members.length,
      memoryContextCiphertext: encryptJson(memoryContext, `run:${runId}:memory-context`), memoryEntryCount: memoryContext.length,
      attachmentsCiphertext: encryptJson(attachments, `run:${runId}:attachments`), attachmentCount: attachments.length,
      toolContextCiphertext: encryptJson(toolContext, `run:${runId}:tool-context`), toolResultCount: toolContext.length,
      snapshotId: source.snapshotId, status: "queued",
    }).returning();
    if (!inserted) throw new Error("Follow-up run could not be inserted.");
    await attachRunToConversation(tx, inserted);
    const jobId = await boss.send(RUN_COUNCIL_QUEUE, { runId }, {
      db: fromDrizzle(tx, sql), singletonKey: runId,
    });
    if (!jobId) throw new Error("Follow-up queue job could not be created.");
    const [queued] = await tx.update(runs).set({
      queueJobId: jobId, lastSequence: sql`${runs.lastSequence} + 1`,
      stateVersion: sql`${runs.stateVersion} + 1`, updatedAt: new Date(),
    }).where(eq(runs.id, runId)).returning();
    if (!queued) throw new Error("Follow-up run could not be queued.");
    await tx.insert(runEvents).values({
      runId, sequence: queued.lastSequence, type: "run.queued",
      payload: { status: "queued", followUpVersion: followUp.version, sourceRunId: source.id, rerunMemberId: input.memberId },
    });
    return mapRun(queued);
  });
}

/** Offline measurement reads report and frozen settings from the same owner-scoped row snapshot. */
export async function findDurableRunEvaluationSnapshot(runId: string) {
  const [row] = await getDatabase().select().from(runs)
    .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!row) return undefined;
  return { run: mapRun(row), members: reportMembers(row), providerMode: row.providerMode, reviewRounds: row.reviewRounds, selfRevisionEnabled: row.selfRevisionEnabled };
}

export async function findDurableRunById(runId: string): Promise<RunRecord | undefined> {
  const [row] = await getDatabase()
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID)))
    .limit(1);
  return row ? mapRun(row) : undefined;
}

export async function listDurableRuns(
  beforeRunId?: string,
  pageSize = RUN_HISTORY_PAGE_SIZE,
): Promise<RunHistoryPage | undefined> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > RUN_HISTORY_PAGE_SIZE) {
    throw new Error("Invalid run history page size.");
  }
  const db = getDatabase();
  const [cursor] = beforeRunId
    ? await db.select({ id: runs.id, createdAt: sql<string>`${runs.createdAt}::text` }).from(runs)
      .where(and(eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.id, beforeRunId))).limit(1)
    : [];
  if (beforeRunId && !cursor) return undefined;

  const rows = await db.select({
    id: runs.id,
    question: runs.question,
    questionCiphertext: runs.questionCiphertext,
    status: runs.status,
    riskProfile: runs.riskProfile,
    memberCount: runs.memberCount,
    attachmentCount: runs.attachmentCount,
    createdAt: runs.createdAt,
    hasReport: sql<boolean>`${runs.reportCiphertext} is not null or ${runs.report} is not null`,
  }).from(runs).where(cursor
    ? and(eq(runs.ownerId, LOCAL_OWNER_ID), or(
      lt(runs.createdAt, sql`${cursor.createdAt}::timestamptz`),
      and(eq(runs.createdAt, sql`${cursor.createdAt}::timestamptz`), lt(runs.id, cursor.id)),
    ))
    : eq(runs.ownerId, LOCAL_OWNER_ID))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(pageSize + 1);

  const pageRows = rows.slice(0, pageSize);
  return {
    runs: pageRows.map((row) => ({
      runId: row.id,
      question: row.questionCiphertext
        ? decryptText(row.questionCiphertext, `run:${row.id}:question`)
        : row.question,
      status: row.status,
      riskProfile: row.riskProfile === "high" ? "high" : "standard",
      memberCount: row.memberCount,
      attachmentCount: row.attachmentCount,
      createdAt: row.createdAt.toISOString(),
      hasReport: row.hasReport,
    })),
    nextCursor: rows.length > pageSize ? pageRows.at(-1)?.id ?? null : null,
  };
}

export async function listDurableRunEvents(
  runId: string,
  afterSequence = 0,
): Promise<{ run: RunRecord; events: DurableRunEvent[] } | undefined> {
  const run = await findDurableRunById(runId);
  if (!run) return undefined;
  const rows = await getDatabase()
    .select({
      sequence: runEvents.sequence,
      type: runEvents.type,
      payload: runEvents.payload,
      createdAt: runEvents.createdAt,
    })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, afterSequence)))
    .orderBy(asc(runEvents.sequence))
    .limit(100);
  return {
    run,
    events: rows.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function executeDurableRun(
  runId: string,
  executor?: DurableCouncilExecutor,
): Promise<RunRecord | undefined> {
  // A session lock spans the remote call and both state transactions. A second
  // delivery observes the running run but cannot publish a competing report.
  const lockKey = createHash("sha256").update(`deliberation-ai-run:${runId}`).digest().readBigInt64BE(0).toString();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  // Keep the fence outside the ordinary query pool so multiple active workers
  // cannot consume every pooled connection needed by their provider receipts.
  const client = new Client({ connectionString, application_name: "deliberation-ai-run-fence" });
  let acquired = false;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const db = drizzle(client, { schema });
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [lockKey],
    );
    if (!lock.rows[0]?.acquired) {
      const [row] = await db.select().from(runs)
        .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID))).limit(1);
      return row ? mapRun(row) : undefined;
    }
    acquired = true;
    return await executeDurableRunLocked(runId, executor, db);
  } finally {
    if (connected && acquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
      } catch {
        // A lost session already released its advisory lock and aborts its transactions.
      }
    }
    if (connected) await client.end();
  }
}

async function executeDurableRunLocked(
  runId: string,
  executor: DurableCouncilExecutor | undefined,
  db: ReturnType<typeof getDatabase>,
): Promise<RunRecord | undefined> {
  const work = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID)))
      .for("update")
      .limit(1);
    if (!row || !["queued", "running"].includes(row.status)) return undefined;

    if (row.status === "queued") {
      const [running] = await tx
        .update(runs)
        .set({
          status: "running",
          lastSequence: sql`${runs.lastSequence} + 1`,
          stateVersion: sql`${runs.stateVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, runId))
        .returning();
      if (!running) throw new Error("Run could not enter running state.");
      await tx.insert(runEvents).values({
        runId,
        sequence: running.lastSequence,
        type: "run.running",
        payload: { status: "running" },
      });
    }

    // Audit the private archive before dispatch without putting it in provider work.
    readContinuationArchive(row);
    return {
      runId: row.id,
      question: row.questionCiphertext
        ? decryptText(row.questionCiphertext, `run:${row.id}:question`)
        : row.question,
      snapshotId: row.snapshotId,
      continuationContext: readContinuation(row),
      scenario: row.scenario === "member-b-fails" ? "member-b-fails" : "success",
      providerMode: row.providerMode === "fake" ? "fake" : "remote",
      riskProfile: row.riskProfile === "high" ? "high" : "standard",
      riskAssessment: row.riskAssessmentCiphertext
        ? riskAssessmentSchema.parse(decryptJson(row.riskAssessmentCiphertext, `run:${row.id}:risk-assessment`))
        : null,
      promptVersion: row.promptVersion,
      promptFingerprint: row.promptFingerprint,
      reviewRounds: reviewRoundCountSchema.parse(row.reviewRounds),
      selfRevisionEnabled: row.selfRevisionEnabled,
      executionLimits: row.executionLimitsCiphertext
        ? executionLimitsSchema.parse(decryptJson(row.executionLimitsCiphertext, `run:${row.id}:execution-limits`)) : null,
      members: row.membersCiphertext
        ? councilMembersSchema.parse(
            decryptJson<unknown>(row.membersCiphertext, `run:${row.id}:members`),
          )
        : defaultFakeCouncilMembers.map((member) => ({ ...member })),
      memoryContext: row.memoryContextCiphertext
        ? decryptJson<FrozenMemoryEntry[]>(
            row.memoryContextCiphertext,
            `run:${row.id}:memory-context`,
          )
        : [],
      attachments: row.attachmentsCiphertext
        ? decryptJson<RunAttachment[]>(row.attachmentsCiphertext, `run:${row.id}:attachments`)
        : [],
      toolContext: row.toolContextCiphertext
        ? decryptJson<FrozenToolContext[]>(row.toolContextCiphertext, `run:${row.id}:tool-context`)
        : [],
      reusedInitialResults: row.followUpCiphertext
        ? decryptJson<FollowUpSnapshot>(row.followUpCiphertext, `run:${row.id}:follow-up`).reusedInitialResults
        : [],
      followUp: row.followUpCiphertext
        ? decryptJson<FollowUpSnapshot>(row.followUpCiphertext, `run:${row.id}:follow-up`)
        : null,
    } satisfies DurableRunWork;
  });
  if (!work) return findDurableRunById(runId);

  const executionPlan = work.promptFingerprint === null ? null : promptPlanForRun(work);
  const promptMismatch = executionPlan !== null && (
    executionPlan.version !== work.promptVersion || executionPlan.fingerprint !== work.promptFingerprint
  );
  const riskMismatch = Boolean(work.riskAssessment && (
    work.riskAssessment.effectiveProfile !== work.riskProfile ||
    (work.riskProfile === "high" && (work.reviewRounds < 1 || !work.members.some((member) => member.councilRole === "red-team")))
  ));
  const followUpMismatch = work.followUp ? (
    work.followUp.version !== "member-rerun-v1" ||
    !work.members.some((member) => member.id === work.followUp?.rerunMemberId) ||
    work.reusedInitialResults.length !== work.members.length - 1 ||
    new Set(work.reusedInitialResults.map((result) => result.memberId)).size !== work.reusedInitialResults.length ||
    JSON.stringify(work.followUp.reusedMemberIds) !== JSON.stringify(work.reusedInitialResults.map((result) => result.memberId)) ||
    work.reusedInitialResults.some((result) =>
      result.memberId === work.followUp?.rerunMemberId ||
      !work.members.some((member) => member.id === result.memberId && member.label === result.label && member.councilRole === result.councilRole) ||
      result.reusedFromRunId !== work.followUp?.sourceRunId)
  ) : work.reusedInitialResults.length > 0;
  const rawReport = promptMismatch || riskMismatch || followUpMismatch
    ? buildCouncilReport([], work.members.map((member) => ({
        memberId: member.id,
        label: member.label,
        councilRole: member.councilRole,
        code: riskMismatch ? "risk_snapshot_mismatch" : followUpMismatch ? "follow_up_snapshot_mismatch" : "prompt_snapshot_mismatch",
        message: "Kaydedilen istem veya risk kontrolleri değişti; modele istek gönderilmedi.",
      })))
    : executor
    ? await executor(work)
    : await executeFakeCouncil(
        {
          snapshotId: work.snapshotId,
          question: work.question,
          continuationContext: work.continuationContext,
          memoryContext: work.memoryContext,
          attachments: work.attachments,
          toolContext: work.toolContext,
        },
        work.scenario,
        work.members,
        work.reviewRounds,
        work.selfRevisionEnabled,
        work.reusedInitialResults,
      );
  const report = applyRiskControls(rawReport, work.riskProfile, work.members, work.reviewRounds);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID)))
      .for("update")
      .limit(1);
    if (!current) return undefined;
    if (current.status === "cancelled") return mapRun(current);
    if (!["queued", "running"].includes(current.status)) return mapRun(current);

    const existingClaims = await tx.select({ id: claims.id }).from(claims).where(eq(claims.runId, runId));
    if (existingClaims.length > 0) {
      await tx.delete(claims).where(inArray(claims.id, existingClaims.map((item) => item.id)));
    }
    await tx.delete(modelRuns).where(eq(modelRuns.runId, runId));

    const memberRunIds = new Map<string, string>();
    for (const member of report.memberResults) {
      const modelRunId = randomUUID();
      const [insertedMember] = await tx
        .insert(modelRuns)
        .values({
          id: modelRunId,
          runId,
          memberId: member.memberId,
          memberLabel: member.label,
          councilRole: member.councilRole,
          round: 0,
          rawText: "[encrypted]",
          rawTextCiphertext: encryptText(member.rawText, `model-run:${modelRunId}:raw`),
          parsedOutputCiphertext: encryptJson(member.parsed, `model-run:${modelRunId}:parsed`),
        })
        .returning({ id: modelRuns.id });
      if (!insertedMember) throw new Error("Model result could not be persisted.");
      memberRunIds.set(member.memberId, insertedMember.id);
    }
    for (const failure of report.failures) {
      const modelRunId = randomUUID();
      await tx.insert(modelRuns).values({
        id: modelRunId,
        runId,
        memberId: failure.memberId,
        memberLabel: failure.label,
        councilRole: failure.councilRole ?? "analyst",
        round: 0,
        errorCode: failure.code,
        ...(failure.rawText !== undefined ? {
          rawText: "[encrypted]",
          rawTextCiphertext: encryptText(failure.rawText, `model-run:${modelRunId}:raw`),
        } : {}),
      });
    }
    for (const review of report.reviews) {
      const reviewRunId = randomUUID();
      await tx.insert(modelRuns).values({
        id: reviewRunId,
        runId,
        memberId: review.reviewerMemberId,
        memberLabel: review.reviewerLabel,
        councilRole: review.reviewerCouncilRole,
        round: review.round,
        rawText: "[encrypted]",
        rawTextCiphertext: encryptText(review.rawText, `model-run:${reviewRunId}:raw`),
        parsedOutputCiphertext: encryptJson(review.parsed, `model-run:${reviewRunId}:parsed`),
      });
    }
    for (const failure of report.reviewFailures) {
      const modelRunId = randomUUID();
      await tx.insert(modelRuns).values({
        id: modelRunId,
        runId,
        memberId: failure.memberId,
        memberLabel: failure.label,
        councilRole: failure.councilRole ?? "analyst",
        round: failure.round,
        errorCode: failure.code,
        ...(failure.rawText !== undefined ? {
          rawText: "[encrypted]",
          rawTextCiphertext: encryptText(failure.rawText, `model-run:${modelRunId}:raw`),
        } : {}),
      });
    }

    for (const claim of [
      ...report.sharedClaims,
      ...report.distinctClaims,
      ...report.redTeamChallenges,
    ]) {
      const claimId = randomUUID();
      const [insertedClaim] = await tx
        .insert(claims)
        .values({
          id: claimId,
          runId,
          statement: "[encrypted]",
          statementCiphertext: encryptText(claim.statement, `claim:${claimId}:statement`),
          disposition: claim.disposition,
          reportClaimId: claim.claimId,
          evidenceState: claim.evidenceState,
          synthesisCoverage: claim.synthesisCoverage,
        })
        .returning({ id: claims.id });
      if (!insertedClaim) throw new Error("Claim could not be persisted.");
      for (const occurrence of claim.occurrences) {
        const modelRunId = memberRunIds.get(occurrence.memberId);
        if (!modelRunId) throw new Error("Claim provenance is missing its model run.");
        const quoteFingerprint = fingerprint(occurrence.quote);
        await tx.insert(claimOccurrences).values({
          claimId: insertedClaim.id,
          modelRunId,
          quote: quoteFingerprint,
          quoteCiphertext: encryptText(
            occurrence.quote,
            `occurrence:${insertedClaim.id}:${modelRunId}:${quoteFingerprint}`,
          ),
          kind: occurrence.kind,
        });
      }
    }

    const [completed] = await tx
      .update(runs)
      .set({
        status: report.status,
        report: null,
        reportCiphertext: encryptJson(report, `run:${runId}:report`),
        finishedAt: new Date(),
        lastSequence: sql`${runs.lastSequence} + 1`,
        stateVersion: sql`${runs.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning();
    if (!completed) throw new Error("Run completion could not be persisted.");
    await tx.insert(runEvents).values({
      runId,
      sequence: completed.lastSequence,
      type: "run.finished",
      payload: { status: report.status },
    });
    return mapRun(completed);
  });
}

type ClaimAnnotation =
  | { kind: "evidence"; value: EvidenceState }
  | { kind: "synthesis"; value: SynthesisCoverage };

export class EvidenceRequirementError extends Error {
  constructor(evidenceState: "externally-verified" | "contradicted") {
    super(
      evidenceState === "externally-verified"
        ? "Dışarıdan doğrulandı durumu için doğrulanmış ve güncel kabul edilmiş bir destek kaynağı gerekli."
        : "Çelişiyor durumu için doğrulanmış ve güncel kabul edilmiş bir çelişki kaynağı gerekli.",
    );
    this.name = "EvidenceRequirementError";
  }
}

async function updateDurableClaimAnnotation(
  runId: string,
  claimId: string,
  annotation: ClaimAnnotation,
): Promise<RunRecord | undefined> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID)))
      .for("update")
      .limit(1);
    if (!row) return undefined;

    const storedReport = row.reportCiphertext
      ? decryptJson<CouncilReport>(row.reportCiphertext, `run:${row.id}:report`)
      : row.report;
    const report = hydrateCouncilReport(storedReport, reportMembers(row));
    if (!report) return undefined;
    const updatedReport = annotation.kind === "evidence"
      ? updateCouncilReportEvidenceState(report, claimId, annotation.value)
      : updateCouncilReportSynthesisCoverage(report, claimId, annotation.value);
    if (!updatedReport) return undefined;
    const reportClaim = [
      ...updatedReport.sharedClaims,
      ...updatedReport.distinctClaims,
      ...updatedReport.redTeamChallenges,
    ].find((claim) => claim.claimId === claimId);
    if (!reportClaim) return undefined;

    let [claimRow] = await tx
      .select({
        id: claims.id,
        statement: claims.statement,
        statementCiphertext: claims.statementCiphertext,
      })
      .from(claims)
      .where(and(eq(claims.runId, runId), eq(claims.reportClaimId, claimId)))
      .limit(1);
    if (!claimRow) {
      const legacyRows = await tx
        .select({
          id: claims.id,
          statement: claims.statement,
          statementCiphertext: claims.statementCiphertext,
          reportClaimId: claims.reportClaimId,
        })
        .from(claims)
        .where(eq(claims.runId, runId));
      claimRow = legacyRows.find((candidate) => {
        if (candidate.reportClaimId) return false;
        const statement = candidate.statementCiphertext
          ? decryptText(candidate.statementCiphertext, `claim:${candidate.id}:statement`)
          : candidate.statement;
        return statement === reportClaim.statement;
      });
    }
    if (!claimRow) return undefined;

    if (
      annotation.kind === "evidence" &&
      (annotation.value === "externally-verified" || annotation.value === "contradicted")
    ) {
      const requiredRelation =
        annotation.value === "externally-verified" ? "supports" : "contradicts";
      const [verifiedSource] = await tx
        .select({ id: evidenceSources.id })
        .from(evidenceSources)
        .where(
          and(
            eq(evidenceSources.claimId, claimRow.id),
            eq(evidenceSources.relation, requiredRelation),
            eq(evidenceSources.reviewStatus, "verified"),
            eq(evidenceSources.freshnessStatus, "current"),
          ),
        )
        .limit(1);
      if (!verifiedSource) throw new EvidenceRequirementError(annotation.value);
    }

    await tx
      .update(claims)
      .set(
        annotation.kind === "evidence"
          ? { reportClaimId: claimId, evidenceState: annotation.value }
          : { reportClaimId: claimId, synthesisCoverage: annotation.value },
      )
      .where(eq(claims.id, claimRow.id));
    const [updatedRun] = await tx
      .update(runs)
      .set({
        report: null,
        reportCiphertext: encryptJson(updatedReport, `run:${runId}:report`),
        lastSequence: sql`${runs.lastSequence} + 1`,
        stateVersion: sql`${runs.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning();
    if (!updatedRun) throw new Error("Claim annotation could not update its run.");
    await tx.insert(runEvents).values({
      runId,
      sequence: updatedRun.lastSequence,
      type:
        annotation.kind === "evidence"
          ? "claim.evidence_state_updated"
          : "claim.synthesis_coverage_updated",
      payload:
        annotation.kind === "evidence"
          ? { claimId, evidenceState: annotation.value }
          : { claimId, synthesisCoverage: annotation.value },
    });
    return mapRun(updatedRun);
  });
}

export async function updateDurableClaimEvidenceState(
  runId: string,
  claimId: string,
  evidenceState: EvidenceState,
): Promise<RunRecord | undefined> {
  return updateDurableClaimAnnotation(runId, claimId, { kind: "evidence", value: evidenceState });
}

export async function updateDurableClaimSynthesisCoverage(
  runId: string,
  claimId: string,
  synthesisCoverage: SynthesisCoverage,
): Promise<RunRecord | undefined> {
  return updateDurableClaimAnnotation(runId, claimId, {
    kind: "synthesis",
    value: synthesisCoverage,
  });
}

async function mutateDurableClaimContext(
  runId: string,
  update: (report: CouncilReport) => CouncilReport | undefined,
  eventType: string,
  eventPayload: Record<string, string | boolean>,
): Promise<RunRecord | undefined> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(runs)
      .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID)))
      .for("update").limit(1);
    if (!row) return undefined;
    const stored = row.reportCiphertext
      ? decryptJson<CouncilReport>(row.reportCiphertext, `run:${row.id}:report`)
      : row.report;
    const report = hydrateCouncilReport(stored, reportMembers(row));
    if (!report) return undefined;
    const updatedReport = update(report);
    if (!updatedReport) return undefined;
    const [updatedRun] = await tx.update(runs).set({
      report: null,
      reportCiphertext: encryptJson(updatedReport, `run:${runId}:report`),
      lastSequence: sql`${runs.lastSequence} + 1`,
      stateVersion: sql`${runs.stateVersion} + 1`,
      updatedAt: new Date(),
    }).where(eq(runs.id, runId)).returning();
    if (!updatedRun) throw new Error("Claim context could not update its run.");
    await tx.insert(runEvents).values({
      runId,
      sequence: updatedRun.lastSequence,
      type: eventType,
      payload: eventPayload,
    });
    return mapRun(updatedRun);
  });
}

export async function updateDurableClaimScope(
  runId: string,
  claimId: string,
  scopeNote: string,
): Promise<RunRecord | undefined> {
  return mutateDurableClaimContext(
    runId,
    (report) => updateCouncilClaimScope(report, claimId, scopeNote),
    "claim.scope_updated",
    { claimId, hasScopeNote: scopeNote.trim().length > 0 },
  );
}

export async function saveDurableClaimRelation(
  runId: string,
  input: SaveClaimRelationRequest,
): Promise<RunRecord | undefined> {
  return mutateDurableClaimContext(
    runId,
    (report) => upsertCouncilClaimRelation(report, {
      ...input,
      updatedAt: new Date().toISOString(),
    }),
    "claim.relation_saved",
    { fromClaimId: input.fromClaimId, toClaimId: input.toClaimId, kind: input.kind },
  );
}

export async function deleteDurableClaimRelation(
  runId: string,
  pair: Pick<SaveClaimRelationRequest, "fromClaimId" | "toClaimId">,
): Promise<RunRecord | undefined> {
  return mutateDurableClaimContext(
    runId,
    (report) => removeCouncilClaimRelation(report, pair),
    "claim.relation_deleted",
    pair,
  );
}

export async function cancelDurableRun(runId: string): Promise<RunRecord | undefined> {
  const db = getDatabase();
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID)))
      .for("update")
      .limit(1);
    if (!row) return undefined;
    if (["completed", "partially_completed", "failed", "cancelled"].includes(row.status)) {
      return { row, jobId: row.queueJobId };
    }
    const [cancelled] = await tx
      .update(runs)
      .set({
        status: "cancelled",
        finishedAt: new Date(),
        lastSequence: sql`${runs.lastSequence} + 1`,
        stateVersion: sql`${runs.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning();
    if (!cancelled) throw new Error("Run could not be cancelled.");
    await tx.insert(runEvents).values({
      runId,
      sequence: cancelled.lastSequence,
      type: "run.cancelled",
      payload: { status: "cancelled" },
    });
    return { row: cancelled, jobId: cancelled.queueJobId };
  });
  if (!result) return undefined;
  if (result.jobId) {
    const boss = await getBoss();
    await boss.cancel(RUN_COUNCIL_QUEUE, result.jobId);
  }
  return mapRun(result.row);
}
