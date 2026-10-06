import { z } from "zod";
import { sha256 } from "./external-council-intake";
import { createKnowledgeFormatWorksheet, compileKnowledgeFormatReview, compileKnowledgeFormatReviewPair } from "./knowledge-format-review";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const adjudicationSchema = z.object({
  schemaVersion: z.literal("knowledge-format-adjudication-v1"), planSha256: digest,
  extractionFileSha256: digest, reviewSha256: z.tuple([digest, digest]),
  reviews: z.tuple([z.unknown(), z.unknown()]),
  disagreementCaseIds: z.array(z.string()).max(8),
  adjudicatorId: z.string().trim().min(1).max(120), cases: z.array(z.unknown()).length(8),
}).strict();

function disagreements(reviews: ReturnType<typeof compileKnowledgeFormatReviewPair>) {
  return reviews[0]!.cases.filter((a) => {
    const b = reviews[1]!.cases.find((item) => item.caseId === a.caseId)!;
    const decision = (item: typeof a) => JSON.stringify({ extractionVerified: item.extractionVerified,
      noAnswerRequired: item.noAnswerRequired, claims: item.claims });
    return decision(a) !== decision(b);
  }).map((item) => item.caseId);
}

/** Caller verifies extraction against actual binaries. Human decisions remain blank. */
export function createKnowledgeFormatAdjudicationWorksheet(
  plan: unknown, extractionText: string, worksheets: readonly [unknown, unknown],
) {
  const reviews = compileKnowledgeFormatReviewPair(plan, extractionText, worksheets);
  const blank = createKnowledgeFormatWorksheet(plan, "a");
  return { schemaVersion: "knowledge-format-adjudication-v1" as const,
    planSha256: blank.planSha256, extractionFileSha256: sha256(extractionText),
    reviewSha256: reviews.map((review) => sha256(JSON.stringify(review))) as [string, string],
    reviews, disagreementCaseIds: disagreements(reviews), adjudicatorId: "", cases: blank.cases };
}

/** Compile third-person declarations without certifying independence, gold or release. */
export function compileKnowledgeFormatAdjudicationWorksheet(
  plan: unknown, extractionText: string, worksheets: readonly [unknown, unknown], input: unknown,
) {
  const form = adjudicationSchema.parse(input);
  const expected = createKnowledgeFormatAdjudicationWorksheet(plan, extractionText, worksheets);
  if (form.planSha256 !== expected.planSha256 || form.extractionFileSha256 !== expected.extractionFileSha256 ||
      form.reviewSha256.some((hash, index) => hash !== expected.reviewSha256[index]) ||
      form.reviews.some((review, index) => sha256(JSON.stringify(review)) !== expected.reviewSha256[index]) ||
      JSON.stringify(form.disagreementCaseIds) !== JSON.stringify(expected.disagreementCaseIds)) {
    throw new Error("Frozen format adjudication inputs changed.");
  }
  if (expected.reviews.some((review) => review.reviewerId === form.adjudicatorId)) {
    throw new Error("A third declared adjudicator identity is required.");
  }
  const finalReview = compileKnowledgeFormatReview(plan, extractionText, {
    schemaVersion: "knowledge-format-review-v1", planSha256: form.planSha256,
    slot: "a", reviewerId: form.adjudicatorId, cases: form.cases,
  });
  return { schemaVersion: "knowledge-format-compiled-adjudication-v1" as const,
    planSha256: form.planSha256, extractionFileSha256: form.extractionFileSha256,
    reviewSha256: form.reviewSha256, reviews: expected.reviews,
    adjudicationWorksheetSha256: sha256(JSON.stringify(form)), adjudicatorId: form.adjudicatorId,
    disagreementCaseIds: expected.disagreementCaseIds, cases: finalReview.cases, adjudication: "human_declared" as const,
    humanIndependence: "not_attested" as const, goldAcceptance: "not_assessed" as const,
    releaseAcceptance: "blocked" as const };
}
