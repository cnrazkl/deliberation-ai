import { and, asc, eq } from "drizzle-orm";
import { buildRoundZeroPromptPlan } from "@deliberation-ai/application";
import { prepareReviewRoundComparison, sha256, validateReviewRoundComparisonPlan } from "@deliberation-ai/evaluation";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { getRunProviderUsage } from "./provider-operations";
import { findDurableRunEvaluationSnapshot } from "./run-repository";
import { runEvents, runs } from "./schema";

const rounds = [0, 1, 2, 3] as const;

/** Read-only protocol check. It never interprets provider agreement as answer accuracy. */
export async function inspectStoredReviewRoundComparison(suiteInput: unknown, planInput: unknown) {
  const plan = validateReviewRoundComparisonPlan(suiteInput, planInput);
  const observations: Array<{
    caseId: string;
    roundLimit: 0 | 1 | 2 | 3;
    runId: string;
    executionMs: number;
    reportedInputTokens: number | null;
    reportedOutputTokens: number | null;
  }> = [];
  let configurationSha256: string | null = null;
  const reviewInstructionDigests = new Map<string, string>();
  let requiredSlots = 0;
  let filledSlots = 0;

  for (const item of plan.cases) {
    let caseRiskProfile: string | null = null;
    let casePromptFingerprint: string | null = null;
    for (const roundLimit of rounds) {
      if (!item.eligibleRounds.includes(roundLimit)) continue;
      requiredSlots += 1;
      const runId = item.runIds[String(roundLimit) as keyof typeof item.runIds];
      if (!runId) continue;
      filledSlots += 1;
      const snapshot = await findDurableRunEvaluationSnapshot(runId);
      if (!snapshot || snapshot.run.status !== "completed" || snapshot.run.report?.status !== "completed") {
        throw new Error("Karşılaştırma yalnızca sahibinin tamamlanmış ve eksiksiz raporunu kabul eder.");
      }
      const { run, members } = snapshot;
      const report = run.report;
      if (!report) throw new Error("Karşılaştırma için rapor gerekli.");
      if (run.question !== item.question || snapshot.reviewRounds !== roundLimit || snapshot.selfRevisionEnabled ||
          run.riskProfile !== item.effectiveRiskProfile || snapshot.providerMode !== "remote" ||
          members.some((member) => member.provider === "fake" || member.webSearchMode !== "off") ||
          run.attachmentCount !== 0 || run.memoryEntryCount !== 0 || run.toolResultCount !== 0) {
        throw new Error("Karşılaştırma koşuları soru, risk, tur, sağlayıcı veya ek bağlam bakımından eşleşmiyor.");
      }
      const prompt = buildRoundZeroPromptPlan({ question: run.question, members, documents: [], images: [], memoryContext: [], toolContext: [] });
      if (run.promptVersion !== prompt.version || run.promptFingerprint !== prompt.fingerprint) {
        throw new Error("Kaydedilmiş ilk tur istemi bu karşılaştırma koşuluyla eşleşmiyor.");
      }
      if (caseRiskProfile !== null && caseRiskProfile !== run.riskProfile ||
          casePromptFingerprint !== null && casePromptFingerprint !== run.promptFingerprint) {
        throw new Error("Aynı vakadaki ilk tur ayarları farklı.");
      }
      caseRiskProfile = run.riskProfile;
      casePromptFingerprint = run.promptFingerprint;
      const configuration = sha256(JSON.stringify({ members, promptVersion: run.promptVersion }));
      if (configurationSha256 !== null && configurationSha256 !== configuration) {
        throw new Error("Karşılaştırma boyunca model ve konsey ayarları sabit kalmalı.");
      }
      configurationSha256 = configuration;

      const execution = report.reviewExecution;
      const expectedReason = roundLimit === 0 ? "not_requested" : "round_limit";
      if (!execution || execution.requestedRounds !== roundLimit || execution.completedRounds !== roundLimit ||
          execution.stopReason !== expectedReason || report.failures.length || report.reviewFailures.length ||
          report.memberResults.length !== members.length || report.reviews.length !== members.length * roundLimit ||
          (report.reviewPromptPlans?.length ?? 0) !== members.length * roundLimit) {
        throw new Error("Karşılaştırma koşusu istenen tur ve üye kapsamını eksiksiz tamamlamamış.");
      }
      const expectedKeys = new Set(members.flatMap((member) =>
        Array.from({ length: roundLimit + 1 }, (_unused, round) => `${member.id}:${round}`)));
      const reviewKeys = new Set(report.reviews.map((review) => `${review.reviewerMemberId}:${review.round}`));
      if (reviewKeys.size !== members.length * roundLimit ||
          report.reviews.some((review) => !expectedKeys.has(`${review.reviewerMemberId}:${review.round}`))) {
        throw new Error("Kaydedilmiş incelemelerde tur veya üye kapsamı farklı.");
      }
      const promptKeys = new Set<string>();
      for (const saved of report.reviewPromptPlans ?? []) {
        const key = `${saved.reviewerMemberId}:${saved.round}`;
        const expectedVersion = saved.round === 1 ? "cross-review-v1" : "cross-review-v2";
        const expectedPeers = members.filter((member) => member.id !== saved.reviewerMemberId).map((member) => member.id);
        const fingerprint = sha256(JSON.stringify({
          version: saved.version, ...(saved.round > 1 ? { round: saved.round } : {}),
          reviewerMemberId: saved.reviewerMemberId, peerMemberIds: saved.peerMemberIds,
          instructions: saved.instructions, input: saved.input,
        }));
        if (saved.round > roundLimit || saved.version !== expectedVersion || promptKeys.has(key) ||
            !reviewKeys.has(key) || JSON.stringify(saved.peerMemberIds) !== JSON.stringify(expectedPeers) ||
            fingerprint !== saved.fingerprint) {
          throw new Error("Kaydedilmiş inceleme istemi veya tur bağı değişmiş.");
        }
        promptKeys.add(key);
        const instructionsDigest = sha256(JSON.stringify({ version: saved.version, instructions: saved.instructions }));
        const previousDigest = reviewInstructionDigests.get(key);
        if (previousDigest !== undefined && previousDigest !== instructionsDigest) {
          throw new Error("Karşılaştırmada aynı üye/tur için istem yönergeleri değişmiş.");
        }
        reviewInstructionDigests.set(key, instructionsDigest);
      }
      if (promptKeys.size !== members.length * roundLimit) {
        throw new Error("Karşılaştırmada inceleme istemi eksik.");
      }
      const usage = await getRunProviderUsage(runId);
      const membersById = new Map(members.map((member) => [member.id, member]));
      if (!usage || usage.recentOperationsTruncated || usage.operationCount !== expectedKeys.size ||
          usage.operations.length !== expectedKeys.size || usage.operations.some((operation) =>
            operation.status !== "succeeded" || operation.attempt !== 1 ||
            operation.provider !== membersById.get(operation.memberId)?.provider ||
            operation.model !== membersById.get(operation.memberId)?.model ||
            !expectedKeys.delete(`${operation.memberId}:${operation.round}`)) || expectedKeys.size !== 0) {
        throw new Error("Karşılaştırmada tekrar, belirsiz veya eksik sağlayıcı işlemi var.");
      }
      const [record] = await getDatabase().select({ finishedAt: runs.finishedAt }).from(runs)
        .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID))).limit(1);
      const starts = await getDatabase().select({ createdAt: runEvents.createdAt }).from(runEvents)
        .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "run.running")))
        .orderBy(asc(runEvents.sequence)).limit(2);
      if (!record?.finishedAt || starts.length !== 1 || !starts[0] ||
          record.finishedAt.getTime() < starts[0].createdAt.getTime()) {
        throw new Error("Karşılaştırmada tekil yürütme süresi doğrulanamıyor.");
      }
      observations.push({
        caseId: item.caseId, roundLimit, runId,
        executionMs: record.finishedAt.getTime() - starts[0].createdAt.getTime(),
        reportedInputTokens: usage.inputReportCount === usage.operationCount ? usage.reportedInputTokens : null,
        reportedOutputTokens: usage.outputReportCount === usage.operationCount ? usage.reportedOutputTokens : null,
      });
    }
  }
  return {
    schemaVersion: "review-round-comparison-inspection-v1" as const,
    suiteSha256: prepareReviewRoundComparison(suiteInput).suiteSha256,
    requiredSlots, filledSlots,
    pairingStatus: filledSlots === requiredSlots ? "complete" as const : "incomplete" as const,
    accuracyStatus: "human_review_pending" as const,
    configurationSha256,
    observations,
    scope: "Yalnızca eşit koşul, yürütme süresi ve sağlayıcının bildirdiği tokenlar; maliyet veya doğruluk ölçümü değil.",
  };
}
