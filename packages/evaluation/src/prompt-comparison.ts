import { z } from "zod";
import { auditPromptRevision, PROMPT_REVISION_VERSION, suggestStructuredQuestion } from "@deliberation-ai/domain";
import { compileExternalCouncilIntake, renderCouncilCoverageQuestion, sha256 } from "./external-council-intake";

export const PROMPT_COMPARISON_VERSION = "prompt-comparison-v1";
const decisionSchema = z.enum(["meaning_preserved", "material_change", "uncertain"]);
export type PromptDriftDecision = z.infer<typeof decisionSchema>;

/** This freezes inputs for a future paired study; it does not measure accuracy. */
export function preparePromptComparison(suiteInput: unknown) {
  const external = compileExternalCouncilIntake(suiteInput);
  const cases = external.intake.cases.map((item) => {
    const originalQuestion = renderCouncilCoverageQuestion(item);
    const candidateQuestion = suggestStructuredQuestion(originalQuestion);
    const audit = auditPromptRevision({
      version: PROMPT_REVISION_VERSION, originalQuestion, candidateQuestion, choice: "candidate",
    });
    if (!audit.canSelectCandidate || !audit.changed || audit.prefix || !audit.suffix) {
      throw new Error("Karşılaştırma adayı özgün soruyu aynen koruyan gerçek bir ek olmalı.");
    }
    return {
      caseId: item.id, sourceId: item.sourceId, split: item.split, language: item.language,
      originalQuestion, candidateQuestion,
      originalSha256: sha256(originalQuestion), candidateSha256: sha256(candidateQuestion),
    };
  });
  const frozen = {
    schemaVersion: PROMPT_COMPARISON_VERSION,
    suiteSha256: external.manifest.suiteSha256,
    intakeSha256: external.manifest.intakeSha256,
    candidateVersion: PROMPT_REVISION_VERSION,
    cases,
  };
  return { ...frozen, planSha256: sha256(JSON.stringify(frozen)) };
}

export type PromptComparisonPlan = ReturnType<typeof preparePromptComparison>;

export function createPromptDriftWorksheet(plan: PromptComparisonPlan, slot: "a" | "b") {
  return {
    schemaVersion: "prompt-drift-review-v1" as const,
    planSha256: plan.planSha256,
    slot,
    reviewerId: "",
    cases: plan.cases.map((item) => ({
      caseId: item.caseId, originalQuestion: item.originalQuestion, candidateQuestion: item.candidateQuestion,
      decision: null as PromptDriftDecision | null, rationale: "",
    })),
  };
}

const reviewSchema = z.object({
  schemaVersion: z.literal("prompt-drift-review-v1"),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  slot: z.enum(["a", "b"]),
  reviewerId: z.string().trim().min(1).max(120),
  cases: z.array(z.object({
    caseId: z.string(), originalQuestion: z.string(), candidateQuestion: z.string(),
    decision: decisionSchema, rationale: z.string().trim().min(15).max(2_000),
  }).strict()).min(1),
}).strict();

export function compilePromptDriftWorksheet(plan: PromptComparisonPlan, input: unknown) {
  const review = reviewSchema.parse(input);
  if (review.planSha256 !== plan.planSha256 || review.cases.length !== plan.cases.length ||
      review.cases.some((item, index) => item.caseId !== plan.cases[index]?.caseId ||
        item.originalQuestion !== plan.cases[index]?.originalQuestion ||
        item.candidateQuestion !== plan.cases[index]?.candidateQuestion)) {
    throw new Error("İnceleme dosyası dondurulmuş istem planıyla eşleşmiyor.");
  }
  return { ...review, reviewSha256: sha256(JSON.stringify(review)) };
}

type CompiledPromptDriftReview = ReturnType<typeof compilePromptDriftWorksheet>;

export function createPromptDriftAdjudication(plan: PromptComparisonPlan, a: CompiledPromptDriftReview, b: CompiledPromptDriftReview) {
  const { reviewSha256: aDigest, ...aContent } = a;
  const { reviewSha256: bDigest, ...bContent } = b;
  if (compilePromptDriftWorksheet(plan, aContent).reviewSha256 !== aDigest ||
      compilePromptDriftWorksheet(plan, bContent).reviewSha256 !== bDigest) {
    throw new Error("Derlenmiş inceleme özeti metin ve kararlarla eşleşmiyor.");
  }
  if (a.planSha256 !== plan.planSha256 || b.planSha256 !== plan.planSha256 ||
      a.slot !== "a" || b.slot !== "b" || a.reviewerId === b.reviewerId) {
    throw new Error("İki ayrı incelemeci aynı dondurulmuş planı incelemeli.");
  }
  return {
    schemaVersion: "prompt-drift-adjudication-v1" as const,
    planSha256: plan.planSha256,
    reviewerASha256: a.reviewSha256,
    reviewerBSha256: b.reviewSha256,
    adjudicatorId: "",
    cases: plan.cases.map((item, index) => ({
      caseId: item.caseId, reviewerA: a.cases[index]!.decision, reviewerB: b.cases[index]!.decision,
      finalDecision: null as PromptDriftDecision | null, rationale: "",
    })),
  };
}

const adjudicationSchema = z.object({
  schemaVersion: z.literal("prompt-drift-adjudication-v1"),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewerASha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewerBSha256: z.string().regex(/^[a-f0-9]{64}$/),
  adjudicatorId: z.string().trim().min(1).max(120),
  cases: z.array(z.object({
    caseId: z.string(), reviewerA: decisionSchema, reviewerB: decisionSchema,
    finalDecision: decisionSchema, rationale: z.string().trim().min(15).max(2_000),
  }).strict()).min(1),
}).strict();

export function compilePromptDriftAdjudication(
  plan: PromptComparisonPlan, a: CompiledPromptDriftReview, b: CompiledPromptDriftReview, input: unknown,
) {
  const expected = createPromptDriftAdjudication(plan, a, b);
  const adjudication = adjudicationSchema.parse(input);
  if (adjudication.adjudicatorId === a.reviewerId || adjudication.adjudicatorId === b.reviewerId ||
      adjudication.planSha256 !== expected.planSha256 ||
      adjudication.reviewerASha256 !== expected.reviewerASha256 ||
      adjudication.reviewerBSha256 !== expected.reviewerBSha256 ||
      adjudication.cases.length !== expected.cases.length ||
      adjudication.cases.some((item, index) => item.caseId !== expected.cases[index]?.caseId ||
        item.reviewerA !== expected.cases[index]?.reviewerA || item.reviewerB !== expected.cases[index]?.reviewerB)) {
    throw new Error("Uzlaştırma bağımsız incelemeler ve dondurulmuş planla eşleşmiyor.");
  }
  const unresolvedCount = adjudication.cases.filter((item) => item.finalDecision !== "meaning_preserved" ||
    item.reviewerA !== "meaning_preserved" || item.reviewerB !== "meaning_preserved").length;
  return { ...adjudication, adjudicationSha256: sha256(JSON.stringify(adjudication)),
    semanticStatus: unresolvedCount === 0 ? "declared_preserved" as const : "blocked" as const,
    unresolvedCount };
}
