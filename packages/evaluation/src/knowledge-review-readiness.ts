import { compileCouncilCoverageReviewWorksheet, compileCouncilCoverageAdjudicationWorksheet } from "./council-coverage-labeling";
import { compileKnowledgeFormatReview, compileKnowledgeFormatReviewPair } from "./knowledge-format-review";
import { compileKnowledgeFormatAdjudicationWorksheet } from "./knowledge-format-adjudication";
import { compileKnowledgeReviewAttestationWorksheet, type KnowledgeReviewInputs } from "./knowledge-review-attestation";

type GateState = "missing" | "invalid" | "blocked" | "validated";
function assess<T>(inputs: unknown[], dependencies: { state: GateState }[], validate: () => T): { state: GateState; value?: T } {
  if (inputs.some((input) => input === undefined)) return { state: "missing" };
  if (dependencies.some((gate) => gate.state !== "validated")) return { state: "blocked" };
  try { return { state: "validated", value: validate() }; }
  catch { return { state: "invalid" }; }
}

/** Read-only, content-free status. Caller verifies the frozen plan/intake and actual extraction. */
export function inspectKnowledgeReviewReadiness(
  plan: unknown, intake: unknown, extractionText: string,
  inputs: KnowledgeReviewInputs & { coordinator?: unknown },
) {
  const textReview = (index: 0 | 1) => assess([inputs.textReviews[index]], [], () => {
    const input = inputs.textReviews[index];
    if (typeof input !== "object" || input === null || !("slot" in input) || input.slot !== (index === 0 ? "a" : "b")) {
      throw new Error("Wrong original slot.");
    }
    return compileCouncilCoverageReviewWorksheet(intake, input);
  });
  const textA = textReview(0), textB = textReview(1);
  const textPair = assess([], [textA, textB], () => {
    if (textA.value!.reviewerId === textB.value!.reviewerId) throw new Error("Distinct reviewers required.");
    return [textA.value!, textB.value!] as const;
  });
  const textAdjudication = assess([inputs.textAdjudication], [textPair], () =>
    compileCouncilCoverageAdjudicationWorksheet(intake, textPair.value, inputs.textAdjudication));
  const formatReview = (index: 0 | 1) => assess([inputs.formatReviews[index]], [], () => {
    const result = compileKnowledgeFormatReview(plan, extractionText, inputs.formatReviews[index]);
    if (result.slot !== (index === 0 ? "a" : "b")) throw new Error("Wrong original slot.");
    return result;
  });
  const formatA = formatReview(0), formatB = formatReview(1);
  const formatPair = assess([], [formatA, formatB], () => compileKnowledgeFormatReviewPair(plan, extractionText, inputs.formatReviews));
  const formatAdjudication = assess([inputs.formatAdjudication], [formatPair], () =>
    compileKnowledgeFormatAdjudicationWorksheet(plan, extractionText, inputs.formatReviews, inputs.formatAdjudication));
  const coordinator = assess([inputs.coordinator], [textAdjudication, formatAdjudication], () =>
    compileKnowledgeReviewAttestationWorksheet(plan, intake, extractionText, inputs, inputs.coordinator));
  const gates = { textReviewerA: textA.state, textReviewerB: textB.state, textReviewPair: textPair.state,
    textAdjudication: textAdjudication.state, formatReviewerA: formatA.state, formatReviewerB: formatB.state,
    formatReviewPair: formatPair.state, formatAdjudication: formatAdjudication.state, coordinator: coordinator.state };
  return { schemaVersion: "knowledge-review-readiness-v1" as const, gates,
    humanIndependence: coordinator.value?.humanIndependence ?? "not_attested" as const,
    coverage: coordinator.value?.coverage ?? "not_assessed" as const,
    goldAcceptance: "requires_owner_review" as const, modelMeasurements: "not_assessed" as const,
    releaseAcceptance: "blocked" as const };
}
