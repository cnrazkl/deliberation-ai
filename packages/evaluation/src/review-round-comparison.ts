import { z } from "zod";
import { assessRequestRisk } from "@deliberation-ai/domain";
import { compileExternalCouncilIntake, renderCouncilCoverageQuestion, sha256 } from "./external-council-intake";

const runIdsSchema = z.strictObject({
  "0": z.uuid().nullable(),
  "1": z.uuid().nullable(),
  "2": z.uuid().nullable(),
  "3": z.uuid().nullable(),
});

export const reviewRoundComparisonPlanSchema = z.strictObject({
  schemaVersion: z.literal("review-round-comparison-v1"),
  suiteSha256: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(z.strictObject({
    caseId: z.string(),
    question: z.string().min(10).max(4_000),
    questionSha256: z.string().regex(/^[a-f0-9]{64}$/),
    effectiveRiskProfile: z.enum(["standard", "high"]),
    eligibleRounds: z.array(z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])).min(3).max(4),
    runIds: runIdsSchema,
  })).min(1),
});
export type ReviewRoundComparisonPlan = z.infer<typeof reviewRoundComparisonPlanSchema>;

const roundValues = [0, 1, 2, 3] as const;

/** Freezes source-inclusive questions and only the review limits allowed by the current risk floor. */
export function prepareReviewRoundComparison(suiteInput: unknown): ReviewRoundComparisonPlan {
  const { intake, manifest } = compileExternalCouncilIntake(suiteInput);
  return {
    schemaVersion: "review-round-comparison-v1",
    suiteSha256: manifest.suiteSha256,
    cases: intake.cases.map((item) => {
      const question = renderCouncilCoverageQuestion(item);
      const effectiveRiskProfile = assessRequestRisk({ question }).effectiveProfile;
      return {
        caseId: item.id,
        question,
        questionSha256: sha256(question),
        effectiveRiskProfile,
        eligibleRounds: effectiveRiskProfile === "high" ? [1, 2, 3] : [...roundValues],
        runIds: { "0": null, "1": null, "2": null, "3": null },
      };
    }),
  };
}

/** Edited plans may fill run ids, but cannot change the frozen source or policy slots. */
export function validateReviewRoundComparisonPlan(suiteInput: unknown, planInput: unknown): ReviewRoundComparisonPlan {
  const plan = reviewRoundComparisonPlanSchema.parse(planInput);
  const expected = prepareReviewRoundComparison(suiteInput);
  if (plan.suiteSha256 !== expected.suiteSha256 || plan.cases.length !== expected.cases.length) {
    throw new Error("İnceleme karşılaştırması dondurulmuş kaynak paketiyle eşleşmiyor.");
  }
  const expectedById = new Map(expected.cases.map((item) => [item.caseId, item]));
  const seenCases = new Set<string>();
  const seenRuns = new Set<string>();
  for (const item of plan.cases) {
    const source = expectedById.get(item.caseId);
    if (!source || seenCases.has(item.caseId) || item.question !== source.question ||
        item.questionSha256 !== source.questionSha256 || item.effectiveRiskProfile !== source.effectiveRiskProfile ||
        JSON.stringify(item.eligibleRounds) !== JSON.stringify(source.eligibleRounds)) {
      throw new Error("İnceleme karşılaştırmasında vaka, soru veya risk kuralı değişmiş.");
    }
    seenCases.add(item.caseId);
    for (const round of roundValues) {
      const runId = item.runIds[String(round) as keyof typeof item.runIds];
      if (!item.eligibleRounds.includes(round) && runId !== null) {
        throw new Error("Yüksek riskli vakada sıfır inceleme turu ölçülemez.");
      }
      if (runId !== null) {
        if (seenRuns.has(runId)) throw new Error("Aynı çalışma iki karşılaştırma hücresine bağlanamaz.");
        seenRuns.add(runId);
      }
    }
  }
  return plan;
}
