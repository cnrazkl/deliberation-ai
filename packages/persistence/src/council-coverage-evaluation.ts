import {
  councilCoverageAssessmentSchema,
  councilCoverageCorpusSchema,
  evaluateCouncilCoverage,
  type CouncilCoverageRun,
  councilMeasurementRunMapSchema,
  renderCouncilCoverageQuestion,
  sha256,
} from "@deliberation-ai/evaluation";
import { buildRoundZeroPromptPlan } from "@deliberation-ai/application";
import { findDurableRunById, findDurableRunEvaluationSnapshot } from "./run-repository";
import { getRunProviderUsage } from "./provider-operations";

/** Stronger, source-bound acceptance path. Legacy question-only scoring stays diagnostic. */
export async function loadStoredCouncilMeasurementRuns(corpusInput: unknown, mapInput: unknown) {
  const corpus = councilCoverageCorpusSchema.parse(corpusInput);
  const mapping = councilMeasurementRunMapSchema.parse(mapInput);
  if (mapping.corpusSha256 !== sha256(JSON.stringify(corpus)) || mapping.cases.length !== corpus.cases.length ||
    new Set(mapping.cases.map((item) => item.caseId)).size !== corpus.cases.length) throw new Error("Run haritası korpusla eşleşmeli.");
  const bound = mapping.cases.filter((item) => item.runId !== null);
  if (new Set(bound.map((item) => item.runId)).size !== bound.length) throw new Error("Run birden fazla vakaya bağlanamaz.");
  const reports: CouncilCoverageRun[] = [];
  const observations: Array<{ runId: string; caseId: string; configurationSha256: string; promptFingerprint: string; reportedInputTokens: number | null; reportedOutputTokens: number | null }> = [];
  let configurationSha256: string | null = null;
  for (const entry of mapping.cases) {
    const item = corpus.cases.find((candidate) => candidate.id === entry.caseId);
    if (!item) throw new Error("Run haritasında bilinmeyen vaka.");
    if (!entry.runId) continue;
    const snapshot = await findDurableRunEvaluationSnapshot(entry.runId);
    if (!snapshot || !["completed", "partially_completed"].includes(snapshot.run.status) || !snapshot.run.report) {
      throw new Error("Ölçüm tamamlanmış kalıcı rapor gerektirir.");
    }
    const { run, members } = snapshot;
    if (run.question !== renderCouncilCoverageQuestion(item)) throw new Error("Soru ve kaynak birlikte kaydedilmiş istemle eşleşmeli.");
    if (run.attachmentCount || run.memoryEntryCount || run.toolResultCount || members.some((member) => member.webSearchMode !== "off")) {
      throw new Error("Kontrollü ölçüme ek kaynak, hafıza veya web araması karışamaz.");
    }
    if (snapshot.providerMode !== "remote" || members.some((member) => member.provider === "fake")) {
      throw new Error("Fixture çalışması canlı model ölçümü sayılamaz.");
    }
    const plan = buildRoundZeroPromptPlan({ question: run.question, members, documents: [], images: [], memoryContext: [], toolContext: [] });
    if (run.promptVersion !== plan.version || run.promptFingerprint !== plan.fingerprint) throw new Error("Ölçüm istem sürümü veya özeti değişmiş.");
    const config = sha256(JSON.stringify({ members, reviewRounds: snapshot.reviewRounds, riskProfile: run.riskProfile, promptVersion: run.promptVersion }));
    if (configurationSha256 && config !== configurationSha256) throw new Error("Bir ölçümde konsey yapılandırması sabit kalmalı.");
    configurationSha256 = config;
    const usage = await getRunProviderUsage(run.runId);
    if (!usage || usage.recentOperationsTruncated || run.report!.memberResults.some((member) =>
      !usage.operations.some((operation) => operation.memberId === member.memberId && operation.round === 0 && operation.status === "succeeded"))) {
      throw new Error("Başarılı üye için sağlayıcı işlem kaydı eksik.");
    }
    reports.push({ caseId: item.id, runId: run.runId, report: run.report! });
    observations.push({ runId: run.runId, caseId: item.id, configurationSha256: config, promptFingerprint: plan.fingerprint,
      reportedInputTokens: usage.inputReportCount === usage.operationCount ? usage.reportedInputTokens : null,
      reportedOutputTokens: usage.outputReportCount === usage.operationCount ? usage.reportedOutputTokens : null });
  }
  return { reports, observations, configurationSha256 };
}

/** Scores human judgments against reports loaded from the local owner's encrypted run records. */
export async function evaluateStoredCouncilCoverage(corpusInput: unknown, assessmentInput: unknown) {
  const corpus = councilCoverageCorpusSchema.parse(corpusInput);
  const assessment = councilCoverageAssessmentSchema.parse(assessmentInput);
  const cases = new Map(corpus.cases.map((item) => [item.id, item]));
  const reports: CouncilCoverageRun[] = [];

  for (const result of assessment.cases) {
    if (result.status !== "assessed") continue;
    const item = cases.get(result.caseId);
    if (!item) throw new Error("Değerlendirme vakası korpusta bulunmuyor.");
    const run = await findDurableRunById(result.runId);
    if (!run || !["completed", "partially_completed"].includes(run.status) || !run.report) {
      throw new Error("Değerlendirilen run tamamlanmış ve raporlu olmalı.");
    }
    if (run.question !== item.question) {
      throw new Error("Korpus sorusu kaydedilmiş run sorusuyla birebir eşleşmeli.");
    }
    reports.push({ caseId: item.id, runId: run.runId, report: run.report });
  }

  return evaluateCouncilCoverage(corpus, assessment, reports);
}
