import { randomUUID } from "node:crypto";
import { defaultFakeCouncilMembers, type CreateRunRequest } from "@deliberation-ai/contracts";
import type { DecisionAssessmentResult } from "@deliberation-ai/evaluation";
import { eq } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDatabase, getDatabase } from "./database";
import { saveDecisionConnection, deleteDecisionConnection } from "./decision-connections";
import {
  cancelDecisionAssessment,
  completeDecisionAssessment,
  createDecisionAssessment,
  failDecisionAssessment,
  listDecisionAssessments,
  listDecisionOperationsNeedingAction,
  prepareDecisionOperation,
  resolveDecisionOperation,
  startDecisionAssessment,
  updateDecisionOperation,
} from "./decision-assessments";
import { saveEvidenceSource } from "./evidence-sources";
import { closeBoss } from "./queue";
import {
  cancelDurableRun,
  enqueueDurableRun,
  executeDurableRun,
  findDurableRunById,
  updateDurableClaimSynthesisCoverage,
} from "./run-repository";
import {
  decisionAssessments,
  decisionConnections,
  decisionOperations,
  runs,
} from "./schema";

let createdRunId: string | undefined;
let createdConnectionId: string | undefined;

afterAll(async () => {
  if (createdRunId) {
    await cancelDurableRun(createdRunId);
    await getDatabase().delete(runs).where(eq(runs.id, createdRunId));
  }
  if (createdConnectionId) await deleteDecisionConnection(createdConnectionId);
  await closeBoss();
  await closeDatabase();
});

test("keeps Jev shadow assessments encrypted, replayable, cancellable, and isolated", async () => {
  const request: CreateRunRequest = {
    question: "Jev gölge değerlendirmesinin konsey sonucundan ayrı kaldığını doğrula",
    idempotencyKey: randomUUID(),
    scenario: "success",
    providerMode: "fake",
    reviewRounds: 0,
    memoryEntryIds: [],
    members: defaultFakeCouncilMembers,
  };
  const queuedRun = await enqueueDurableRun(request);
  createdRunId = queuedRun.runId;
  await executeDurableRun(queuedRun.runId);
  let completedRun = await findDurableRunById(queuedRun.runId);
  for (let attempt = 0; attempt < 80 &&
    (!completedRun || completedRun.status === "queued" || completedRun.status === "running"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    completedRun = await findDurableRunById(queuedRun.runId);
  }
  const claim = completedRun?.report?.sharedClaims[0];
  expect(claim).toBeDefined();
  const source = await saveEvidenceSource({
    runId: queuedRun.runId,
    claimId: claim!.claimId,
    title: "Jev entegrasyon kaynağı",
    url: "https://example.test/jev-source",
    relation: "supports",
    excerpt: "Bu alıntı yalnızca şifreli gölge değerlendirmesinde kullanılmalıdır.",
    note: "integration fixture",
  });
  expect(source).toBeDefined();
  const connection = await saveDecisionConnection({
    label: `TypeSafe test ${randomUUID()}`,
    apiKey: "typesafe-test-secret",
    defaultModel: "jev-1.13.0",
  });
  createdConnectionId = connection.id;

  const assessment = await createDecisionAssessment({
    runId: queuedRun.runId,
    claimId: claim!.claimId,
    sourceId: source!.id,
    connectionId: connection.id,
    model: "jev-1.13.0",
    mode: "shadow",
    confirmExternalShare: true,
  });
  expect(assessment.status).toBe("queued");
  expect(assessment.result).toBeNull();
  const [storedAssessment] = await getDatabase()
    .select()
    .from(decisionAssessments)
    .where(eq(decisionAssessments.id, assessment.id));
  const [storedConnection] = await getDatabase()
    .select()
    .from(decisionConnections)
    .where(eq(decisionConnections.id, connection.id));
  expect(storedAssessment?.inputCiphertext).not.toContain(claim!.statement);
  expect(storedAssessment?.inputCiphertext).not.toContain("yalnızca şifreli");
  expect(storedConnection?.secretCiphertext).not.toContain("typesafe-test-secret");

  const work = await startDecisionAssessment(assessment.id);
  expect(work?.input.claim).toBe(claim!.statement);
  expect(work?.input.sourceExcerpt).toContain("yalnızca şifreli");
  const operation = await prepareDecisionOperation({
    assessmentId: assessment.id,
    provider: "typesafe",
    model: "jev-1.13.0",
    requestFingerprint: work!.requestFingerprint,
  });
  await updateDecisionOperation(operation.id, { status: "submitted" });
  const result: DecisionAssessmentResult = {
    label: "supports",
    probabilities: {
      supports: 0.7,
      contradicts: 0.1,
      insufficient_evidence: 0.15,
      not_applicable: 0.05,
    },
    providerConfidence: 0.6,
    requestedModel: "jev-1.13.0",
    returnedModel: "jev-1.13.0",
    inputTokens: 120,
    outputTokens: 20,
  };
  await updateDecisionOperation(operation.id, { status: "succeeded", result });
  expect(await completeDecisionAssessment(assessment.id, result)).toBe(true);
  const [storedOperation] = await getDatabase()
    .select()
    .from(decisionOperations)
    .where(eq(decisionOperations.id, operation.id));
  expect(storedOperation?.resultCiphertext).toBeTruthy();
  expect(storedOperation?.resultCiphertext).not.toContain("supports");
  const completed = (await listDecisionAssessments(queuedRun.runId))?.find(
    (item) => item.id === assessment.id,
  );
  expect(completed).toMatchObject({ status: "completed", mode: "shadow", isCurrent: true });
  expect(completed?.result?.label).toBe("supports");
  expect((await findDurableRunById(queuedRun.runId))?.report?.sharedClaims[0]?.evidenceState).toBe(
    "unsupported",
  );

  await updateDurableClaimSynthesisCoverage(queuedRun.runId, claim!.claimId, "omitted");
  const stale = (await listDecisionAssessments(queuedRun.runId))?.find(
    (item) => item.id === assessment.id,
  );
  expect(stale?.isCurrent).toBe(false);
  expect(stale?.result?.label).toBe("supports");

  const cancellable = await createDecisionAssessment({
    runId: queuedRun.runId,
    claimId: claim!.claimId,
    sourceId: source!.id,
    connectionId: connection.id,
    model: "jev-1.13.0",
    mode: "shadow",
    confirmExternalShare: true,
  });
  expect(await cancelDecisionAssessment(cancellable.id)).toBe(true);
  expect(await startDecisionAssessment(cancellable.id)).toBeUndefined();

  const uncertain = await createDecisionAssessment({
    runId: queuedRun.runId,
    claimId: claim!.claimId,
    sourceId: source!.id,
    connectionId: connection.id,
    model: "jev-1.13.0",
    mode: "shadow",
    confirmExternalShare: true,
  });
  const uncertainWork = await startDecisionAssessment(uncertain.id);
  const uncertainOperation = await prepareDecisionOperation({
    assessmentId: uncertain.id,
    provider: "typesafe",
    model: "jev-1.13.0",
    requestFingerprint: uncertainWork!.requestFingerprint,
  });
  await updateDecisionOperation(uncertainOperation.id, {
    status: "outcome_unknown",
    errorCode: "network_unknown",
  });
  await failDecisionAssessment(uncertain.id, "outcome_unknown", "network_unknown");
  expect(
    (await listDecisionOperationsNeedingAction()).some(
      (item) => item.id === uncertainOperation.id,
    ),
  ).toBe(true);
  const retried = await resolveDecisionOperation(uncertainOperation.id, "authorize_retry");
  expect(retried?.requeued).toBe(true);
  const retryWork = await startDecisionAssessment(uncertain.id);
  const retryOperation = await prepareDecisionOperation({
    assessmentId: uncertain.id,
    provider: "typesafe",
    model: "jev-1.13.0",
    requestFingerprint: retryWork!.requestFingerprint,
  });
  expect(retryOperation.attempt).toBe(2);
  await updateDecisionOperation(retryOperation.id, {
    status: "failed",
    errorCode: "known_fixture_failure",
  });
  await failDecisionAssessment(uncertain.id, "failed", "known_fixture_failure");
});
