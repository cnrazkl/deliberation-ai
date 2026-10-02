import { z } from "zod";
import { billingAccountSchema, type BillingAccountReport } from "./billing-account";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const positiveAmount = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,12})?$/u).refine((value) => /[1-9]/u.test(value), { message: "Payment evidence amount must be positive." });
const reference = z.string().trim().min(1).max(200);
export const billingPaymentSchema = z.object({
  version: z.literal("billing-payment-v1"), account: billingAccountSchema,
  reviewedAt: z.string().datetime(), reason: z.string().trim().min(1).max(500),
  scope: z.literal("complete_declared_invoice_payment_evidence"),
  entries: z.array(z.object({
    entryId: reference, transactionReference: reference, invoiceId: reference, accountReference: reference,
    kind: z.enum(["payment", "refund"]), amountUsd: positiveAmount, currency: z.literal("USD"),
    allocation: z.literal("exact_invoice"), occurredAt: z.string().datetime(),
    sourceKind: z.enum(["provider_receipt", "bank_statement"]),
    documentSha256: fingerprint, sourceLineId: reference, attributionReason: z.string().trim().min(1).max(500),
  }).strict()).max(100),
}).strict();
export const billingPaymentEvidenceManifestSchema = z.object({
  version: z.literal("billing-payment-evidence-v1"),
  files: z.array(z.object({ entryId: reference, path: z.string().min(1).max(2000) }).strict()).max(100),
}).strict();
export type BillingPaymentInput = z.infer<typeof billingPaymentSchema>;
export type BillingPaymentIssue = { entryId: string | null; reason:
  "account_incomplete" | "account_inspection_mismatch" | "review_predates_account" | "duplicate_entry"
  | "duplicate_transaction" | "duplicate_source_line" | "entry_identity_mismatch" | "entry_after_review"
  | "evidence_unavailable" | "evidence_digest_mismatch" | "payment_total_mismatch" };
export type BillingPaymentReport = {
  version: "billing-payment-inspection-v1"; currency: "USD";
  status: "reconciled_owner_payment_packet" | "incomplete";
  provider: string; accountReference: string; invoiceId: string; reviewedAt: string; reason: string;
  scope: "complete_declared_invoice_payment_evidence";
  declaredInvoiceTotalUsd: string; listedNetPaymentUsd: string; supportedNetPaymentUsd: string | null;
  differenceUsd: string | null; supportedEntries: number; issues: BillingPaymentIssue[];
  entries: Array<BillingPaymentInput["entries"][number] & { evidenceStatus: "digest_matched" | "missing" | "mismatch" }>;
  accountInspection: BillingAccountReport;
  accountIdentity: "owner_declared"; providerAuthenticity: "unverified";
  paymentEvidenceAuthenticity: "unverified"; paymentStatus: "unknown"; monetaryDispatchAllowed: false;
};
