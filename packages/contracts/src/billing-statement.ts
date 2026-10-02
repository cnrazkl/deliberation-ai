import { z } from "zod";

const amount = z.string().regex(/^-?(0|[1-9]\d{0,8})(\.\d{1,12})?$/u);
const line = { lineId: z.string().min(1).max(200), amountUsd: amount };
export const billingStatementSchema = z.object({
  version: z.literal("billing-statement-v1"),
  connectionId: z.string().uuid(), statementId: z.string().min(1).max(200),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewedAt: z.string().datetime(), currency: z.literal("USD"),
  scope: z.literal("complete_connection_statement"), totalUsd: amount,
  lines: z.array(z.discriminatedUnion("allocation", [
    z.object({ ...line, allocation: z.literal("attempt"), recordId: z.string().uuid(),
      expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
    z.object({ ...line, allocation: z.literal("unallocated"),
      kind: z.enum(["tools", "cache_write", "storage", "modality", "tax", "credit", "other"]),
      reason: z.string().trim().min(1).max(500) }).strict(),
  ])).min(1).max(1000),
}).strict();
export type BillingStatementInput = z.infer<typeof billingStatementSchema>;
export type BillingStatementIssue = { lineId: string | null; recordId: string | null; reason:
  "duplicate_line" | "duplicate_record" | "invalid_charge_sign" | "record_unavailable" | "identity_mismatch"
  | "stale_record" | "voided_record" | "amount_mismatch" | "review_predates_record" | "known_record_omitted"
  | "receipt_mismatch" | "statement_total_mismatch" | "reallocated_record" };
export type BillingStatementReport = {
  version: "billing-statement-inspection-v1"; currency: "USD";
  status: "reconciled_owner_packet" | "incomplete";
  statementId: string; connectionId: string; documentSha256: string;
  declaredTotalUsd: string; listedTotalUsd: string; differenceUsd: string;
  matchedAttemptSubtotalUsd: string | null; unallocatedSubtotalUsd: string | null;
  matchedAttempts: number; unallocatedLines: number; issues: BillingStatementIssue[];
  providerAuthenticity: "unverified"; paymentStatus: "unknown"; monetaryDispatchAllowed: false;
};

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const reportedAmount = z.string().regex(/^-?\d{1,12}\.\d{12}$/u);
const changeBase = {
  version: z.literal("billing-statement-change-v1"), connectionId: z.string().uuid(), statementId: z.string().min(1).max(200),
  expectedFingerprint: fingerprint.nullable(), documentSha256: fingerprint, reviewedAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(500),
};
export const billingStatementChangeSchema = z.discriminatedUnion("action", [
  z.object({ ...changeBase, action: z.literal("record"), packet: billingStatementSchema }).strict(),
  z.object({ ...changeBase, action: z.literal("void") }).strict(),
]);
export type BillingStatementChangeInput = z.infer<typeof billingStatementChangeSchema>;
export const billingStatementInspectionSchema = z.object({
  version: z.literal("billing-statement-inspection-v1"), currency: z.literal("USD"),
  status: z.enum(["reconciled_owner_packet", "incomplete"]), statementId: z.string().min(1).max(200), connectionId: z.string().uuid(), documentSha256: fingerprint,
  declaredTotalUsd: reportedAmount, listedTotalUsd: reportedAmount, differenceUsd: reportedAmount,
  matchedAttemptSubtotalUsd: reportedAmount.nullable(), unallocatedSubtotalUsd: reportedAmount.nullable(),
  matchedAttempts: z.number().int().nonnegative(), unallocatedLines: z.number().int().nonnegative(),
  issues: z.array(z.object({ lineId: z.string().nullable(), recordId: z.string().nullable(), reason: z.enum([
    "duplicate_line", "duplicate_record", "invalid_charge_sign", "record_unavailable", "identity_mismatch", "stale_record", "voided_record",
    "amount_mismatch", "review_predates_record", "known_record_omitted", "receipt_mismatch", "statement_total_mismatch", "reallocated_record",
  ]) }).strict()),
  providerAuthenticity: z.literal("unverified"), paymentStatus: z.literal("unknown"), monetaryDispatchAllowed: z.literal(false),
  writes: z.literal(false), packetFingerprint: fingerprint, ledgerFingerprint: fingerprint, inspectedAt: z.string().datetime(),
  receiptChecks: z.object({ present: z.number().int().nonnegative(), retainedWithoutReceipt: z.number().int().nonnegative() }).strict(),
}).strict();
export type BillingStatementInspection = z.infer<typeof billingStatementInspectionSchema>;
export type BillingStatementVersion = {
  id: string; input: BillingStatementChangeInput; sequence: number; fingerprint: string;
  inspection: BillingStatementInspection | null; recordedAt: string;
};
export type BillingStatementState = {
  status: "owner_recorded" | "voided"; head: BillingStatementVersion;
  versions: BillingStatementVersion[]; effective: BillingStatementInspection | null; packet: BillingStatementInput | null;
  providerAuthenticity: "unverified"; paymentStatus: "unknown"; monetaryDispatchAllowed: false;
};
