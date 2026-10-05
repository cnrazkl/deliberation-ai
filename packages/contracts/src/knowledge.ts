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
