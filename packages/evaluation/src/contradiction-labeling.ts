import { z } from "zod";
import { sha256 } from "./external-council-intake";
import type { ContradictionReviewPlan } from "./contradiction-review";

const decisionSchema = z.object({ relation: z.enum(["contradiction", "compatible", "unresolved"]),
  comparableScope: z.enum(["yes", "no", "unknown"]), critical: z.boolean(), rationale: z.string().trim().min(1).max(2_000),
}).strict().superRefine((item, ctx) => {
  if (item.relation === "contradiction" && item.comparableScope !== "yes") ctx.addIssue({ code: "custom", message: "Çelişki karşılaştırılabilir kapsam gerektirir." });
});
const worksheetSchema = z.object({ schemaVersion: z.literal("contradiction-label-worksheet-v1"), fingerprint: z.string(),
  reviewerId: z.string().trim().min(1), pairs: z.array(z.object({ pairId: z.string(), left: z.unknown(), right: z.unknown(), decision: decisionSchema }).strict()),
}).strict();

/** Blinded to ranking, selection and evaluator outputs. Includes every pair. */
export function createContradictionLabelWorksheet(plan: ContradictionReviewPlan) {
  if (!plan.allPairIds.length) throw new Error("Etiketleme için en az bir iddia çifti gerekli.");
  const claims = new Map(plan.claims.map((claim) => [claim.id, claim]));
  return { schemaVersion: "contradiction-label-worksheet-v1", fingerprint: plan.fingerprint, reviewerId: "",
    pairs: [...plan.allPairIds].sort().map((pairId) => {
      const [a, b] = JSON.parse(pairId) as [string, string];
      return { pairId, left: claims.get(a)!, right: claims.get(b)!, decision: null };
    }) };
}

export function compileContradictionLabelWorksheet(plan: ContradictionReviewPlan, input: unknown) {
  const expected = createContradictionLabelWorksheet(plan);
  const sheet = worksheetSchema.parse(input);
  if (sheet.fingerprint !== plan.fingerprint || sheet.pairs.length !== expected.pairs.length ||
    new Set(sheet.pairs.map((pair) => pair.pairId)).size !== expected.pairs.length) throw new Error("Çift etiketleri planla eşleşmiyor.");
  for (const pair of expected.pairs) {
    const actual = sheet.pairs.find((item) => item.pairId === pair.pairId);
    if (!actual || JSON.stringify(actual.left) !== JSON.stringify(pair.left) || JSON.stringify(actual.right) !== JSON.stringify(pair.right)) {
      throw new Error("Etiketleme iddiası veya kapsamı değiştirilmiş.");
    }
  }
  return sheet;
}

export function createContradictionAdjudicationWorksheet(plan: ContradictionReviewPlan, inputs: [unknown, unknown]) {
  const reviews = inputs.map((input) => compileContradictionLabelWorksheet(plan, input));
  if (reviews[0]!.reviewerId === reviews[1]!.reviewerId) throw new Error("İki bağımsız insan incelemeci gerekli.");
  return { schemaVersion: "contradiction-adjudication-worksheet-v1", fingerprint: plan.fingerprint,
    reviewsSha256: sha256(JSON.stringify(reviews)), adjudicatorId: "",
    pairs: createContradictionLabelWorksheet(plan).pairs.map((pair) => ({ ...pair,
      reviews: reviews.map((review) => ({ reviewerId: review.reviewerId, decision: review.pairs.find((item) => item.pairId === pair.pairId)!.decision })),
    })) };
}

export function compileContradictionAdjudicationWorksheet(plan: ContradictionReviewPlan, inputs: [unknown, unknown], input: unknown) {
  const expected = createContradictionAdjudicationWorksheet(plan, inputs);
  const worksheet = z.object({ schemaVersion: z.literal("contradiction-adjudication-worksheet-v1"), fingerprint: z.string(), reviewsSha256: z.string(),
    adjudicatorId: z.string().trim().min(1), pairs: z.array(z.object({ pairId: z.string(), left: z.unknown(), right: z.unknown(),
      reviews: z.unknown(), decision: decisionSchema,
    }).strict()),
  }).strict().parse(input);
  if (worksheet.fingerprint !== expected.fingerprint || worksheet.reviewsSha256 !== expected.reviewsSha256 ||
    expected.pairs.some((pair) => pair.reviews.some((review) => review.reviewerId === worksheet.adjudicatorId))) {
    throw new Error("Ayrı hakem ve değiştirilmemiş incelemeler gerekli.");
  }
  const review = compileContradictionLabelWorksheet(plan, { schemaVersion: "contradiction-label-worksheet-v1", fingerprint: plan.fingerprint,
    reviewerId: worksheet.adjudicatorId, pairs: worksheet.pairs.map(({ reviews: _reviews, ...pair }) => pair) });
  for (const pair of expected.pairs) {
    if (JSON.stringify(worksheet.pairs.find((item) => item.pairId === pair.pairId)?.reviews) !== JSON.stringify(pair.reviews)) {
      throw new Error("Hakem dosyasında insan incelemesi değiştirilmiş.");
    }
  }
  return { gold: review.pairs.map((pair) => ({ pairId: pair.pairId, relation: pair.decision.relation, critical: pair.decision.critical })),
    fingerprint: plan.fingerprint, reviewsSha256: expected.reviewsSha256, adjudicationSha256: sha256(JSON.stringify(worksheet)) };
}
