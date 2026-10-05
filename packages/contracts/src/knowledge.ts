import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const knowledgeObjectIdSchema = z.string().uuid();
export const knowledgeScopeSchema = z.object({
  ownerId: z.string().min(1).max(100), accountId: z.string().min(1).max(100),
  collectionId: z.string().uuid(), grantId: z.string().uuid(), grantRevision: z.number().int().min(1).max(2_147_483_647),
}).strict();
export type KnowledgeScope = z.infer<typeof knowledgeScopeSchema>;
export const knowledgeCollectionBodySchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
export const knowledgeSelectionSchema = z.object({
  topic: z.string().max(4_000), scopes: z.array(knowledgeScopeSchema).min(1).max(3),
}).strict().refine((value) => new Set(value.scopes.map((scope) => scope.collectionId)).size === value.scopes.length);
export const knowledgeSourceSchema = z.object({
  scope: knowledgeScopeSchema, sourceId: z.string().uuid(), versionId: z.string().uuid(),
  title: z.string().max(200), mediaType: z.enum(["text/plain", "text/markdown", "application/pdf"]),
  originalHash: digest, textHash: digest, parserVersion: z.string().min(1).max(100),
}).strict();
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export const knowledgeExcerptSchema = z.object({
  source: knowledgeSourceSchema, excerptId: z.string().uuid(), text: z.string().min(1).max(1_500),
  start: z.number().int().min(0), end: z.number().int().min(1), page: z.number().int().min(1).max(100).nullable(),
  textHash: digest,
}).strict().refine((value) => value.end - value.start === value.text.length);
export type KnowledgeExcerpt = z.infer<typeof knowledgeExcerptSchema>;

export const knowledgeFileMediaSchema = z.enum(["text/plain", "text/markdown", "application/pdf", "image/png", "image/jpeg"]);
const identity = { ownerId: z.string().min(1).max(100), collectionId: knowledgeObjectIdSchema,
  sourceId: knowledgeObjectIdSchema, versionId: knowledgeObjectIdSchema };
export const knowledgeVersionOriginalSchema = z.object({ ...identity, name: z.string().min(1).max(200), mediaType: knowledgeFileMediaSchema,
  originalHash: digest, dataBase64: z.string().min(1).max(7 * 1_048_576) }).strict();
export const knowledgeVersionExtractionSchema = z.object({ ...identity, name: z.string().min(1).max(200), mediaType: knowledgeFileMediaSchema,
  originalHash: digest, parserVersion: z.string().min(1).max(100),
  deadlineMs: z.number().int().min(1).max(10_000).optional(),
  status: z.enum(["complete", "extraction_unverified", "failed"]),
  reason: z.enum(["missing_text_pages", "image_unverified", "empty_text", "invalid_pdf", "active_content", "page_limit", "character_limit", "timeout", "parser_unavailable"]).nullable(),
  text: z.string().max(64_000), textHash: digest,
  pages: z.array(z.object({ page: z.number().int().min(1).max(100).nullable(), start: z.number().int().min(0).max(64_000),
    end: z.number().int().min(0).max(64_000), textHash: digest }).strict()).max(100),
}).strict();
export type KnowledgeVersionOriginal = z.infer<typeof knowledgeVersionOriginalSchema>;
export type KnowledgeVersionExtraction = z.infer<typeof knowledgeVersionExtractionSchema>;
