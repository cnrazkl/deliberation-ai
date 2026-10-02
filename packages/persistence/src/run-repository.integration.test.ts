import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { resolve } from "node:path";
import { buildRoundZeroPromptPlan, buildRiskPreflight, executeCouncil, executeFakeCouncil, IdempotencyConflictError, RiskConfigurationError } from "@deliberation-ai/application";
import type { CreateRunRequest } from "@deliberation-ai/contracts";
import { defaultFakeCouncilMembers, type CouncilMemberConfig } from "@deliberation-ai/contracts";
import { buildCouncilReport, MissingContextError, PROMPT_REVISION_VERSION, suggestStructuredQuestion } from "@deliberation-ai/domain";
import { FakeProvider, NormalizedProviderError, type TextProvider } from "../../providers/src";
import { ReceiptTrackedProvider } from "../../../apps/worker/src/provider-runtime";
import { auditRestoredEncryption } from "../scripts/backup-encryption-audit";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDatabase, getDatabase, getPool } from "./database";
import { encryptJson, encryptText } from "./crypto";
import { pruneExpiredRuns } from "./run-retention";
import { closeBoss, getBoss, RUN_COUNCIL_QUEUE, RUN_DECISION_ASSESSMENT_QUEUE } from "./queue";
import { evaluateStoredCouncilCoverage, loadStoredCouncilMeasurementRuns } from "./council-coverage-evaluation";
import { councilCoverageCorpusSchema, prepareReviewRoundComparison, renderCouncilCoverageQuestion, sha256 } from "@deliberation-ai/evaluation";
import { inspectStoredReviewRoundComparison } from "./review-round-comparison";
import {
  cancelDurableRun,
  enqueueDurableRun,
  enqueueSelectedMemberRerun,
  executeDurableRun,
  FollowUpUnavailableError,
  PreflightMismatchError,
  EvidenceRequirementError,
  findDurableRunById,
  listDurableRuns,
  listDurableRunEvents,
  LOCAL_OWNER_ID,
  updateDurableClaimEvidenceState,
  updateDurableClaimSynthesisCoverage,
  updateDurableClaimScope,
  saveDurableClaimRelation,
  deleteDurableClaimRelation,
} from "./run-repository";
import {
  claims,
  claimOccurrences,
  councilTemplates,
  decisionAssessments,
  decisionConnections,
  decisionOperations,
  evidenceSources,
  localSchedules,
  memoryEntries,
  modelRuns,
  providerOperations,
  researchCaptures,
  runs,
  runEvents,
  preflightDrafts,
} from "./schema";
import { cancelPreflightDraft, createAwaitingPreflightDraft, listAwaitingPreflightDrafts, preparePreflightDraft, startPreflightDraft } from "./preflight-drafts";
import {
  deleteMemoryEntry,
  listMemoryEntries,
  saveMemoryEntry,
} from "./memory-entries";
import {
  deleteEvidenceSource,
  EvidenceSourceInUseError,
  listEvidenceSources,
  saveEvidenceSource,
  updateEvidenceSourceReview,
} from "./evidence-sources";
import {
  promoteResearchCapture,
  rejectResearchCapture,
  ResearchCaptureStateError,
  saveResearchCapture,
} from "./research-captures";
import {
  deleteCouncilTemplate,
  listCouncilTemplates,
  saveCouncilTemplate,
} from "./council-templates";
import {
  deleteProviderConnection,
  listProviderConnections,
  loadProviderConnectionSecret,
  saveProviderConnection,
} from "./provider-connections";
import {
  claimProviderOperationSubmission,
  fingerprintProviderRequest,
  getRunProviderUsage,
  listProviderOperationsNeedingAction,
  loadProviderOperationResult,
  loadProviderOperationFailureRawText,
  prepareProviderOperation,
  ProviderOperationResolutionError,
  resolveProviderOperation,
  updateProviderOperation,
} from "./provider-operations";
import {
  createLocalSchedule,
  deleteLocalSchedule,
  dispatchDueLocalSchedules,
  listLocalSchedules,
  updateLocalSchedule,
} from "./local-schedules";

const createdRunIds: string[] = [];
const createdTemplateIds: string[] = [];
const createdComparisonConnectionIds: string[] = [];

const extraMembers: CouncilMemberConfig[] = [
  { id: "fake-c", label: "Analist C", role: "Kanıt analisti", provider: "fake", model: "deterministic-fixture-v1", perspective: "evidence", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst" },
  { id: "fake-d", label: "Analist D", role: "Uygulama analisti", provider: "fake", model: "deterministic-fixture-v1", perspective: "implementation", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst" },
  { id: "fake-e", label: "Analist E", role: "Alternatifler analisti", provider: "fake", model: "deterministic-fixture-v1", perspective: "alternatives", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst" },
  { id: "fake-f", label: "Analist F", role: "Varsayım analisti", provider: "fake", model: "deterministic-fixture-v1", perspective: "assumptions", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst" },
];

function request(scenario: CreateRunRequest["scenario"] = "success"): CreateRunRequest {
  return {
    question: "Kalıcı kuyruk entegrasyon testi için yeterince uzun bir soru",
    idempotencyKey: randomUUID(),
    scenario,
    providerMode: "fake",
    reviewRounds: 1,
    memoryEntryIds: [],
  };
}

test("concurrent copies of one run intent enqueue one run and return it to every caller", async () => {
  const input = request();
  const copies = await Promise.all(Array.from({ length: 5 }, () => enqueueDurableRun(input)));
  createdRunIds.push(...copies.map((run) => run.runId));
  expect(new Set(copies.map((run) => run.runId)).size).toBe(1);
  await expect(enqueueDurableRun({ ...input, question: `${input.question} changed` })).rejects.toBeInstanceOf(IdempotencyConflictError);
});

test("preserves reported tokens from a returned response rejected by output validation", async () => {
  const run = await enqueueDurableRun(request());
  createdRunIds.push(run.runId);
  let calls = 0;
  const invalid: TextProvider = { id: "bad-json", label: "Bad JSON", councilRole: "analyst", async generate() {
    calls += 1;
    throw new NormalizedProviderError("Invalid JSON", "provider_response_invalid", "known", false, "not JSON", {
      provider: "google", model: "offline", remoteResponseId: "response-with-usage", inputTokens: 10, outputTokens: 3,
      tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "candidates",
        totalTokens: 33, reasoningTokens: 20, cachedInputTokens: 0 },
    });
  } };
  const tracked = new ReceiptTrackedProvider(run.runId, "google", "offline", "off", invalid);
  const input = { memberId: invalid.id, role: "Analyst", councilRole: "analyst" as const, round: 0 as const,
    input: { snapshotId: randomUUID(), question: "A bounded offline usage fixture question" } };
  await expect(tracked.generate(input)).rejects.toMatchObject({ code: "provider_response_invalid" });
  await expect(tracked.generate(input)).rejects.toMatchObject({ code: "provider_response_invalid" });
  expect(calls).toBe(1);
  const usage = await getRunProviderUsage(run.runId);
  expect(usage).toMatchObject({ operationCount: 1, inputReportCount: 1, uncertainUsageCount: 0,
    tokenDetails: { totalTokens: { reportedTokens: 33, reportCount: 1 }, reasoningTokens: { reportedTokens: 20, reportCount: 1 } } });
  expect(usage?.operations[0]).toMatchObject({ status: "failed", inputTokens: 10, outputTokens: 3 });
  expect(JSON.stringify(usage)).not.toContain("not JSON");
});

async function waitForTerminal(runId: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const run = await findDurableRunById(runId);
    if (run && ["completed", "partially_completed", "failed", "cancelled"].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Run ${runId} did not reach a terminal state.`);
}

afterAll(async () => {
  const cleanupErrors: unknown[] = [];
  for (const runId of createdRunIds) {
    try { await cancelDurableRun(runId); } catch (error) { cleanupErrors.push(error); }
  }
  await closeBoss();
  if (createdRunIds.length > 0) {
    await getDatabase().delete(runs).where(inArray(runs.id, createdRunIds));
  }
  if (createdTemplateIds.length > 0) {
    await getDatabase().delete(councilTemplates).where(inArray(councilTemplates.id, createdTemplateIds));
  }
  for (const connectionId of createdComparisonConnectionIds) {
    await deleteProviderConnection(connectionId);
  }
  await closeDatabase();
  if (cleanupErrors.length) throw new Error(`${cleanupErrors.length} fixture cancellation(s) failed; fixture rows were still removed.`);
});

test("previews retention and removes only expired local terminal runs with their dependent records", async () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  const expiredAt = new Date("2026-08-01T12:00:00.000Z");
  const old = await enqueueDurableRun(request());
  const recent = await enqueueDurableRun(request());
  const activeRunId = randomUUID();
  createdRunIds.push(old.runId, recent.runId, activeRunId);
  await executeDurableRun(old.runId);
  expect((await waitForTerminal(old.runId)).status).toBe("completed");
  await cancelDurableRun(recent.runId);
  const [oldQueueJob] = await getDatabase().select({ id: runs.queueJobId }).from(runs).where(eq(runs.id, old.runId));
  if (oldQueueJob?.id) await (await getBoss()).cancel(RUN_COUNCIL_QUEUE, oldQueueJob.id);
  await getDatabase().update(runs).set({ finishedAt: expiredAt }).where(eq(runs.id, old.runId));
  await getDatabase().insert(runs).values({
    id: activeRunId,
    ownerId: LOCAL_OWNER_ID,
    idempotencyKey: randomUUID(),
    requestHash: "retention-active-fixture",
    question: "[encrypted]",
    snapshotId: randomUUID(),
    status: "queued",
    createdAt: expiredAt,
  });

  const otherOwnerId = randomUUID();
  createdRunIds.push(otherOwnerId);
  await getDatabase().insert(runs).values({
    id: otherOwnerId,
    ownerId: "retention-test-other-owner",
    idempotencyKey: randomUUID(),
    requestHash: "retention-fixture",
    question: "[encrypted]",
    snapshotId: randomUUID(),
    status: "completed",
    finishedAt: expiredAt,
  });

  const operation = await prepareProviderOperation({
    runId: old.runId, memberId: "retention-fixture", provider: "fake", model: "fixture-model",
    requestFingerprint: fingerprintProviderRequest({ retention: true }),
  });
  await updateProviderOperation(operation.id, { status: "succeeded" });
  const linkedClaims = await getDatabase().select({ id: claims.id }).from(claims).where(eq(claims.runId, old.runId));
  expect(linkedClaims.length).toBeGreaterThan(0);
  expect((await getDatabase().select().from(modelRuns).where(eq(modelRuns.runId, old.runId))).length).toBeGreaterThan(0);
  expect((await getDatabase().select().from(runEvents).where(eq(runEvents.runId, old.runId))).length).toBeGreaterThan(0);

  const onlyRunIds = [old.runId, recent.runId, activeRunId, otherOwnerId];
  expect(await pruneExpiredRuns({ retentionDays: 30, now, onlyRunIds })).toMatchObject({ count: 1, applied: false });
  expect((await getDatabase().select().from(runs).where(eq(runs.id, old.runId))).length).toBe(1);
  expect(await pruneExpiredRuns({ retentionDays: 30, now, apply: true, onlyRunIds })).toMatchObject({ count: 1, applied: true });
  expect(await getDatabase().select().from(runs).where(eq(runs.id, old.runId))).toHaveLength(0);
  expect(await getDatabase().select().from(modelRuns).where(eq(modelRuns.runId, old.runId))).toHaveLength(0);
  expect(await getDatabase().select().from(claims).where(eq(claims.runId, old.runId))).toHaveLength(0);
  expect(await getDatabase().select().from(claimOccurrences).where(inArray(claimOccurrences.claimId, linkedClaims.map((claim) => claim.id)))).toHaveLength(0);
  expect(await getDatabase().select().from(runEvents).where(eq(runEvents.runId, old.runId))).toHaveLength(0);
  expect(await getDatabase().select().from(providerOperations).where(eq(providerOperations.id, operation.id))).toHaveLength(0);
  for (const runId of [recent.runId, activeRunId, otherOwnerId]) {
    expect(await getDatabase().select({ id: runs.id }).from(runs).where(eq(runs.id, runId))).toHaveLength(1);
  }
});

test("retention preserves unresolved calls and removes every run-owned fixture plus queue jobs once settled", async () => {
  const db = getDatabase();
  const now = new Date("2026-09-26T12:00:00.000Z");
  const expiredAt = new Date("2026-08-01T12:00:00.000Z");
  const queued = await enqueueDurableRun(request());
  createdRunIds.push(queued.runId);
  await executeDurableRun(queued.runId);
  const completed = await waitForTerminal(queued.runId);
  expect(completed.status).toBe("completed");
  await db.update(runs).set({ finishedAt: expiredAt }).where(eq(runs.id, queued.runId));

  const [runRow] = await db.select({ queueJobId: runs.queueJobId }).from(runs).where(eq(runs.id, queued.runId));
  const runJobId = runRow?.queueJobId;
  expect(runJobId).toBeTruthy();
  const [claim] = await db.select({ id: claims.id, reportClaimId: claims.reportClaimId })
    .from(claims).where(eq(claims.runId, queued.runId)).limit(1);
  if (!claim?.reportClaimId || !runJobId) throw new Error("Retention fixture is incomplete.");

  const memoryId = randomUUID();
  const sourceId = randomUUID();
  const captureId = randomUUID();
  const connectionId = randomUUID();
  const assessmentId = randomUUID();
  const operationId = randomUUID();
  const scheduleId = randomUUID();
  let decisionJobId: string | null = null;
  try {
    await db.insert(memoryEntries).values({
      id: memoryId, ownerId: LOCAL_OWNER_ID, sourceRunId: queued.runId,
      sourceClaimId: claim.reportClaimId, sourceType: "analyst-claim", evidenceState: "unsupported",
      contentCiphertext: encryptText("retention fixture", `memory-entry:${memoryId}:content`),
    });
    await db.insert(evidenceSources).values({
      id: sourceId, ownerId: LOCAL_OWNER_ID, runId: queued.runId, claimId: claim.id,
      reportClaimId: claim.reportClaimId, relation: "supports", reviewStatus: "unreviewed",
      titleCiphertext: encryptText("fixture", `evidence-source:${sourceId}:title`),
      urlCiphertext: encryptText("https://example.test/fixture", `evidence-source:${sourceId}:url`),
      excerptCiphertext: encryptText("fixture", `evidence-source:${sourceId}:excerpt`),
      noteCiphertext: encryptText("fixture", `evidence-source:${sourceId}:note`),
    });
    await db.insert(researchCaptures).values({
      id: captureId, ownerId: LOCAL_OWNER_ID, runId: queued.runId, claimId: claim.id,
      reportClaimId: claim.reportClaimId, evidenceSourceId: sourceId,
      requestedUrlCiphertext: encryptText("https://example.test/fixture", `research-capture:${captureId}:requested-url`),
      finalUrlCiphertext: encryptText("https://example.test/fixture", `research-capture:${captureId}:final-url`),
      titleCiphertext: encryptText("fixture", `research-capture:${captureId}:title`),
      contentCiphertext: encryptText("fixture", `research-capture:${captureId}:content`),
      contentType: "text/plain", byteLength: 7, contentSha256: createHash("sha256").update("fixture").digest("hex"),
    });
    await db.insert(decisionConnections).values({
      id: connectionId, ownerId: LOCAL_OWNER_ID, provider: "typesafe",
      label: `Retention fixture ${connectionId}`,
      secretCiphertext: encryptText("offline-fixture", `decision-connection:${connectionId}:secret`),
    });
    decisionJobId = await (await getBoss()).send(RUN_DECISION_ASSESSMENT_QUEUE, { assessmentId });
    if (!decisionJobId) throw new Error("Decision queue fixture was not created.");
    await db.insert(decisionAssessments).values({
      id: assessmentId, ownerId: LOCAL_OWNER_ID, runId: queued.runId, claimId: claim.id,
      reportClaimId: claim.reportClaimId, sourceId, connectionId, mode: "shadow",
      status: "outcome_unknown", rubricVersion: "fixture", requestedModel: "fixture",
      runStateVersion: 1, requestFingerprint: "fixture",
      inputCiphertext: encryptJson({ fixture: true }, `decision-assessment:${assessmentId}:input`),
      queueJobId: decisionJobId,
    });
    await db.insert(decisionOperations).values({
      id: operationId, assessmentId, provider: "typesafe", model: "fixture",
      status: "outcome_unknown", requestFingerprint: "fixture",
    });
    await db.insert(localSchedules).values({
      id: scheduleId, ownerId: LOCAL_OWNER_ID, providerMode: "fake", cadence: "daily",
      status: "paused", nextRunAt: new Date("2026-10-01T12:00:00.000Z"),
      lastRunId: queued.runId,
      nameCiphertext: encryptText("fixture", `local-schedule:${scheduleId}:name`),
      questionCiphertext: encryptText("fixture", `local-schedule:${scheduleId}:question`),
      membersCiphertext: encryptJson(defaultFakeCouncilMembers, `local-schedule:${scheduleId}:members`),
    });

    const providerOperation = await prepareProviderOperation({
      runId: queued.runId, memberId: "retention-unknown-fixture", provider: "fake", model: "fixture",
      requestFingerprint: fingerprintProviderRequest({ retentionUnknown: true }),
    });
    await updateProviderOperation(providerOperation.id, { status: "outcome_unknown" });
    const scope = { retentionDays: 30, now, onlyRunIds: [queued.runId] };
    expect((await pruneExpiredRuns(scope)).count).toBe(0);
    await updateProviderOperation(providerOperation.id, { status: "discarded" });
    expect((await pruneExpiredRuns(scope)).count).toBe(0);
    await db.update(decisionAssessments).set({ status: "completed" }).where(eq(decisionAssessments.id, assessmentId));
    expect((await pruneExpiredRuns(scope)).count).toBe(0);
    await db.update(decisionOperations).set({ status: "succeeded" }).where(eq(decisionOperations.id, operationId));
    expect((await pruneExpiredRuns(scope)).count).toBe(1);

    const jobCount = async (name: string, id: string): Promise<number> => {
      const result = await getPool().query<{ total: number }>(
        "SELECT count(*)::int AS total FROM pgboss.job WHERE name = $1 AND id = $2::uuid", [name, id],
      );
      return result.rows[0]?.total ?? 0;
    };
    expect(await jobCount(RUN_COUNCIL_QUEUE, runJobId)).toBe(1);
    expect(await jobCount(RUN_DECISION_ASSESSMENT_QUEUE, decisionJobId)).toBe(1);
    expect(await pruneExpiredRuns({ ...scope, apply: true })).toMatchObject({ count: 1, applied: true });

    expect(await db.select().from(runs).where(eq(runs.id, queued.runId))).toHaveLength(0);
    expect(await db.select().from(modelRuns).where(eq(modelRuns.runId, queued.runId))).toHaveLength(0);
    expect(await db.select().from(claims).where(eq(claims.runId, queued.runId))).toHaveLength(0);
    expect(await db.select().from(claimOccurrences).where(eq(claimOccurrences.claimId, claim.id))).toHaveLength(0);
    expect(await db.select().from(memoryEntries).where(eq(memoryEntries.sourceRunId, queued.runId))).toHaveLength(0);
    expect(await db.select().from(evidenceSources).where(eq(evidenceSources.runId, queued.runId))).toHaveLength(0);
    expect(await db.select().from(researchCaptures).where(eq(researchCaptures.runId, queued.runId))).toHaveLength(0);
    expect(await db.select().from(providerOperations).where(eq(providerOperations.runId, queued.runId))).toHaveLength(0);
    expect(await db.select().from(decisionAssessments).where(eq(decisionAssessments.runId, queued.runId))).toHaveLength(0);
    expect(await db.select().from(decisionOperations).where(eq(decisionOperations.id, operationId))).toHaveLength(0);
    expect(await db.select().from(runEvents).where(eq(runEvents.runId, queued.runId))).toHaveLength(0);
    expect(await jobCount(RUN_COUNCIL_QUEUE, runJobId)).toBe(0);
    expect(await jobCount(RUN_DECISION_ASSESSMENT_QUEUE, decisionJobId)).toBe(0);
    expect((await db.select({ lastRunId: localSchedules.lastRunId })
      .from(localSchedules).where(eq(localSchedules.id, scheduleId)))[0]?.lastRunId).toBeNull();
    expect(await db.select().from(decisionConnections).where(eq(decisionConnections.id, connectionId))).toHaveLength(1);
  } finally {
    await db.delete(runs).where(eq(runs.id, queued.runId));
    await db.delete(localSchedules).where(eq(localSchedules.id, scheduleId));
    await db.delete(decisionConnections).where(eq(decisionConnections.id, connectionId));
    if (decisionJobId) await (await getBoss()).deleteJob(RUN_DECISION_ASSESSMENT_QUEUE, decisionJobId);
    await (await getBoss()).deleteJob(RUN_COUNCIL_QUEUE, runJobId);
  }
});

test("retention rolls back rather than deleting a run with an invalid recorded queue id", async () => {
  const id = randomUUID();
  const db = getDatabase();
  const now = new Date("2026-09-26T12:00:00.000Z");
  await db.insert(runs).values({
    id, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "retention-rollback-fixture",
    question: "[encrypted]", questionCiphertext: encryptText("fixture", `run:${id}:question`),
    snapshotId: randomUUID(), status: "completed", finishedAt: new Date("2026-08-01T12:00:00.000Z"),
    queueJobId: "invalid-job-id",
  });
  try {
    const scope = { retentionDays: 30, now, onlyRunIds: [id] };
    expect((await pruneExpiredRuns(scope)).count).toBe(1);
    await expect(pruneExpiredRuns({ ...scope, apply: true })).rejects.toThrow("A stored queue job id is invalid.");
    expect(await db.select({ id: runs.id }).from(runs).where(eq(runs.id, id))).toHaveLength(1);
  } finally {
    await db.delete(runs).where(eq(runs.id, id));
  }
});

test("lists bounded owner history without loading report content and follows a stable cursor", async () => {
  const older = await enqueueDurableRun({ ...request(), question: "Geçmişteki ilk şifreli çalışma sorusu nedir?" });
  const newer = await enqueueDurableRun({ ...request(), question: "Geçmişteki ikinci şifreli çalışma sorusu nedir?" });
  createdRunIds.push(older.runId, newer.runId);
  await getDatabase().update(runs).set({ createdAt: new Date("2100-01-01T00:00:00.000Z") }).where(eq(runs.id, older.runId));
  await getDatabase().update(runs).set({ createdAt: new Date("2100-01-01T00:00:01.000Z") }).where(eq(runs.id, newer.runId));

  const first = await listDurableRuns(undefined, 1);
  expect(first?.runs).toEqual([expect.objectContaining({
    runId: newer.runId,
    question: "Geçmişteki ikinci şifreli çalışma sorusu nedir?",
    hasReport: expect.any(Boolean),
  })]);
  expect(first?.nextCursor).toBe(newer.runId);
  expect(first?.runs[0]).not.toHaveProperty("requestHash");
  expect(first?.runs[0]).not.toHaveProperty("idempotencyKey");
  expect(first?.runs[0]).not.toHaveProperty("report");

  const second = await listDurableRuns(first?.nextCursor ?? undefined, 1);
  expect(second?.runs[0]?.runId).toBe(older.runId);
  expect(await listDurableRuns(randomUUID(), 1)).toBeUndefined();
});

test("shows only provider-reported run usage and keeps unknown attempts visible", async () => {
  const run = await enqueueDurableRun(request());
  createdRunIds.push(run.runId);
  await cancelDurableRun(run.runId);
  const known = await prepareProviderOperation({
    runId: run.runId, memberId: "usage-known", provider: "openai", model: "fixture-model",
    requestFingerprint: fingerprintProviderRequest({ usage: "known" }),
  });
  await updateProviderOperation(known.id, { status: "succeeded", remoteResponseId: "fixture", inputTokens: 12, outputTokens: 7,
    metadata: { provider: "openai", model: "fixture-model", remoteResponseId: "fixture",
      tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "inclusive",
        totalTokens: 19, cachedInputTokens: 0, reasoningTokens: 4 } } });
  const unknown = await prepareProviderOperation({
    runId: run.runId, memberId: "usage-unknown", provider: "openai", model: "fixture-model",
    requestFingerprint: fingerprintProviderRequest({ usage: "unknown" }),
  });
  await updateProviderOperation(unknown.id, { status: "outcome_unknown", errorCode: "fixture_unknown" });

  const usage = await getRunProviderUsage(run.runId);
  expect(usage).toMatchObject({
    reportedInputTokens: 12,
    reportedOutputTokens: 7,
    operationCount: 2,
    inputReportCount: 1,
    outputReportCount: 1,
    uncertainUsageCount: 1,
    recentOperationsTruncated: false,
    tokenDetails: { totalTokens: { reportedTokens: 19, reportCount: 1 },
      cachedInputTokens: { reportedTokens: 0, reportCount: 1 }, reasoningTokens: { reportedTokens: 4, reportCount: 1 },
      cacheWriteInputTokens: { reportedTokens: null, reportCount: 0 } },
  });
  expect(usage?.operations.find((operation) => operation.id === unknown.id)).toMatchObject({
    inputTokens: null, outputTokens: null, status: "outcome_unknown",
  });
  expect(JSON.stringify(usage)).not.toContain(run.question);
  expect(JSON.stringify(usage)).not.toContain(run.idempotencyKey);
  expect(await getRunProviderUsage(randomUUID())).toBeUndefined();
});

test("usage detail totals include older receipts beyond the latest 100 displayed attempts", async () => {
  const run = await enqueueDurableRun(request());
  createdRunIds.push(run.runId);
  await cancelDurableRun(run.runId);
  const rows = Array.from({ length: 105 }, (_, index) => {
    const id = randomUUID();
    return { id, runId: run.runId, memberId: `paged-${index}`, provider: "openai", model: "offline",
      status: "succeeded", requestFingerprint: `fixture-${index}`, inputTokens: 2, outputTokens: 1,
      resultMetadataCiphertext: encryptJson({ provider: "openai", model: "offline", remoteResponseId: `fixture-${index}`,
        tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "inclusive",
          totalTokens: 3, reasoningTokens: 0 } }, `provider-operation:${id}:metadata`) };
  });
  await getDatabase().insert(providerOperations).values(rows);
  const usage = await getRunProviderUsage(run.runId);
  expect(usage).toMatchObject({ operationCount: 105, reportedInputTokens: 210, reportedOutputTokens: 105,
    recentOperationsTruncated: true, tokenDetails: { totalTokens: { reportedTokens: 315, reportCount: 105 },
      reasoningTokens: { reportedTokens: 0, reportCount: 105 }, cachedInputTokens: { reportedTokens: null, reportCount: 0 } } });
  expect(usage?.operations).toHaveLength(100);
});

test("freezes the reviewed first-round prompt and stops a changed snapshot before model execution", async () => {
  const input = request();
  const expected = buildRoundZeroPromptPlan({
    question: input.question,
    members: defaultFakeCouncilMembers,
    memoryContext: [],
    toolContext: [],
    documents: [],
    images: [],
  });
  await expect(enqueueDurableRun({ ...input, expectedPreflightFingerprint: "0".repeat(64) }))
    .rejects.toBeInstanceOf(PreflightMismatchError);
  const queued = await enqueueDurableRun({ ...input, expectedPreflightFingerprint: expected.fingerprint });
  createdRunIds.push(queued.runId);
  expect(queued.promptVersion).toBe(expected.version);
  expect(queued.promptFingerprint).toBe(expected.fingerprint);

  await getDatabase().update(runs).set({ promptFingerprint: "f".repeat(64) }).where(eq(runs.id, queued.runId));
  let invoked = false;
  const finished = await executeDurableRun(queued.runId, async () => {
    invoked = true;
    throw new Error("Executor must not receive a changed prompt snapshot.");
  });
  expect(invoked).toBe(false);
  expect(finished?.status).toBe("failed");
  expect(finished?.report?.failures.every((failure) => failure.code === "prompt_snapshot_mismatch")).toBe(true);

  const historical = await enqueueDurableRun(request());
  createdRunIds.push(historical.runId);
  await getDatabase().update(runs).set({ promptFingerprint: null }).where(eq(runs.id, historical.runId));
  expect((await executeDurableRun(historical.runId))?.status).toBe("completed");

  const tampered = await enqueueDurableRun({ ...request(), question: "İlaç X 5 mg dozunu 35 yaş için değiştirmek nasıl değerlendirilir?",
    members: [defaultFakeCouncilMembers[0]!, { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" }] });
  createdRunIds.push(tampered.runId);
  await getDatabase().update(runs).set({ reviewRounds: 0 }).where(eq(runs.id, tampered.runId));
  let riskExecutorInvoked = false;
  const riskResult = await executeDurableRun(tampered.runId, async () => { riskExecutorInvoked = true; throw new Error("Risk drift must stop dispatch"); });
  expect(riskExecutorInvoked).toBe(false);
  expect(riskResult?.report?.failures[0]?.code).toBe("risk_snapshot_mismatch");
});

test("preserves the actual round-one prompt inputs in the encrypted report", async () => {
  const queued = await enqueueDurableRun(request());
  createdRunIds.push(queued.runId);
  const finished = await executeDurableRun(queued.runId);
  const reopened = await findDurableRunById(queued.runId);
  expect(reopened?.report?.reviewPromptPlans).toEqual(finished?.report?.reviewPromptPlans);
  expect(reopened?.report?.reviewPromptPlans).toHaveLength(2);
  const plan = reopened!.report!.reviewPromptPlans![0]!;
  const input = JSON.parse(plan.input) as { originalQuestion: string; peers: Array<{ memberId: string }> };
  expect(input.originalQuestion).toBe(queued.question);
  expect(input.peers).toHaveLength(1);
  expect(input.peers[0]?.memberId).not.toBe(plan.reviewerMemberId);
  const [stored] = await getDatabase().select().from(runs).where(eq(runs.id, queued.runId));
  expect(stored?.reportCiphertext).not.toContain(queued.question);
});

test("persists opt-in self-revision across three review barriers and encrypted operation receipts", async () => {
  const queued = await enqueueDurableRun({ ...request(), reviewRounds: 3, selfRevisionEnabled: true });
  createdRunIds.push(queued.runId);
  let firstAttempt = true;
  let delegateCalls = 0;
  const executor = async (work: Parameters<NonNullable<Parameters<typeof executeDurableRun>[1]>>[0]) => {
    const providers = work.members.map((member) => {
      const fake = new FakeProvider({ id: member.id, label: member.label, role: member.role, councilRole: member.councilRole, perspective: member.perspective ?? "risk" });
      const counted: TextProvider = { id: fake.id, label: fake.label, ...(fake.role ? { role: fake.role } : {}), councilRole: fake.councilRole,
        async generate(input) { delegateCalls += 1; return fake.generate(input); } };
      return new ReceiptTrackedProvider(work.runId, "fake", member.model, "off", counted, member.role);
    });
    const report = await executeCouncil({ snapshotId: work.snapshotId, question: work.question }, providers, firstAttempt ? 2 : work.reviewRounds, work.members, work.selfRevisionEnabled);
    if (firstAttempt) {
      firstAttempt = false;
      throw new Error("simulated crash after second review barrier");
    }
    return report;
  };
  await expect(executeDurableRun(queued.runId, executor)).rejects.toThrow("simulated crash");
  expect(delegateCalls).toBe(6);
  const finished = await executeDurableRun(queued.runId, executor);
  expect(delegateCalls).toBe(8);
  expect(finished?.status).toBe("completed");
  expect(finished?.report?.reviewExecution).toEqual({ requestedRounds: 3, completedRounds: 3, stopReason: "round_limit" });
  expect(finished?.report?.reviews.map((review) => review.round)).toEqual([1, 1, 2, 2, 3, 3]);
  expect(finished?.report?.reviewPromptPlans?.every((plan) => plan.version === "cross-review-v3")).toBe(true);
  expect(finished?.report?.reviews.every((review) => "selfRevisions" in review.parsed)).toBe(true);
  const rows = await getDatabase().select({ round: modelRuns.round }).from(modelRuns).where(eq(modelRuns.runId, queued.runId));
  expect([0, 1, 2, 3].map((round) => rows.filter((row) => row.round === round).length)).toEqual([2, 2, 2, 2]);
  const receipts = await getDatabase().select({ round: providerOperations.round, status: providerOperations.status }).from(providerOperations).where(eq(providerOperations.runId, queued.runId));
  expect([0, 1, 2, 3].map((round) => receipts.filter((receipt) => receipt.round === round && receipt.status === "succeeded").length)).toEqual([2, 2, 2, 2]);
  expect((await findDurableRunById(queued.runId))?.report?.reviewPromptPlans?.map((plan) => plan.round)).toEqual([1, 1, 2, 2, 3, 3]);
  expect((await getDatabase().select({ enabled: runs.selfRevisionEnabled }).from(runs).where(eq(runs.id, queued.runId)))[0]?.enabled).toBe(true);
  await executeDurableRun(queued.runId, executor);
  expect((await getDatabase().select().from(providerOperations).where(eq(providerOperations.runId, queued.runId))).length).toBe(8);
});

test("rejects a deterministic fixture as a measured review-round comparison", async () => {
  const suite = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"), "utf8")) as unknown;
  const plan = prepareReviewRoundComparison(suite);
  const item = plan.cases.find((candidate) => candidate.effectiveRiskProfile === "standard");
  expect(item).toBeDefined();
  const queued = await enqueueDurableRun({ ...request(), question: item!.question, reviewRounds: 0 });
  createdRunIds.push(queued.runId);
  await executeDurableRun(queued.runId);
  item!.runIds["0"] = queued.runId;
  await expect(inspectStoredReviewRoundComparison(suite, plan)).rejects.toThrow("koşuları");
  item!.runIds["0"] = randomUUID();
  await expect(inspectStoredReviewRoundComparison(suite, plan)).rejects.toThrow("sahibinin tamamlanmış");
});

test("inspects matched offline provider receipts without treating their counters as accuracy", async () => {
  const suite = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"), "utf8")) as unknown;
  const plan = prepareReviewRoundComparison(suite);
  const item = plan.cases.find((candidate) => candidate.effectiveRiskProfile === "standard");
  expect(item).toBeDefined();
  const model = "offline-comparison-fixture";
  const connection = await saveProviderConnection({
    provider: "openai-compatible", label: `Review comparison ${randomUUID()}`, apiKey: "",
    defaultModel: model, baseUrl: "http://127.0.0.1:11434/v1", endpointPreset: "ollama",
    reasoningProtocol: "none", structuredOutputMode: "json-object",
  });
  createdComparisonConnectionIds.push(connection.id);
  const members = defaultFakeCouncilMembers.map((member) => ({
    ...member, provider: "openai-compatible" as const, model, connectionId: connection.id,
  }));
  for (const roundLimit of [0, 1, 2, 3] as const) {
    const queued = await enqueueDurableRun({
      ...request(), question: item!.question, providerMode: "remote", members, reviewRounds: roundLimit,
    });
    createdRunIds.push(queued.runId);
    const finished = await executeDurableRun(queued.runId, async (work) => {
      const providers = work.members.map((member, index) => {
        const fake = new FakeProvider({ id: member.id, label: member.label, role: member.role,
          councilRole: member.councilRole, perspective: index === 0 ? "procedural" : "risk", delayMs: 1 });
        const offline: TextProvider = { id: fake.id, label: fake.label, role: member.role,
          councilRole: fake.councilRole, async generate(input) {
            const result = await fake.generate(input);
            return { ...result, metadata: { provider: member.provider, model: member.model,
              remoteResponseId: `fixture-${input.round}`, inputTokens: 12, outputTokens: 7 } };
          } };
        return new ReceiptTrackedProvider(work.runId, member.provider, member.model, "off", offline, member.role);
      });
      return executeCouncil({ snapshotId: work.snapshotId, question: work.question }, providers, work.reviewRounds, work.members);
    });
    expect(finished?.status).toBe("completed");
    item!.runIds[String(roundLimit) as "0" | "1" | "2" | "3"] = queued.runId;
  }
  const inspection = await inspectStoredReviewRoundComparison(suite, plan);
  expect(inspection.pairingStatus).toBe("incomplete"); // Other source questions remain unrun.
  expect(inspection.accuracyStatus).toBe("human_review_pending");
  expect(inspection.observations.map((observation) => observation.roundLimit)).toEqual([0, 1, 2, 3]);
  expect(inspection.observations.map((observation) => observation.reportedInputTokens)).toEqual([24, 48, 72, 96]);
  expect(inspection.observations.every((observation) => observation.executionMs >= 0)).toBe(true);
  await getDatabase().update(providerOperations).set({ inputTokens: null })
    .where(and(eq(providerOperations.runId, item!.runIds["3"]!), eq(providerOperations.round, 3)));
  const missingUsage = await inspectStoredReviewRoundComparison(suite, plan);
  expect(missingUsage.observations.find((observation) => observation.roundLimit === 3)?.reportedInputTokens).toBeNull();
  const last = await findDurableRunById(item!.runIds["3"]!);
  const alteredReport = structuredClone(last!.report!);
  alteredReport.reviewPromptPlans![0]!.fingerprint = "0".repeat(64);
  await getDatabase().update(runs).set({ reportCiphertext: encryptJson(alteredReport, `run:${last!.runId}:report`) })
    .where(eq(runs.id, last!.runId));
  await expect(inspectStoredReviewRoundComparison(suite, plan)).rejects.toThrow("inceleme istemi");
});

test("selected-member follow-up preserves source and bills only one new initial attempt", async () => {
  const connection = await saveProviderConnection({
    provider: "openai-compatible", label: `Rerun fixture ${randomUUID()}`, apiKey: "",
    defaultModel: "offline-rerun-fixture", baseUrl: "http://127.0.0.1:11434/v1", endpointPreset: "ollama",
    reasoningProtocol: "none", structuredOutputMode: "json-object",
  });
  createdComparisonConnectionIds.push(connection.id);
  const members = defaultFakeCouncilMembers.map((member) => ({
    ...member, provider: "openai-compatible" as const, model: "offline-rerun-fixture", connectionId: connection.id,
  }));
  const source = await enqueueDurableRun({ ...request(), providerMode: "remote", members, reviewRounds: 1 });
  createdRunIds.push(source.runId);
  const offlineExecutor = async (work: Parameters<NonNullable<Parameters<typeof executeDurableRun>[1]>>[0]) => {
    const providers = work.members.map((member, index) => {
      const fake = new FakeProvider({ id: member.id, label: member.label, role: member.role,
        councilRole: member.councilRole, perspective: index === 0 ? "procedural" : "risk", delayMs: 1 });
      const offline: TextProvider = { id: fake.id, label: fake.label, role: member.role,
        councilRole: fake.councilRole, async generate(input) {
          const output = await fake.generate(input);
          return { ...output, metadata: { provider: member.provider, model: member.model,
            remoteResponseId: `offline-${input.round}`, inputTokens: 11, outputTokens: 5 } };
        } };
      return new ReceiptTrackedProvider(work.runId, member.provider, member.model, "off", offline, member.role);
    });
    return executeCouncil({ snapshotId: work.snapshotId, question: work.question },
      providers, work.reviewRounds, work.members, work.selfRevisionEnabled, work.reusedInitialResults);
  };
  const sourceFinished = await executeDurableRun(source.runId, offlineExecutor);
  expect(sourceFinished?.status).toBe("completed");
  const key = randomUUID();
  const children = await Promise.all(Array.from({ length: 4 }, () =>
    enqueueSelectedMemberRerun({ sourceRunId: source.runId, memberId: members[1]!.id, idempotencyKey: key })));
  const child = children[0]!;
  expect(new Set(children.map((item) => item.runId)).size).toBe(1);
  createdRunIds.push(child.runId);
  expect(child.followUp).toMatchObject({ sourceRunId: source.runId, rerunMemberId: members[1]!.id,
    reusedMemberIds: [members[0]!.id], maximumProviderCalls: 3 });
  expect((await enqueueSelectedMemberRerun({ sourceRunId: source.runId, memberId: members[1]!.id, idempotencyKey: key })).runId).toBe(child.runId);
  await expect(enqueueSelectedMemberRerun({ sourceRunId: source.runId, memberId: "not-a-member", idempotencyKey: randomUUID() }))
    .rejects.toBeInstanceOf(FollowUpUnavailableError);
  const finished = await executeDurableRun(child.runId, offlineExecutor);
  expect(finished?.status).toBe("completed");
  expect(finished?.report?.memberResults.find((result) => result.memberId === members[0]!.id)?.reusedFromRunId).toBe(source.runId);
  expect(finished?.report?.memberResults.find((result) => result.memberId === members[1]!.id)?.reusedFromRunId).toBeUndefined();
  expect(finished?.report?.reviews).toHaveLength(2);
  const childOperations = await getDatabase().select({ memberId: providerOperations.memberId, round: providerOperations.round })
    .from(providerOperations).where(eq(providerOperations.runId, child.runId));
  expect(childOperations).toHaveLength(3);
  expect(childOperations.filter((operation) => operation.round === 0).map((operation) => operation.memberId)).toEqual([members[1]!.id]);
  expect((await findDurableRunById(source.runId))?.report?.memberResults.every((result) => !result.reusedFromRunId)).toBe(true);
  const auditClient = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await auditClient.connect();
    expect((await auditRestoredEncryption(auditClient)).decryptedValues).toBeGreaterThan(0);
  } finally {
    await auditClient.end();
  }
});

test("scores only a persisted council report with the matching frozen question", async () => {
  const queued = await enqueueDurableRun(request());
  createdRunIds.push(queued.runId);
  const finished = await executeDurableRun(queued.runId);
  const occurrence = [...(finished?.report?.sharedClaims ?? []), ...(finished?.report?.distinctClaims ?? [])]
    .flatMap((claim) => claim.occurrences)[0];
  expect(occurrence).toBeDefined();
  const sourceText = occurrence!.statement;
  const corpus = {
    schemaVersion: "council-coverage-v1",
    description: "Yerel kayıttan yüklenen rapor bağlama testi",
    cases: [{
      id: "case-persisted", sourceId: "source-persisted", split: "development", language: "tr",
      riskTags: ["condition"], question: queued.question, sourceText,
      goldClaims: [{
        id: "gold-persisted", statement: sourceText, critical: true,
        evidenceSpans: [{ start: 0, end: sourceText.length, text: sourceText }],
      }],
    }],
  };
  const assessment = {
    schemaVersion: "council-coverage-assessment-v1",
    cases: [{ caseId: "case-persisted", status: "assessed", runId: queued.runId, reviewerId: "fixture-reviewer", judgments: [{
      goldClaimId: "gold-persisted", decision: "represented", occurrenceIds: [occurrence!.occurrenceId],
      rationale: "Sentetik kaynak ve kaydedilmiş iddia birebir eşleşiyor.",
    }] }],
  };

  expect((await evaluateStoredCouncilCoverage(corpus, assessment)).overall.recallLowerBound).toBe(1);
  const changedQuestion = structuredClone(corpus);
  changedQuestion.cases[0]!.question += " Ek soru";
  await expect(evaluateStoredCouncilCoverage(changedQuestion, assessment)).rejects.toThrow("run sorusuyla");
  const unknownRun = structuredClone(assessment);
  unknownRun.cases[0]!.runId = randomUUID();
  await expect(evaluateStoredCouncilCoverage(corpus, unknownRun)).rejects.toThrow("tamamlanmış ve raporlu");
});

test("binds acceptance measurement to source, remote receipts, frozen settings and owner scope without calling a provider", async () => {
  const corpus = councilCoverageCorpusSchema.parse({ schemaVersion: "council-coverage-v1", description: "Persistence binding fixture only",
    cases: [{ id: "case-measured", sourceId: "source-measured", split: "held_out", language: "en", riskTags: ["condition"],
      question: "What does the supplied source say?", sourceText: "Permit denied.", goldClaims: [{ id: "gold-permit", statement: "Permit denied.", critical: true,
        evidenceSpans: [{ start: 0, end: 14, text: "Permit denied." }] }] }] });
  const question = renderCouncilCoverageQuestion(corpus.cases[0]!);
  const queued = await enqueueDurableRun({ ...request(), question });
  createdRunIds.push(queued.runId);
  await executeDurableRun(queued.runId);
  const mapping = { schemaVersion: "council-measurement-run-map-v1", corpusSha256: sha256(JSON.stringify(corpus)),
    cases: [{ caseId: "case-measured", runId: queued.runId }] };
  await expect(loadStoredCouncilMeasurementRuns(corpus, mapping)).rejects.toThrow("Fixture");
  // Fixture-only SQL projection: never enqueue remote work or read a saved key.
  const members = defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible" as const, connectionId: randomUUID(), model: `offline-fixture-${member.id}` }));
  const prompt = buildRoundZeroPromptPlan({ question, members, memoryContext: [], toolContext: [], images: [], documents: [] });
  const remoteValues = { providerMode: "remote", membersCiphertext: encryptJson(members, `run:${queued.runId}:members`),
    promptVersion: prompt.version, promptFingerprint: prompt.fingerprint };
  try {
    await getDatabase().update(runs).set(remoteValues).where(eq(runs.id, queued.runId));
    await expect(loadStoredCouncilMeasurementRuns(corpus, mapping)).rejects.toThrow("işlem kaydı");
    for (const member of members) {
      const receipt = await prepareProviderOperation({ runId: queued.runId, memberId: member.id, provider: member.provider,
        model: member.model, requestFingerprint: "fixture-measurement", round: 0 });
      await updateProviderOperation(receipt.id, { status: "succeeded" });
    }
    const measured = await loadStoredCouncilMeasurementRuns(corpus, mapping);
    expect(measured.reports).toHaveLength(1);
    expect(measured.observations[0]).toMatchObject({ reportedInputTokens: null, reportedOutputTokens: null });
    const changed = structuredClone(corpus); changed.cases[0]!.sourceText += " Additional condition.";
    await expect(loadStoredCouncilMeasurementRuns(changed, { ...mapping, corpusSha256: sha256(JSON.stringify(changed)) })).rejects.toThrow("Soru ve kaynak");
    await getDatabase().update(runs).set({ memoryEntryCount: 1 }).where(eq(runs.id, queued.runId));
    await expect(loadStoredCouncilMeasurementRuns(corpus, mapping)).rejects.toThrow("ek kaynak");
    await getDatabase().update(runs).set({ memoryEntryCount: 0, promptFingerprint: "f".repeat(64) }).where(eq(runs.id, queued.runId));
    await expect(loadStoredCouncilMeasurementRuns(corpus, mapping)).rejects.toThrow("istem sürümü");
    await getDatabase().update(runs).set({ promptFingerprint: prompt.fingerprint, ownerId: "other-fixture-owner" }).where(eq(runs.id, queued.runId));
    await expect(loadStoredCouncilMeasurementRuns(corpus, mapping)).rejects.toThrow("kalıcı rapor");
  } finally {
    const originalPrompt = buildRoundZeroPromptPlan({ question, members: defaultFakeCouncilMembers, memoryContext: [], toolContext: [], images: [], documents: [] });
    await getDatabase().update(runs).set({ ownerId: LOCAL_OWNER_ID, providerMode: "fake", memoryEntryCount: 0,
      membersCiphertext: encryptJson(defaultFakeCouncilMembers, `run:${queued.runId}:members`), promptFingerprint: originalPrompt.fingerprint }).where(eq(runs.id, queued.runId));
    await cancelDurableRun(queued.runId);
  }
});

test("encrypts malformed provider text and keeps it only in failed-member details", async () => {
  const raw = '{"summary":"Bu yanıtın iddia alanı yok"}';
  const queued = await enqueueDurableRun(request());
  createdRunIds.push(queued.runId);
  const operation = await prepareProviderOperation({
    runId: queued.runId,
    memberId: "malformed-member",
    provider: "fixture",
    model: "malformed-fixture",
    requestFingerprint: "a".repeat(64),
  });
  await updateProviderOperation(operation.id, {
    status: "failed",
    errorCode: "provider_response_invalid",
    rawText: raw,
  });
  expect(await loadProviderOperationFailureRawText(operation.id)).toBe(raw);
  const [storedOperation] = await getDatabase().select().from(providerOperations).where(eq(providerOperations.id, operation.id));
  expect(storedOperation?.rawTextCiphertext).toBeTruthy();
  expect(storedOperation?.rawTextCiphertext).not.toContain(raw);
  expect(storedOperation?.parsedOutputCiphertext).toBeNull();

  const finished = await executeDurableRun(queued.runId, async () => buildCouncilReport([], [{
    memberId: "malformed-member",
    label: "Geçersiz üye",
    councilRole: "analyst",
    code: "provider_response_invalid",
    message: "Sağlayıcı geçerli konsey JSON çıktısı üretmedi.",
    rawText: raw,
  }]));
  expect(finished?.status).toBe("failed");
  expect(finished?.report?.failures[0]?.rawText).toBe(raw);
  expect(finished?.report?.sharedClaims).toHaveLength(0);
  const [storedRun] = await getDatabase().select().from(runs).where(eq(runs.id, queued.runId));
  expect(storedRun?.reportCiphertext).not.toContain(raw);
  const [storedMember] = await getDatabase().select().from(modelRuns).where(eq(modelRuns.runId, queued.runId));
  expect(storedMember?.rawText).toBe("[encrypted]");
  expect(storedMember?.rawTextCiphertext).not.toContain(raw);
  expect(storedMember?.parsedOutputCiphertext).toBeNull();
});

test("replays a failed malformed response without another provider call", async () => {
  const queued = await enqueueDurableRun(request());
  createdRunIds.push(queued.runId);
  const raw = '{"summary":"İddia alanı eksik"}';
  let calls = 0;
  const delegate: TextProvider = {
    id: "malformed-member",
    label: "Geçersiz üye",
    councilRole: "analyst",
    async generate() {
      calls += 1;
      throw new NormalizedProviderError("Geçersiz JSON", "provider_response_invalid", "known", false, raw);
    },
  };
  const tracked = new ReceiptTrackedProvider(queued.runId, "fixture", "malformed-fixture", "off", delegate);
  const input = {
    memberId: delegate.id,
    role: "analyst",
    councilRole: "analyst" as const,
    input: { snapshotId: queued.snapshotId, question: queued.question },
    round: 0 as const,
  };
  await expect(tracked.generate(input)).rejects.toMatchObject({ code: "provider_response_invalid", rawText: raw });
  await expect(tracked.generate(input)).rejects.toMatchObject({ code: "provider_response_invalid", rawText: raw });
  expect(calls).toBe(1);
});

test("claims a prepared receipt once and sends one call across concurrent workers", async () => {
  const queued = await enqueueDurableRun(request());
  createdRunIds.push(queued.runId);
  const claimOnly = await prepareProviderOperation({
    runId: queued.runId,
    memberId: "claim-race-fixture",
    provider: "fixture",
    model: "fixture-model",
    requestFingerprint: fingerprintProviderRequest({ claimRace: true }),
  });
  const claims = await Promise.all(Array.from({ length: 8 }, () =>
    claimProviderOperationSubmission(claimOnly.id)));
  expect(claims.filter(Boolean)).toHaveLength(1);

  const input = {
    memberId: "concurrent-fixture",
    role: "analyst",
    councilRole: "analyst" as const,
    input: { snapshotId: queued.snapshotId, question: queued.question },
    round: 0 as const,
  };
  const operation = await prepareProviderOperation({
    runId: queued.runId,
    memberId: input.memberId,
    provider: "fixture",
    model: "fixture-model",
    requestFingerprint: fingerprintProviderRequest({
      memberId: input.memberId,
      role: input.role,
      councilRole: input.councilRole,
      input: input.input,
      round: input.round,
      provider: "fixture",
      model: "fixture-model",
      webSearchMode: "off",
    }),
  });
  let calls = 0;
  const delegate: TextProvider = {
    id: input.memberId,
    label: "Eşzamanlı üye",
    councilRole: "analyst",
    async generate() {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        rawText: '{"summary":"Özet","claims":[{"statement":"İddia","kind":"recommendation","quote":"İddia"}]}',
        parsed: {
          summary: "Özet",
          claims: [{ statement: "İddia", kind: "recommendation", quote: "İddia" }],
        },
        metadata: { provider: "fixture", model: "fixture-model", remoteResponseId: "offline-result" },
      };
    },
  };
  const tracked = new ReceiptTrackedProvider(queued.runId, "fixture", "fixture-model", "off", delegate);
  const outcomes = await Promise.allSettled([tracked.generate(input), tracked.generate(input)]);
  expect(calls).toBe(1);
  expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
  expect((await loadProviderOperationResult(operation.id))?.metadata.remoteResponseId)
    .toBe("offline-result");
  await cancelDurableRun(queued.runId);
});

test("fences overlapping run executors and releases the fence after a failed attempt", async () => {
  const queued = await enqueueDurableRun(request());
  createdRunIds.push(queued.runId);
  const report = await executeFakeCouncil(
    { snapshotId: queued.snapshotId, question: queued.question },
    "success",
    defaultFakeCouncilMembers,
    1,
  );
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let executions = 0;
  const first = executeDurableRun(queued.runId, async () => {
    executions += 1;
    entered();
    await blocked;
    return report;
  });
  await started;
  try {
    const overlapping = await executeDurableRun(queued.runId, async () => {
      executions += 1;
      throw new Error("Overlapping executor must not run.");
    });
    expect(overlapping?.status).toBe("running");
    expect(overlapping?.report).toBeNull();
    expect(executions).toBe(1);
  } finally {
    release();
  }
  expect((await first)?.status).toBe("completed");
  expect((await listDurableRunEvents(queued.runId, 0))?.events.map((event) => event.type))
    .toEqual(["run.queued", "run.running", "run.finished"]);

  const retry = await enqueueDurableRun(request());
  createdRunIds.push(retry.runId);
  await expect(executeDurableRun(retry.runId, async () => {
    throw new Error("Offline fixture failure");
  })).rejects.toThrow("Offline fixture failure");
  expect((await findDurableRunById(retry.runId))?.status).toBe("running");
  expect((await executeDurableRun(retry.runId))?.status).toBe("completed");
  await cancelDurableRun(queued.runId);
  await cancelDurableRun(retry.runId);
});

test("persists queued, cancelled, completed and partial council runs", async () => {
  const cancelled = await enqueueDurableRun(request());
  createdRunIds.push(cancelled.runId);
  expect(cancelled.status).toBe("queued");
  expect((await cancelDurableRun(cancelled.runId))?.status).toBe("cancelled");
  expect((await findDurableRunById(cancelled.runId))?.report).toBeNull();

  const recoverable = await enqueueDurableRun(request());
  createdRunIds.push(recoverable.runId);
  // Earlier direct-execution fixtures must not delay the queue-recovery assertion.
  for (const runId of createdRunIds) if (runId !== recoverable.runId) await cancelDurableRun(runId);
  await closeBoss();
  const boss = await getBoss();
  await boss.work<{ runId: string }>(RUN_COUNCIL_QUEUE, {
    pollingIntervalSeconds: 0.5,
    notifyPollingIntervalSeconds: 1,
  }, async ([job]) => {
    if (job) await executeDurableRun(job.data.runId);
  });
  expect((await waitForTerminal(recoverable.runId)).status).toBe("completed");

  const successRequest = request();
  const attachmentBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  successRequest.attachments = Array.from({ length: 6 }, (_, index) => ({
    name: `integration-${index}.png`,
    mimeType: "image/png" as const,
    dataBase64: attachmentBytes.toString("base64"),
    sha256: createHash("sha256").update(attachmentBytes).digest("hex"),
  }));
  const invalidBytes = Buffer.from("not-an-image");
  await expect(enqueueDurableRun({ ...successRequest, attachments: [{
    name: "invalid.png", mimeType: "image/png", dataBase64: invalidBytes.toString("base64"),
    sha256: createHash("sha256").update(invalidBytes).digest("hex"),
  }] })).rejects.toThrow("dosya biçimi içerikle eşleşmiyor");
  const queued = await enqueueDurableRun(successRequest);
  createdRunIds.push(queued.runId);
  const repeated = await enqueueDurableRun(successRequest);
  expect(repeated.runId).toBe(queued.runId);
  await expect(
    enqueueDurableRun({ ...successRequest, question: `${successRequest.question} değişti` }),
  ).rejects.toBeInstanceOf(IdempotencyConflictError);

  const completed = await waitForTerminal(queued.runId);
  expect(completed.status).toBe("completed");
  expect(completed.report?.memberResults).toHaveLength(2);
  expect(completed.report?.reviews).toHaveLength(2);
  expect(completed.report?.sharedClaims.length).toBeGreaterThan(0);
  expect(completed.report?.reportQuality).toMatchObject({
    version: "report-quality-v1",
    presentation: "mechanical_claim_ledger",
    mechanicalIntegrity: true,
    semanticValidation: "not_run",
  });
  expect(completed.report?.reportQuality?.includedWithoutVerifiedEvidenceClaimIds.length).toBeGreaterThan(0);
  expect(completed.attachmentCount).toBe(6);
  const [storedRun] = await getDatabase().select().from(runs).where(eq(runs.id, queued.runId));
  expect(storedRun?.question).toBe("[encrypted]");
  expect(storedRun?.questionCiphertext).not.toContain(successRequest.question);
  expect(storedRun?.report).toBeNull();
  expect(storedRun?.reportCiphertext).toBeTruthy();
  expect(storedRun?.membersCiphertext).toBeTruthy();
  expect(storedRun?.membersCiphertext).not.toContain("Analist A");
  expect(storedRun?.memberCount).toBe(2);
  expect(storedRun?.attachmentCount).toBe(6);
  expect(storedRun?.attachmentsCiphertext).toBeTruthy();
  expect(storedRun?.attachmentsCiphertext).not.toContain(attachmentBytes.toString("base64"));
  const storedModelRuns = await getDatabase()
    .select({ round: modelRuns.round })
    .from(modelRuns)
    .where(eq(modelRuns.runId, queued.runId));
  expect(storedModelRuns.filter((item) => item.round === 1)).toHaveLength(2);
  const replay = await listDurableRunEvents(queued.runId, 1);
  expect(replay?.events.map((event) => [event.sequence, event.type])).toEqual([
    [2, "run.running"],
    [3, "run.finished"],
  ]);

  const duplicate = await executeDurableRun(queued.runId);
  expect(duplicate?.status).toBe("completed");
  expect((await listDurableRunEvents(queued.runId, 0))?.events).toHaveLength(3);

  const sharedClaim = completed.report?.sharedClaims[0];
  expect(sharedClaim?.evidenceState).toBe("unsupported");
  const contextClaims = [...(completed.report?.sharedClaims ?? []), ...(completed.report?.distinctClaims ?? [])];
  expect(contextClaims.length).toBeGreaterThanOrEqual(2);
  const scoped = await updateDurableClaimScope(queued.runId, contextClaims[0]!.claimId, "  Yalnızca test koşulunda  ");
  expect([...scoped!.report!.sharedClaims, ...scoped!.report!.distinctClaims].find((claim) => claim.claimId === contextClaims[0]!.claimId)?.scopeNote).toBe("Yalnızca test koşulunda");
  const related = await saveDurableClaimRelation(queued.runId, {
    fromClaimId: contextClaims[0]!.claimId,
    toClaimId: contextClaims[1]!.claimId,
    kind: "qualifies",
    note: "Bu kapsamda geçerli",
  });
  expect(related?.report?.claimRelations).toMatchObject([{ kind: "qualifies", note: "Bu kapsamda geçerli" }]);
  expect(related?.report?.claimCoverage?.complete).toBe(true);
  expect((await findDurableRunById(queued.runId))?.report?.claimRelations).toHaveLength(1);
  expect((await findDurableRunById(queued.runId))?.report?.reportQuality?.version).toBe("report-quality-v1");
  const [contextStored] = await getDatabase().select().from(runs).where(eq(runs.id, queued.runId));
  expect(contextStored?.report).toBeNull();
  expect(contextStored?.reportCiphertext).not.toContain("Bu kapsamda geçerli");
  const contextEvents = await listDurableRunEvents(queued.runId, 3);
  expect(contextEvents?.events.map((event) => event.type)).toEqual(["claim.scope_updated", "claim.relation_saved"]);
  expect(JSON.stringify(contextEvents?.events)).not.toContain("Bu kapsamda geçerli");
  expect(await deleteDurableClaimRelation(queued.runId, {
    fromClaimId: contextClaims[1]!.claimId,
    toClaimId: contextClaims[0]!.claimId,
  })).toMatchObject({ report: { claimRelations: [] } });
  const evidenceSource = await saveEvidenceSource({
    runId: queued.runId,
    claimId: sharedClaim!.claimId,
    title: "Entegrasyon kanıtı",
    url: "https://example.test/integration-evidence",
    relation: "supports",
    excerpt: "Entegrasyon kaynağındaki sabit alıntı.",
    publishedAt: "2026-09-17",
    note: "Yalnızca yerel entegrasyon testi kaydı",
  });
  expect(evidenceSource?.reviewStatus).toBe("unreviewed");
  expect(evidenceSource?.freshnessStatus).toBe("unreviewed");
  expect(evidenceSource?.excerpt).toBe("Entegrasyon kaynağındaki sabit alıntı.");
  expect(evidenceSource?.capturedAt).toBeTruthy();
  const verifiedSource = await updateEvidenceSourceReview(evidenceSource!.id, {
    reviewStatus: "verified",
  });
  expect(verifiedSource?.reviewStatus).toBe("verified");
  await expect(
    updateDurableClaimEvidenceState(queued.runId, sharedClaim!.claimId, "externally-verified"),
  ).rejects.toBeInstanceOf(EvidenceRequirementError);
  const currentSource = await updateEvidenceSourceReview(evidenceSource!.id, {
    freshnessStatus: "current",
  });
  expect(currentSource?.freshnessStatus).toBe("current");
  expect(currentSource?.freshnessReviewedAt).toBeTruthy();
  expect((await listEvidenceSources(queued.runId))?.[0]?.title).toBe("Entegrasyon kanıtı");
  const [storedEvidence] = await getDatabase()
    .select()
    .from(evidenceSources)
    .where(eq(evidenceSources.id, evidenceSource!.id));
  expect(storedEvidence?.urlCiphertext).not.toContain("example.test");
  expect(storedEvidence?.excerptCiphertext).not.toContain("sabit alıntı");

  const capturedDocument = await saveResearchCapture(queued.runId, sharedClaim!.claimId, {
    requestedUrl: "https://example.org/original",
    finalUrl: "https://example.org/final",
    title: "Getirilen araştırma kaynağı",
    content: "Birinci bölüm. Kanıt için birebir seçilen cümle. Son bölüm.",
    contentType: "text/html",
    byteLength: 512,
    contentSha256: "a".repeat(64),
    redirectCount: 1,
  });
  expect(capturedDocument?.reviewStatus).toBe("unreviewed");
  const [storedCapture] = await getDatabase().select().from(researchCaptures)
    .where(eq(researchCaptures.id, capturedDocument!.id));
  expect(storedCapture?.contentCiphertext).not.toContain("birebir seçilen");
  expect(storedCapture?.finalUrlCiphertext).not.toContain("example.org");
  await expect(
    getDatabase().update(researchCaptures)
      .set({ contentCiphertext: `${storedCapture!.contentCiphertext}x` })
      .where(eq(researchCaptures.id, capturedDocument!.id)),
  ).rejects.toThrow();
  await expect(promoteResearchCapture(capturedDocument!.id, {
    relation: "supports",
    excerpt: "Yakalanan içerikte bulunmayan bir cümle.",
    note: "",
  })).rejects.toBeInstanceOf(ResearchCaptureStateError);
  const promoted = await promoteResearchCapture(capturedDocument!.id, {
    relation: "supports",
    excerpt: "Kanıt için birebir seçilen cümle.",
    note: "Uygulama yönetimli getirmeden açıkça aktarıldı.",
  });
  expect(promoted?.capture.reviewStatus).toBe("accepted");
  expect(promoted?.evidenceSourceId).toBeTruthy();
  const rejectedCapture = await saveResearchCapture(queued.runId, sharedClaim!.claimId, {
    requestedUrl: "https://example.org/rejected",
    finalUrl: "https://example.org/rejected",
    title: "Reddedilecek kaynak",
    content: "İncelenmemiş içerik",
    contentType: "text/plain",
    byteLength: 20,
    contentSha256: "b".repeat(64),
    redirectCount: 0,
  });
  expect((await rejectResearchCapture(rejectedCapture!.id))?.reviewStatus).toBe("rejected");
  await expect(promoteResearchCapture(rejectedCapture!.id, {
    relation: "context",
    excerpt: "İncelenmemiş içerik",
    note: "",
  })).rejects.toBeInstanceOf(ResearchCaptureStateError);
  await expect(
    getDatabase()
      .update(evidenceSources)
      .set({ excerptCiphertext: `${storedEvidence!.excerptCiphertext}x` })
      .where(eq(evidenceSources.id, evidenceSource!.id)),
  ).rejects.toThrow();
  const evidenceUpdated = await updateDurableClaimEvidenceState(
    queued.runId,
    sharedClaim!.claimId,
    "externally-verified",
  );
  expect(evidenceUpdated?.report?.sharedClaims[0]?.evidenceState).toBe("externally-verified");
  await expect(
    updateEvidenceSourceReview(evidenceSource!.id, { freshnessStatus: "stale" }),
  ).rejects.toBeInstanceOf(EvidenceSourceInUseError);
  await expect(deleteEvidenceSource(evidenceSource!.id)).rejects.toBeInstanceOf(
    EvidenceSourceInUseError,
  );
  const [storedClaim] = await getDatabase()
    .select({ reportClaimId: claims.reportClaimId, evidenceState: claims.evidenceState })
    .from(claims)
    .where(
      and(
        eq(claims.runId, queued.runId),
        eq(claims.reportClaimId, sharedClaim!.claimId),
      ),
    )
    .limit(1);
  expect(storedClaim).toMatchObject({
    reportClaimId: sharedClaim?.claimId,
    evidenceState: "externally-verified",
  });
  expect((await listDurableRunEvents(queued.runId, 6))?.events.map((event) => event.type)).toEqual([
    "claim.evidence_state_updated",
  ]);
  const synthesisUpdated = await updateDurableClaimSynthesisCoverage(
    queued.runId,
    sharedClaim!.claimId,
    "omitted",
  );
  expect(synthesisUpdated?.report?.sharedClaims[0]?.synthesisCoverage).toBe("omitted");
  const [coverageClaim] = await getDatabase()
    .select({ synthesisCoverage: claims.synthesisCoverage })
    .from(claims)
    .where(
      and(
        eq(claims.runId, queued.runId),
        eq(claims.reportClaimId, sharedClaim!.claimId),
      ),
    )
    .limit(1);
  expect(coverageClaim?.synthesisCoverage).toBe("omitted");
  expect((await listDurableRunEvents(queued.runId, 7))?.events.map((event) => event.type)).toEqual([
    "claim.synthesis_coverage_updated",
  ]);

  await closeDatabase();
  const reloaded = await findDurableRunById(queued.runId);
  expect(reloaded?.status).toBe("completed");
  expect(reloaded?.report?.sharedClaims[0]?.evidenceState).toBe("externally-verified");
  expect(reloaded?.report?.sharedClaims[0]?.synthesisCoverage).toBe("omitted");

  const memoryEntry = await saveMemoryEntry({
    runId: queued.runId,
    claimId: sharedClaim!.claimId,
  });
  expect(memoryEntry).toMatchObject({
    content: sharedClaim?.statement,
    evidenceState: "externally-verified",
    sourceType: "analyst-claim",
  });
  expect((await listMemoryEntries()).some((entry) => entry.id === memoryEntry?.id)).toBe(true);
  const [storedMemory] = await getDatabase()
    .select()
    .from(memoryEntries)
    .where(eq(memoryEntries.id, memoryEntry!.id));
  expect(storedMemory?.contentCiphertext).not.toContain(sharedClaim!.statement);

  const memoryRunRequest: CreateRunRequest = {
    ...request(),
    memoryEntryIds: [memoryEntry!.id],
  };
  const memoryQueued = await enqueueDurableRun(memoryRunRequest);
  createdRunIds.push(memoryQueued.runId);
  const memoryRun = await waitForTerminal(memoryQueued.runId);
  expect(memoryRun.memoryEntryCount).toBe(1);
  expect(memoryRun.report?.memberResults[0]?.parsed.summary).toContain(
    "1 geçmiş bağlam kaydı",
  );
  const [storedMemoryRun] = await getDatabase()
    .select()
    .from(runs)
    .where(eq(runs.id, memoryQueued.runId));
  expect(storedMemoryRun?.memoryContextCiphertext).toBeTruthy();
  expect(storedMemoryRun?.memoryContextCiphertext).not.toContain(sharedClaim!.statement);
  expect(await deleteMemoryEntry(memoryEntry!.id)).toBe(true);

  const partialQueued = await enqueueDurableRun(request("member-b-fails"));
  createdRunIds.push(partialQueued.runId);
  const partial = await waitForTerminal(partialQueued.runId);
  expect(partial.status).toBe("partially_completed");
  expect(partial.report?.failures).toHaveLength(1);
  expect(partial.report?.memberResults).toHaveLength(1);

  const sixMemberRequest: CreateRunRequest = {
    ...request(),
    members: [...defaultFakeCouncilMembers, ...extraMembers].map((member, index) => ({
      ...member,
      councilRole: index === 5 ? "red-team" as const : "analyst" as const,
    })),
  };
  const sixMemberQueued = await enqueueDurableRun(sixMemberRequest);
  createdRunIds.push(sixMemberQueued.runId);
  const sixMemberRun = await waitForTerminal(sixMemberQueued.runId);
  expect(sixMemberRun.memberCount).toBe(6);
  expect(sixMemberRun.report?.memberResults).toHaveLength(6);
  expect(sixMemberRun.report?.sharedClaims[0]?.occurrences).toHaveLength(5);
  expect(sixMemberRun.report?.redTeamChallenges).toHaveLength(2);
  const sixMemberRows = await getDatabase()
    .select({ councilRole: modelRuns.councilRole, round: modelRuns.round })
    .from(modelRuns)
    .where(eq(modelRuns.runId, sixMemberQueued.runId));
  expect(sixMemberRows.filter((row) => row.councilRole === "red-team")).toHaveLength(2);

  const template = await saveCouncilTemplate({
    name: `Altılı konsey ${randomUUID()}`,
    description: "Entegrasyon testi",
    members: sixMemberRequest.members!,
  });
  createdTemplateIds.push(template.id);
  expect(template.memberCount).toBe(6);
  expect((await listCouncilTemplates()).some((item) => item.id === template.id)).toBe(true);
  const [storedTemplate] = await getDatabase()
    .select()
    .from(councilTemplates)
    .where(eq(councilTemplates.id, template.id));
  expect(storedTemplate?.membersCiphertext).not.toContain("Analist A");

  const connection = await saveProviderConnection({
    provider: "openai",
    label: `Test OpenAI ${randomUUID()}`,
    apiKey: "sk-test-only-never-sent-1234567890",
    defaultModel: "test-model",
    endpointPreset: "custom",
    reasoningProtocol: "openai",
    structuredOutputMode: "json-schema",
  });
  const secondConnection = await saveProviderConnection({
    provider: "openai",
    label: `Test OpenAI secondary ${randomUUID()}`,
    apiKey: "sk-test-secondary-never-sent-1234567890",
    defaultModel: "second-test-model",
    endpointPreset: "custom",
    reasoningProtocol: "openai",
    structuredOutputMode: "json-schema",
  });
  const connectionList = await listProviderConnections();
  expect(connectionList.find((item) => item.id === connection.id)).toMatchObject({
    id: connection.id,
    configured: true,
  });
  expect(connectionList.find((item) => item.id === secondConnection.id)).toMatchObject({
    id: secondConnection.id,
    configured: true,
  });
  expect(JSON.stringify(connectionList)).not.toContain("sk-test-only");
  await saveProviderConnection({
    id: connection.id,
    provider: "openai",
    label: connection.label,
    apiKey: "",
    defaultModel: "updated-test-model",
    endpointPreset: "custom",
    reasoningProtocol: "openai",
    structuredOutputMode: "json-schema",
  });
  expect(await loadProviderConnectionSecret(connection.id)).toMatchObject({
    id: connection.id,
    provider: "openai",
    apiKey: "sk-test-only-never-sent-1234567890",
    defaultModel: "updated-test-model",
    endpointPreset: "custom",
    reasoningProtocol: "openai",
    structuredOutputMode: "json-schema",
  });
  expect(await loadProviderConnectionSecret(secondConnection.id)).toMatchObject({
    id: secondConnection.id,
    provider: "openai",
    apiKey: "sk-test-secondary-never-sent-1234567890",
    defaultModel: "second-test-model",
    endpointPreset: "custom",
    reasoningProtocol: "openai",
    structuredOutputMode: "json-schema",
  });

  const operation = await prepareProviderOperation({
    runId: completed.runId,
    memberId: "receipt-test",
    provider: "openai",
    model: "test-model",
    requestFingerprint: fingerprintProviderRequest({ question: successRequest.question }),
  });
  await updateProviderOperation(operation.id, {
    status: "succeeded",
    remoteResponseId: "resp_test",
    rawText: '{"summary":"Özet"}',
    parsedOutput: {
      summary: "Özet",
      claims: [{ statement: "İddia", kind: "recommendation", quote: "İddia" }],
    },
    metadata: {
      provider: "openai",
      model: "test-model",
      remoteResponseId: "resp_test",
      citations: [{ url: "https://example.com/provider-source", title: "Sağlayıcı kaynağı" }],
    },
  });
  expect((await loadProviderOperationResult(operation.id))?.metadata).toMatchObject({
    remoteResponseId: "resp_test",
    citations: [{ url: "https://example.com/provider-source", title: "Sağlayıcı kaynağı" }],
  });
  const [storedOperation] = await getDatabase()
    .select({ resultMetadataCiphertext: providerOperations.resultMetadataCiphertext })
    .from(providerOperations)
    .where(eq(providerOperations.id, operation.id));
  expect(storedOperation?.resultMetadataCiphertext).toBeTruthy();
  expect(storedOperation?.resultMetadataCiphertext).not.toContain("example.com/provider-source");
  const reviewOperation = await prepareProviderOperation({
    runId: completed.runId,
    memberId: "receipt-test",
    round: 1,
    provider: "openai",
    model: "test-model",
    requestFingerprint: fingerprintProviderRequest({ review: true }),
  });
  expect(reviewOperation).toMatchObject({ round: 1, attempt: 1 });
  expect(reviewOperation.id).not.toBe(operation.id);

  const discardOperation = await prepareProviderOperation({
    runId: completed.runId,
    memberId: "operator-discard-test",
    provider: "openai",
    model: "test-model",
    requestFingerprint: fingerprintProviderRequest({ action: "discard-fixture" }),
  });
  await updateProviderOperation(discardOperation.id, {
    status: "outcome_unknown",
    errorCode: "network_outcome_unknown",
  });
  expect(
    (await listProviderOperationsNeedingAction()).some(
      (item) => item.id === discardOperation.id && item.attempt === 1,
    ),
  ).toBe(true);
  const discarded = await resolveProviderOperation(discardOperation.id, "discard");
  expect(discarded).toMatchObject({
    requeued: false,
    operation: { status: "discarded", errorCode: "operator_discarded", attempt: 1 },
  });
  expect(
    (await listProviderOperationsNeedingAction()).some((item) => item.id === discardOperation.id),
  ).toBe(false);

  const retryFingerprint = fingerprintProviderRequest({ action: "retry-fixture" });
  const retryOperation = await prepareProviderOperation({
    runId: completed.runId,
    memberId: "operator-retry-test",
    provider: "openai",
    model: "test-model",
    requestFingerprint: retryFingerprint,
  });
  await updateProviderOperation(retryOperation.id, {
    status: "outcome_unknown",
    errorCode: "timeout_outcome_unknown",
  });
  const authorized = await resolveProviderOperation(retryOperation.id, "authorize_retry");
  expect(authorized).toMatchObject({
    requeued: true,
    operation: { status: "retry_authorized", attempt: 1 },
  });
  await expect(
    resolveProviderOperation(retryOperation.id, "authorize_retry"),
  ).rejects.toBeInstanceOf(ProviderOperationResolutionError);
  const secondAttempt = await prepareProviderOperation({
    runId: completed.runId,
    memberId: "operator-retry-test",
    provider: "openai",
    model: "test-model",
    requestFingerprint: retryFingerprint,
  });
  expect(secondAttempt.id).not.toBe(retryOperation.id);
  expect(secondAttempt).toMatchObject({ status: "prepared", attempt: 2 });
  expect((await waitForTerminal(completed.runId)).status).toBe("completed");
  expect(
    (await listDurableRunEvents(completed.runId, 0))?.events.some(
      (event) => event.type === "provider.retry_authorized",
    ),
  ).toBe(true);

  expect(await deleteProviderConnection(connection.id)).toBe(true);
  expect(await deleteProviderConnection(secondConnection.id)).toBe(true);
  expect(await deleteCouncilTemplate(template.id)).toBe(true);
  createdTemplateIds.splice(createdTemplateIds.indexOf(template.id), 1);
});

test("reloads repeated demo perspectives without presenting independent agreement", async () => {
  const configured = defaultFakeCouncilMembers.map((member) => ({
    ...member,
    perspective: "risk" as const,
  }));
  const queued = await enqueueDurableRun({ ...request(), members: configured, reviewRounds: 0 });
  createdRunIds.push(queued.runId);
  await executeDurableRun(queued.runId);
  const reloaded = await waitForTerminal(queued.runId);

  expect(reloaded.report?.sharedClaims).toHaveLength(0);
  expect(reloaded.report?.distinctClaims.every((claim) => claim.occurrences.length === 2)).toBe(true);
  expect(reloaded.report?.memberResults.map((member) => member.agreementSource)).toEqual([
    "fixture:deterministic-fixture-v1:risk",
    "fixture:deterministic-fixture-v1:risk",
  ]);
});

test("freezes high-risk controls and marks an incomplete red-team run partial", async () => {
  const members = [
    defaultFakeCouncilMembers[0]!,
    { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" as const },
  ];
  const input = { ...request(), riskProfile: "high" as const, members };
  const queued = await enqueueDurableRun(input);
  createdRunIds.push(queued.runId);
  expect(queued.riskProfile).toBe("high");
  await executeDurableRun(queued.runId);
  const completed = await waitForTerminal(queued.runId);
  expect(completed.status).toBe("completed");
  expect(completed.report?.riskControls).toMatchObject({ profile: "high", redTeamCompleted: true, crossReviewCompleted: true, complete: true });
  expect(completed.report?.redTeamChallenges.length).toBeGreaterThan(0);
  const [stored] = await getDatabase().select().from(runs).where(eq(runs.id, queued.runId));
  expect(stored?.riskProfile).toBe("high");
  expect(stored?.report).toBeNull();
  expect(stored?.reportCiphertext).toBeTruthy();
  await expect(enqueueDurableRun({ ...input, riskProfile: "standard" })).rejects.toBeInstanceOf(IdempotencyConflictError);

  const failedInput = { ...request("member-b-fails"), riskProfile: "high" as const, members };
  const failedQueued = await enqueueDurableRun(failedInput);
  createdRunIds.push(failedQueued.runId);
  await executeDurableRun(failedQueued.runId);
  const partial = await waitForTerminal(failedQueued.runId);
  expect(partial.status).toBe("partially_completed");
  expect(partial.report?.riskControls).toMatchObject({ redTeamCompleted: false, complete: false });
  expect(partial.report?.qualityNotice).toContain("tam değerlendirme olarak sunulamaz");
});

test("enforces and freezes automatic risk before enqueue, including stale previews and worker control drift", async () => {
  const input = { ...request(), question: "İlaç X 5 mg dozunu 35 yaş için değiştirmenin sonuçları nelerdir?", riskProfile: "standard" as const };
  await expect(enqueueDurableRun(input)).rejects.toBeInstanceOf(RiskConfigurationError);
  expect(await getDatabase().select({ id: runs.id }).from(runs).where(eq(runs.idempotencyKey, input.idempotencyKey))).toEqual([]);
  const members = [defaultFakeCouncilMembers[0]!, { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" as const }];
  const prompt = buildRoundZeroPromptPlan({ question: input.question, members, documents: [], images: [], memoryContext: [], toolContext: [] });
  const risk = buildRiskPreflight({ question: input.question, requestedProfile: "standard", promptFingerprint: prompt.fingerprint, reviewRounds: 1 });
  await expect(enqueueDurableRun({ ...input, members, expectedRiskFingerprint: "0".repeat(64) })).rejects.toBeInstanceOf(PreflightMismatchError);
  const acceptedInput = { ...input, members, expectedRiskFingerprint: risk.fingerprint };
  const queued = await enqueueDurableRun(acceptedInput);
  createdRunIds.push(queued.runId);
  expect(queued).toMatchObject({ riskProfile: "high", riskAssessment: risk.assessment });
  expect((await enqueueDurableRun(acceptedInput)).runId).toBe(queued.runId);
  const [stored] = await getDatabase().select().from(runs).where(eq(runs.id, queued.runId));
  expect(stored?.riskAssessmentCiphertext).toBeTruthy();
  expect(stored?.riskAssessmentCiphertext).not.toContain("health");
  expect((await findDurableRunById(queued.runId))?.riskAssessment).toEqual(risk.assessment);
  await executeDurableRun(queued.runId);
  expect((await waitForTerminal(queued.runId)).report?.riskControls?.complete).toBe(true);

});

test("rejects automatic-risk schedules and pauses a legacy due schedule with missing controls", async () => {
  const input = { name: "Automatic risk fixture", question: "Yatırım portföyümü nasıl seçmeliyim?", providerMode: "fake" as const,
    riskProfile: "standard" as const, reviewRounds: 0 as const, cadence: "daily" as const,
    nextRunAt: new Date(Date.now() - 60_000).toISOString(), members: defaultFakeCouncilMembers };
  await expect(createLocalSchedule(input)).rejects.toBeInstanceOf(RiskConfigurationError);
  const legacy = await createLocalSchedule({ ...input, question: "Renk paletlerini nasıl karşılaştırmalıyım?" });
  try {
    await getDatabase().update(localSchedules).set({ questionCiphertext: encryptText(input.question, `local-schedule:${legacy.id}:question`) }).where(eq(localSchedules.id, legacy.id));
    await expect(updateLocalSchedule(legacy.id, { status: "active" })).rejects.toBeInstanceOf(RiskConfigurationError);
    await getDatabase().update(localSchedules).set({ status: "active" }).where(eq(localSchedules.id, legacy.id));
    await dispatchDueLocalSchedules();
    const persisted = (await listLocalSchedules()).find((item) => item.id === legacy.id);
    expect(persisted).toMatchObject({ status: "paused", lastRunId: null, nextRunAt: input.nextRunAt });
    await getDatabase().update(localSchedules).set({ status: "active", riskProfile: "high" }).where(eq(localSchedules.id, legacy.id));
    await dispatchDueLocalSchedules();
    expect((await listLocalSchedules()).find((item) => item.id === legacy.id)).toMatchObject({ status: "paused", lastRunId: null });
  } finally { await deleteLocalSchedule(legacy.id); }
});

test("does not dispatch a scheduled decision that requires owner clarification", async () => {
  const members = [defaultFakeCouncilMembers[0]!, { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" as const }];
  const input = { name: "Missing-context schedule fixture", question: "Bu sözleşmeyi feshetmeli miyim?", providerMode: "fake" as const,
    riskProfile: "high" as const, reviewRounds: 1 as const, cadence: "daily" as const,
    nextRunAt: new Date(Date.now() - 60_000).toISOString(), members };
  await expect(createLocalSchedule(input)).rejects.toBeInstanceOf(MissingContextError);
  const legacy = await createLocalSchedule({ ...input, question: "Genel karar bağlamını nasıl değerlendirmeliyim?" });
  try {
    await getDatabase().update(localSchedules).set({ questionCiphertext: encryptText(input.question, `local-schedule:${legacy.id}:question`) }).where(eq(localSchedules.id, legacy.id));
    await expect(updateLocalSchedule(legacy.id, { status: "active" })).rejects.toBeInstanceOf(MissingContextError);
    await getDatabase().update(localSchedules).set({ status: "active" }).where(eq(localSchedules.id, legacy.id));
    expect((await dispatchDueLocalSchedules()).failed).toBeGreaterThan(0);
    expect((await listLocalSchedules()).find((item) => item.id === legacy.id)).toMatchObject({ status: "paused", lastRunId: null });
  } finally { await deleteLocalSchedule(legacy.id); }
});

test("keeps schedules paused by default and dispatches an explicitly activated due run once", async () => {
  const scheduledFor = new Date(Date.now() - 60_000);
  const schedule = await createLocalSchedule({
    name: `Integration schedule ${randomUUID()}`,
    question: "Zamanlanmış yerel konsey çalışması kalıcı biçimde sıraya alınıyor mu?",
    providerMode: "fake",
    reviewRounds: 3,
    selfRevisionEnabled: true,
    cadence: "daily",
    nextRunAt: scheduledFor.toISOString(),
    members: defaultFakeCouncilMembers,
  });
  expect(schedule.status).toBe("paused");
  expect(schedule.reviewRounds).toBe(3);
  expect(schedule.selfRevisionEnabled).toBe(true);
  expect((await dispatchDueLocalSchedules()).dispatched).toBe(0);
  await updateLocalSchedule(schedule.id, { status: "active" });
  expect((await dispatchDueLocalSchedules()).dispatched).toBe(1);
  const updated = (await listLocalSchedules()).find((item) => item.id === schedule.id);
  expect(updated?.lastRunId).toBeTruthy();
  expect(new Date(updated!.nextRunAt).getTime()).toBe(scheduledFor.getTime() + 24 * 60 * 60 * 1_000);
  if (updated?.lastRunId) {
    createdRunIds.push(updated.lastRunId);
    expect((await getDatabase().select({ reviewRounds: runs.reviewRounds, selfRevisionEnabled: runs.selfRevisionEnabled }).from(runs).where(eq(runs.id, updated.lastRunId)))[0]).toEqual({ reviewRounds: 3, selfRevisionEnabled: true });
  }
  expect((await dispatchDueLocalSchedules()).dispatched).toBe(0);
  expect(await deleteLocalSchedule(schedule.id)).toBe(true);

  const highSchedule = await createLocalSchedule({
    name: `High-risk integration schedule ${randomUUID()}`,
    question: "Yüksek riskli zamanlanmış çalışma korumalarını doğruluyor mu?",
    providerMode: "fake",
    riskProfile: "high",
    reviewRounds: 1,
    cadence: "daily",
    nextRunAt: scheduledFor.toISOString(),
    members: [defaultFakeCouncilMembers[0]!, { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" }],
  });
  expect(highSchedule.riskProfile).toBe("high");
  await updateLocalSchedule(highSchedule.id, { status: "active" });
  expect((await dispatchDueLocalSchedules()).dispatched).toBe(1);
  const highRunId = (await listLocalSchedules()).find((item) => item.id === highSchedule.id)?.lastRunId;
  expect(highRunId).toBeTruthy();
  if (highRunId) {
    createdRunIds.push(highRunId);
    expect((await findDurableRunById(highRunId))?.riskProfile).toBe("high");
  }
  expect(await deleteLocalSchedule(highSchedule.id)).toBe(true);
});

test("holds a missing-context request without a run, then resumes only after reviewed previews", async () => {
  const members = [defaultFakeCouncilMembers[0]!, { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" as const }];
  const executionLimits = { version: "dispatch-limits-v1" as const, maxProviderCalls: 4,
    maxOutputTokensPerCall: 128, maxReservedOutputTokens: 512 };
  const input: CreateRunRequest = { ...request(), question: "Bu sözleşmeyi feshetmeli miyim?", riskProfile: "high", members, executionLimits };
  await expect(enqueueDurableRun(input)).rejects.toBeInstanceOf(MissingContextError);
  const draft = await createAwaitingPreflightDraft(input);
  expect((await createAwaitingPreflightDraft(input)).id).toBe(draft.id);
  expect((await listAwaitingPreflightDrafts()).some((item) => item.id === draft.id)).toBe(true);
  expect((await getDatabase().select().from(runs).where(eq(runs.idempotencyKey, input.idempotencyKey)))).toHaveLength(0);
  const [stored] = await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, draft.id));
  expect(stored?.questionCiphertext).not.toContain(input.question);
  expect(stored?.requestCiphertext).toBeTruthy();
  await closeDatabase();

  const prepared = await preparePreflightDraft(draft.id, "answer", "Türkiye'de, 1 Eylül 2026'da imzaladım.");
  expect(prepared.question).toContain("Kullanıcının ek açıklaması");
  await expect(startPreflightDraft({ id: draft.id, choice: "answer", answer: "Türkiye'de, 1 Eylül 2026'da imzaladım.",
    expectedPromptFingerprint: "0".repeat(64), expectedRiskFingerprint: prepared.riskPreflight.fingerprint })).rejects.toBeInstanceOf(PreflightMismatchError);
  expect((await getDatabase().select().from(runs).where(eq(runs.idempotencyKey, input.idempotencyKey)))).toHaveLength(0);

  const run = await startPreflightDraft({ id: draft.id, choice: "answer", answer: "Türkiye'de, 1 Eylül 2026'da imzaladım.",
    expectedPromptFingerprint: prepared.promptPlan.fingerprint, expectedRiskFingerprint: prepared.riskPreflight.fingerprint });
  createdRunIds.push(run.runId);
  expect(run.preflightDecision).toMatchObject({ choice: "answer", originalQuestion: input.question, policyVersion: "missing-context-v1" });
  expect(run.executionLimits).toEqual(executionLimits);
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({
    limits: executionLimits, submittedCalls: 0, reservedOutputTokens: 0,
  });
  expect((await startPreflightDraft({ id: draft.id, choice: "answer", answer: "Türkiye'de, 1 Eylül 2026'da imzaladım.",
    expectedPromptFingerprint: prepared.promptPlan.fingerprint, expectedRiskFingerprint: prepared.riskPreflight.fingerprint })).runId).toBe(run.runId);
  const [consumed] = await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, draft.id));
  expect(consumed).toMatchObject({ status: "started", runId: run.runId, requestCiphertext: null, questionCiphertext: null });

  const cancelledInput = { ...input, idempotencyKey: randomUUID() };
  const cancelledDraft = await createAwaitingPreflightDraft(cancelledInput);
  expect(await cancelPreflightDraft(cancelledDraft.id)).toBe(true);
  await expect(preparePreflightDraft(cancelledDraft.id, "original")).rejects.toThrow();
  const [cancelled] = await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, cancelledDraft.id));
  expect(cancelled).toMatchObject({ status: "cancelled", requestCiphertext: null, questionCiphertext: null });
  await getDatabase().delete(preflightDrafts).where(inArray(preflightDrafts.id, [draft.id, cancelledDraft.id]));
});

test("freezes an additive prompt revision, its exact diff and local risk audit", async () => {
  const originalQuestion = "Bu proje kararını hangi kanıtlarla karşılaştırmalıyım?";
  const candidateQuestion = suggestStructuredQuestion(originalQuestion);
  const input: CreateRunRequest = { ...request(), question: candidateQuestion,
    promptRevision: { version: PROMPT_REVISION_VERSION, originalQuestion, candidateQuestion, choice: "candidate" } };
  const run = await enqueueDurableRun(input);
  createdRunIds.push(run.runId);
  expect(run.promptRevision?.revision).toEqual(input.promptRevision);
  expect(run.promptRevision?.audit).toMatchObject({ originalPreserved: true, changed: true, canSelectCandidate: true });
  expect(run.promptRevision?.audit.suffix).toContain("Kaynak veya kesinlik uydurma.");
  const [stored] = await getDatabase().select().from(runs).where(eq(runs.id, run.runId));
  expect(stored?.promptRevisionCiphertext).toBeTruthy();
  expect(stored?.promptRevisionCiphertext).not.toContain(originalQuestion);

  const omitted: CreateRunRequest = { ...request(), question: "Yalnızca kısa cevap ver.",
    promptRevision: { version: PROMPT_REVISION_VERSION, originalQuestion, candidateQuestion: "Yalnızca kısa cevap ver.", choice: "candidate" } };
  await expect(enqueueDurableRun(omitted)).rejects.toBeInstanceOf(PreflightMismatchError);
  expect((await getDatabase().select().from(runs).where(eq(runs.idempotencyKey, omitted.idempotencyKey)))).toHaveLength(0);
});

test("re-audits a clarified draft's selected revision before creating its run", async () => {
  const input: CreateRunRequest = { ...request(), question: "Bu sözleşmeyi feshetmeli miyim?", riskProfile: "high",
    members: [defaultFakeCouncilMembers[0]!, { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" }] };
  const draft = await createAwaitingPreflightDraft(input);
  try {
    const originalQuestion = "Bu sözleşmeyi feshetmeli miyim?";
    const candidateQuestion = suggestStructuredQuestion(originalQuestion);
    const promptRevision = { version: PROMPT_REVISION_VERSION, originalQuestion, candidateQuestion, choice: "candidate" } as const;
    const prepared = await preparePreflightDraft(draft.id, "original", undefined, promptRevision);
    expect(prepared.question).toBe(candidateQuestion);
    const run = await startPreflightDraft({ id: draft.id, choice: "original", promptRevision,
      expectedPromptFingerprint: prepared.promptPlan.fingerprint, expectedRiskFingerprint: prepared.riskPreflight.fingerprint });
    createdRunIds.push(run.runId);
    expect(run.preflightDecision).toMatchObject({ choice: "original", originalQuestion });
    expect(run.promptRevision?.revision).toEqual(promptRevision);
  } finally { await getDatabase().delete(preflightDrafts).where(eq(preflightDrafts.id, draft.id)); }
});
