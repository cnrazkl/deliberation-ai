import { z } from "zod";
import { sha256 } from "./external-council-intake";
import { knowledgeEvaluationPlanSchema } from "./knowledge-evaluation";
import { councilCoverageIntakeSchema, compileCouncilCoverageReviewWorksheet, compileCouncilCoverageAdjudicationWorksheet } from "./council-coverage-labeling";
import { compileKnowledgeFormatAdjudicationWorksheet } from "./knowledge-format-adjudication";

export type KnowledgeReviewInputs = {
  textReviews: readonly [unknown, unknown]; textAdjudication: unknown;
  formatReviews: readonly [unknown, unknown]; formatAdjudication: unknown;
};

/** Caller verifies frozen intake/protocol/binary extraction before binding human evidence. */
function bindReviews(planInput: unknown, intake: unknown, extractionText: string, inputs: KnowledgeReviewInputs) {
  const plan = knowledgeEvaluationPlanSchema.parse(planInput);
  if (sha256(JSON.stringify(councilCoverageIntakeSchema.parse(intake))) !== plan.intakeSha256) {
    throw new Error("Text intake differs from the frozen knowledge plan.");
  }
  const textReviews = inputs.textReviews.map((input, index) => {
    if (typeof input !== "object" || input === null || !("slot" in input) || input.slot !== (index === 0 ? "a" : "b")) {
      throw new Error("Original text reviewer slots are required.");
    }
    return compileCouncilCoverageReviewWorksheet(intake, input);
  });
  const text = compileCouncilCoverageAdjudicationWorksheet(intake, textReviews, inputs.textAdjudication);
  if (JSON.stringify(text.corpus.cases.map((item) => item.id)) !== JSON.stringify(plan.caseIds)) {
    throw new Error("Text adjudication cohort differs from the frozen knowledge plan.");
  }
  const format = compileKnowledgeFormatAdjudicationWorksheet(plan, extractionText, inputs.formatReviews, inputs.formatAdjudication);
  return { planSha256: sha256(JSON.stringify(plan)), extractionFileSha256: sha256(extractionText),
    textLabelingManifestSha256: text.labelingManifestSha256, textCorpusSha256: text.manifestSha256,
    formatAdjudicationSha256: sha256(JSON.stringify(format)),
    textCaseCount: text.corpus.cases.length, formatCaseCount: format.cases.length,
    participants: { textReviewers: textReviews.map((review) => review.reviewerId), textAdjudicator: text.adjudication.adjudicatorId,
      formatReviewers: format.reviews.map((review) => review.reviewerId), formatAdjudicator: format.adjudicatorId } };
}

export function createKnowledgeReviewAttestationWorksheet(
  plan: unknown, intake: unknown, extractionText: string, inputs: KnowledgeReviewInputs,
) {
  const bindings = bindReviews(plan, intake, extractionText, inputs);
  return { schemaVersion: "knowledge-review-attestation-v1" as const,
    bindingSha256: sha256(JSON.stringify(bindings)), bindings, coordinatorId: "", reviewedAt: null,
    independenceConfirmed: null, coverageAdequate: null, limitationsAcknowledged: null, rationale: "" };
}

const attestationSchema = z.object({
  schemaVersion: z.literal("knowledge-review-attestation-v1"), bindingSha256: z.string().regex(/^[a-f0-9]{64}$/),
  bindings: z.unknown(), coordinatorId: z.string().trim().min(1).max(120), reviewedAt: z.iso.datetime(),
  independenceConfirmed: z.boolean(), coverageAdequate: z.boolean(), limitationsAcknowledged: z.literal(true),
  rationale: z.string().trim().min(20).max(4_000),
}).strict();

export function compileKnowledgeReviewAttestationWorksheet(
  plan: unknown, intake: unknown, extractionText: string, inputs: KnowledgeReviewInputs, input: unknown,
) {
  const form = attestationSchema.parse(input);
  const expected = createKnowledgeReviewAttestationWorksheet(plan, intake, extractionText, inputs);
  if (form.bindingSha256 !== expected.bindingSha256 || sha256(JSON.stringify(form.bindings)) !== expected.bindingSha256) {
    throw new Error("Attestation is for different frozen human evidence.");
  }
  return { schemaVersion: "knowledge-compiled-review-attestation-v1" as const,
    bindingSha256: expected.bindingSha256, bindings: expected.bindings,
    attestationWorksheetSha256: sha256(JSON.stringify(form)), coordinatorId: form.coordinatorId, reviewedAt: form.reviewedAt,
    independenceConfirmed: form.independenceConfirmed, coverageAdequate: form.coverageAdequate,
    limitationsAcknowledged: form.limitationsAcknowledged, rationale: form.rationale,
    humanIndependence: form.independenceConfirmed ? "human_declared" as const : "not_attested" as const,
    coverage: form.coverageAdequate ? "human_declared" as const : "not_accepted" as const,
    goldAcceptance: "requires_owner_review" as const, modelMeasurements: "not_assessed" as const,
    releaseAcceptance: "blocked" as const };
}
