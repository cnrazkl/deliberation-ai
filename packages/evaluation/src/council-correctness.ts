import { z } from "zod";
import { evaluateCouncilCoverage, type CouncilCoverageCorpus, type CouncilCoverageScore, type CouncilCoverageRun } from "./council-coverage";
import { assembleAdjudicatedCouncilCoverageCorpus } from "./council-coverage-labeling";
import { compileExternalCouncilIntake, renderCouncilCoverageQuestion, sha256 } from "./external-council-intake";

// Freeze before any live measurements. Changing a rule changes this policy version.
export const COUNCIL_CORRECTNESS_POLICY = "council-correctness-v1";
export const MIN_COUNCIL_RECALL = 0.95;

export const independenceAttestationSchema = z.object({
  schemaVersion: z.literal("council-review-attestation-v1"),
  coordinatorId: z.string().trim().min(1),
  confirmedAt: z.iso.datetime(),
  labelingInputsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  independentHumans: z.literal(true),
  reviewedWithoutModelOutputs: z.literal(true),
  sourceCoverageAccepted: z.literal(true),
  rationale: z.string().trim().min(20),
}).strict();

export function prepareCouncilMeasurement(suiteInput: unknown) {
  const compiled = compileExternalCouncilIntake(suiteInput);
  return {
    schemaVersion: "council-measurement-plan-v1" as const,
    policyVersion: COUNCIL_CORRECTNESS_POLICY,
    suiteSha256: compiled.manifest.suiteSha256,
    intakeSha256: compiled.manifest.intakeSha256,
    cases: compiled.intake.cases.map((item) => {
      const question = renderCouncilCoverageQuestion(item);
      return { caseId: item.id, question, questionSha256: sha256(question), runId: null };
    }),
  };
}

export function assembleCorrectnessGold(suiteInput: unknown, reviews: [unknown, unknown], adjudication: unknown, attestation: unknown) {
  const external = compileExternalCouncilIntake(suiteInput);
  const { manifest } = external;
  if (manifest.caseCount < 40 || manifest.sourceCount < 10 || manifest.domains.length < 5 || Object.keys(manifest.byFamily).length < 10 ||
      (manifest.bySplit.development ?? 0) < 20 || (manifest.bySplit.held_out ?? 0) < 20 ||
      (manifest.byLanguage.tr ?? 0) / manifest.caseCount < 0.6 || !(manifest.byLanguage.en ?? 0) || !(manifest.byLanguage.mixed ?? 0) ||
      Object.values(manifest.byRiskTag).some((count) => count === 0)) {
    throw new Error("Dış kaynak kapsamı dondurulmuş asgari kabul matrisini karşılamıyor.");
  }
  const gold = assembleAdjudicatedCouncilCoverageCorpus(external.intake, reviews, adjudication);
  const human = independenceAttestationSchema.parse(attestation);
  if (human.labelingInputsSha256 !== gold.labelingManifestSha256) throw new Error("İnsan onayı bu etiketleme girdilerine ait değil.");
  return { ...gold, external, attestation: human };
}

export function evaluateCouncilCorrectness(
  corpus: CouncilCoverageCorpus, assessment: unknown, reports: readonly CouncilCoverageRun[],
) {
  const scores = evaluateCouncilCoverage(corpus, assessment, reports);
  const checks: Array<{ id: string; status: "passed" | "failed" | "blocked"; detail: string }> = [];
  const push = (id: string, pass: boolean, detail: string, blocked = false) =>
    checks.push({ id, status: blocked ? "blocked" : pass ? "passed" : "failed", detail });
  push("case_count", corpus.cases.length >= 40, `${corpus.cases.length}/40`);
  push("held_out_cases", corpus.cases.filter((item) => item.split === "held_out").length >= 20, "En az 20 saklı test vakası");
  const checkScore = (id: string, score: CouncilCoverageScore | undefined) => {
    push(`${id}_recall`, score?.recallLowerBound !== null && score?.recallLowerBound !== undefined && score.recallLowerBound >= MIN_COUNCIL_RECALL,
      score?.recallLowerBound === null || score?.recallLowerBound === undefined ? "Ölçüm yok" : `${score.recallLowerBound}`,
      !score || score.goldClaimCount === 0 || ((score.notAssessedCount > 0 || score.uncertainCount > 0) &&
        (score.recallUpperBound === null || score.recallUpperBound >= MIN_COUNCIL_RECALL)));
    push(`${id}_critical`, !!score && score.criticalMissingCount === 0 && score.criticalUncertainCount === 0 && score.criticalNotAssessedCount === 0,
      "Kritik kayıp veya belirsizlik sıfır olmalı", !score || (score.criticalMissingCount === 0 &&
        (score.criticalGoldClaimCount === 0 || score.criticalNotAssessedCount > 0 || score.criticalUncertainCount > 0)));
  };
  checkScore("all", scores.overall);
  const held = scores.bySplit.held_out;
  checkScore("held_out", held?.overall);
  checkScore("held_out_tr", held?.byLanguage.tr);
  checkScore("held_out_en", held?.byLanguage.en);
  checkScore("held_out_conflict", held?.byRiskTag.source_conflict);
  const status = checks.some((check) => check.status === "failed") ? "failed"
    : checks.some((check) => check.status === "blocked") ? "blocked" : "passed";
  return {
    policyVersion: COUNCIL_CORRECTNESS_POLICY, status, checks, scores,
    scope: "Source-level claim preservation on this frozen corpus only; not general factual accuracy or automatic contradiction promotion.",
  };
}
