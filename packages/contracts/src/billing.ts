import { z } from "zod";

const amount = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,12})?$/u);
const signedAmount = z.string().regex(/^-?(0|[1-9]\d{0,8})(\.\d{1,12})?$/u);
export const providerBillingSchema = z.object({
  version: z.literal("provider-billing-v1"),
  operationId: z.string().uuid(),
  connectionId: z.string().uuid(),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(200),
  remoteResponseId: z.string().min(1).max(200),
  statementId: z.string().min(1).max(200),
  lineId: z.string().min(1).max(200),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  billedAt: z.string().datetime(),
  reviewedAt: z.string().datetime(),
  attribution: z.literal("exact_remote_response"),
  scope: z.literal("all_charges_for_this_attempt"),
  currency: z.literal("USD"),
  totalUsd: amount,
  components: z.array(z.object({
    kind: z.enum(["tokens", "tools", "cache_write", "storage", "modality", "tax", "credit", "other"]),
    amountUsd: signedAmount,
  }).strict()).min(1).max(32),
}).strict();
export type ProviderBillingInput = z.infer<typeof providerBillingSchema>;
export type ProviderBillingRecord = ProviderBillingInput & {
  id: string; runId: string; fingerprint: string; receiptFingerprint: string; recordedAt: string;
};
const changeBase = {
  version: z.literal("provider-billing-change-v1"), recordId: z.string().uuid(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewedAt: z.string().datetime(), reason: z.string().trim().min(1).max(500),
};
export const providerBillingChangeSchema = z.discriminatedUnion("action", [
  z.object({ ...changeBase, action: z.literal("replace"), replacement: providerBillingSchema }).strict(),
  z.object({ ...changeBase, action: z.literal("void") }).strict(),
]);
export type ProviderBillingChangeInput = z.infer<typeof providerBillingChangeSchema>;
export type ProviderBillingChange = ProviderBillingChangeInput & { id: string; sequence: number; fingerprint: string; recordedAt: string };
export const providerBillingReallocationSchema = z.object({
  version: z.literal("provider-billing-reallocation-v1"), sourceRecordId: z.string().uuid(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), documentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewedAt: z.string().datetime(), reason: z.string().trim().min(1).max(500), replacement: providerBillingSchema,
}).strict();
export type ProviderBillingReallocationInput = z.infer<typeof providerBillingReallocationSchema>;
export type ProviderBillingReallocation = { id: string; input: ProviderBillingReallocationInput; targetRecordId: string; targetFingerprint: string; fingerprint: string; recordedAt: string };
export type BillingState = ProviderBillingRecord & { original: ProviderBillingRecord; status: "owner_recorded" | "voided" | "reallocated";
  currentFingerprint: string; changes: ProviderBillingChange[]; reallocationIn?: ProviderBillingReallocation; reallocationOut?: ProviderBillingReallocation };
export type BillingProjection = Omit<BillingState, "status"> & { status: "owner_recorded" | "receipt_mismatch" | "voided" | "reallocated"; changeCount: number; historyTruncated: boolean };
