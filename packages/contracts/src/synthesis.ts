import { z } from "zod";

export const SYNTHESIS_VERSION = "reviewed-synthesis-v3";
export const SYNTHESIS_OUTPUT_TOKENS = 4_096;
export const SYNTHESIS_MAX_CALLS = 4;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const claimId = z.string().min(1).max(120);
export const synthesisDraftSchema = z.object({
  sourceFingerprint: digest,
  paragraphs: z.array(z.object({
    text: z.string().trim().min(1).max(1_500),
    claimIds: z.array(claimId).min(1).max(12),
  }).strict()).min(1).max(8),
}).strict();
export const synthesisReviewSchema = z.object({
  sourceFingerprint: digest,
  draftSha256: digest,
  checks: z.array(z.object({
    paragraphIndex: z.number().int().min(0).max(7),
    verdict: z.enum(["preserved", "changes_meaning", "unsupported", "uncertain"]),
    quotes: z.array(z.object({ claimId, quote: z.string().min(1).max(4_000) }).strict()).min(1).max(12),
    rationale: z.string().trim().min(1).max(400),
  }).strict()).min(1).max(8),
}).strict();
// Models supply content only. Frozen source/draft bindings belong to the local receipt.
export const synthesisModelDraftSchema = synthesisDraftSchema.omit({ sourceFingerprint: true });
export const synthesisModelReviewSchema = synthesisReviewSchema.omit({ sourceFingerprint: true, draftSha256: true });
export type SynthesisDraft = z.infer<typeof synthesisDraftSchema>;
export type SynthesisReview = z.infer<typeof synthesisReviewSchema>;
export type SynthesisStage = "draft" | "review" | "repair" | "repair_review";
