import { z } from "zod";
import type { BillingState } from "./billing";
import type { BillingStatementState } from "./billing-statement";

const amount = z.string().regex(/^-?(0|[1-9]\d{0,8})(\.\d{1,12})?$/u);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
export const billingAccountSchema = z.object({
  version: z.literal("billing-account-v1"),
  provider: z.string().trim().min(1).max(100),
  accountReference: z.string().trim().min(1).max(200),
  invoiceId: z.string().trim().min(1).max(200),
  documentSha256: fingerprint, reviewedAt: z.string().datetime(),
  period: z.object({ start: z.string().date(), endExclusive: z.string().date() }).strict(),
  currency: z.literal("USD"), scope: z.literal("complete_declared_connections_invoice"),
  totalUsd: amount,
  connections: z.array(z.object({
    connectionId: z.string().uuid(), accountMappingReason: z.string().trim().min(1).max(500),
    statementVersionId: z.string().uuid(), expectedFingerprint: fingerprint,
  }).strict()).min(1).max(100),
  unallocatedLines: z.array(z.object({
    lineId: z.string().trim().min(1).max(200), amountUsd: amount,
    kind: z.enum(["tools", "cache_write", "storage", "modality", "tax", "credit", "other"]),
    reason: z.string().trim().min(1).max(500),
  }).strict()).max(1000),
}).strict().refine((input) => input.period.start < input.period.endExclusive, { message: "Invoice period must be ordered." });
export type BillingAccountInput = z.infer<typeof billingAccountSchema>;
export type BillingAccountStatement = {
  connectionId: string; requestedVersionId: string;
  state: BillingStatementState | null;
  freshness: "current" | "ledger_changed" | "inspection_unavailable" | "voided" | "unavailable";
  records: readonly BillingState[];
};
export type BillingAccountIssue = {
  connectionId: string | null; lineId: string | null;
  reason: "duplicate_connection" | "duplicate_statement_version" | "statement_unavailable" | "statement_identity_mismatch"
    | "stale_statement" | "voided_statement" | "ledger_changed" | "inspection_unavailable" | "source_mismatch"
    | "review_predates_statement" | "record_unavailable" | "provider_mismatch" | "attempt_outside_period"
    | "duplicate_account_line" | "duplicate_account_response" | "duplicate_billing_record"
    | "invalid_charge_sign" | "invoice_total_mismatch";
};
export type BillingAccountReport = {
  version: "billing-account-inspection-v1"; currency: "USD";
  status: "reconciled_owner_account_packet" | "incomplete";
  provider: string; accountReference: string; invoiceId: string; documentSha256: string;
  reviewedAt: string; period: BillingAccountInput["period"]; scope: "complete_declared_connections_invoice";
  declaredTotalUsd: string; listedCurrentTotalUsd: string | null; differenceUsd: string | null;
  matchedAttemptSubtotalUsd: string | null; unallocatedSubtotalUsd: string | null;
  matchedAttempts: number; unallocatedLines: number;
  statements: Array<{ connectionId: string; accountMappingReason: string; expectedFingerprint: string; requestedVersionId: string; headVersionId: string | null;
    currentFingerprint: string | null; freshness: BillingAccountStatement["freshness"]; currentTotalUsd: string | null }>;
  issues: BillingAccountIssue[];
  accountIdentity: "owner_declared"; providerAuthenticity: "unverified";
  paymentStatus: "unknown"; monetaryDispatchAllowed: false;
};
