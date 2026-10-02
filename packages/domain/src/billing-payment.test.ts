import { billingPaymentSchema, billingPaymentEvidenceManifestSchema, type BillingAccountInput, type BillingAccountReport, type BillingPaymentInput, type BillingStatementChangeInput } from "@deliberation-ai/contracts";
import { expect, test } from "vitest";
import { inspectBillingAccount } from "./billing-account";
import { inspectBillingStatement } from "./billing-statement";
import { foldStatementVersions } from "./billing-statement-history";
import { inspectBillingPayment } from "./billing-payment";

const id = "00000000-0000-4000-8000-000000000001"; const versionId = "00000000-0000-4000-8000-000000000002";
const reviewedAt = "2026-10-01T01:00:00.000Z";
function invoice(totalUsd: string, credit = false): { account: BillingAccountInput; report: BillingAccountReport } {
  const account: BillingAccountInput = { version: "billing-account-v1", provider: "fixture", accountReference: "account", invoiceId: "invoice",
    documentSha256: "a".repeat(64), reviewedAt, period: { start: "2026-09-01", endExclusive: "2026-10-01" },
    currency: "USD", scope: "complete_declared_connections_invoice", totalUsd, unallocatedLines: [],
    connections: [{ connectionId: id, statementVersionId: versionId, expectedFingerprint: "d".repeat(64), accountMappingReason: "Generated mapping" }] };
  const input: Extract<BillingStatementChangeInput, { action: "record" }> = { version: "billing-statement-change-v1", connectionId: id, statementId: "invoice",
    expectedFingerprint: null, documentSha256: account.documentSha256, reviewedAt, reason: "Generated review", action: "record",
    packet: { version: "billing-statement-v1", connectionId: id, statementId: "invoice", documentSha256: account.documentSha256, reviewedAt,
      currency: "USD", scope: "complete_connection_statement", totalUsd,
      lines: [{ allocation: "unallocated", lineId: "invoice-line", amountUsd: totalUsd, kind: credit ? "credit" : "tools", reason: "Unallocated invoice evidence" }] } };
  const inspection = { ...inspectBillingStatement(input.packet, []), writes: false as const, packetFingerprint: "e".repeat(64),
    ledgerFingerprint: "f".repeat(64), inspectedAt: reviewedAt, receiptChecks: { present: 0, retainedWithoutReceipt: 0 } };
  const state = foldStatementVersions([{ id: versionId, input, sequence: 1, fingerprint: "d".repeat(64), inspection, recordedAt: reviewedAt }]);
  return { account, report: inspectBillingAccount(account, [{ connectionId: id, requestedVersionId: versionId, freshness: "current", records: [], state }]) };
}
const data = invoice("0.05");
const entry = { entryId: "payment-1", transactionReference: "transaction-1", invoiceId: "invoice", accountReference: "account",
  kind: "payment" as const, amountUsd: "0.06", currency: "USD" as const, allocation: "exact_invoice" as const,
  occurredAt: "2026-10-02T00:00:00.000Z", sourceKind: "provider_receipt" as const, documentSha256: "b".repeat(64),
  sourceLineId: "payment-line", attributionReason: "Exact generated invoice allocation" };
const refund = { ...entry, entryId: "refund-1", transactionReference: "refund-transaction", kind: "refund" as const,
  amountUsd: "0.01", sourceKind: "bank_statement" as const, documentSha256: "c".repeat(64), sourceLineId: "refund-line" };
const input: BillingPaymentInput = { version: "billing-payment-v1", account: data.account, reviewedAt: "2026-10-02T01:00:00.000Z",
  reason: "Review generated invoice payment evidence", scope: "complete_declared_invoice_payment_evidence", entries: [entry, refund] };
const digests = new Map([[entry.entryId, entry.documentSha256], [refund.entryId, refund.documentSha256]]);

test("reconciles exact payment minus refund after the invoice period without certifying settlement", () => {
  expect(inspectBillingPayment(input, data.report, digests)).toMatchObject({ status: "reconciled_owner_payment_packet",
    listedNetPaymentUsd: "0.050000000000", supportedNetPaymentUsd: "0.050000000000", differenceUsd: "0.000000000000",
    supportedEntries: 2, accountIdentity: "owner_declared", providerAuthenticity: "unverified",
    paymentEvidenceAuthenticity: "unverified", paymentStatus: "unknown", monetaryDispatchAllowed: false });
});

test("reports amount residual while keeping missing or mismatched payment evidence unavailable", () => {
  const residual = inspectBillingPayment({ ...input, entries: [entry] }, data.report, digests);
  expect(residual.differenceUsd).toBe("-0.010000000000");
  expect(residual.issues.map((issue) => issue.reason)).toContain("payment_total_mismatch");
  const absent = inspectBillingPayment(input, data.report, new Map());
  expect(absent.supportedNetPaymentUsd).toBeNull(); expect(absent.differenceUsd).toBeNull();
  expect(absent.entries.every((item) => item.evidenceStatus === "missing")).toBe(true);
  const wrong = inspectBillingPayment(input, data.report, new Map([[entry.entryId, "a".repeat(64)], [refund.entryId, refund.documentSha256]]));
  expect(wrong.issues.map((issue) => issue.reason)).toContain("evidence_digest_mismatch");
  expect(wrong.supportedNetPaymentUsd).toBe("-0.010000000000"); expect(wrong.differenceUsd).toBeNull();
});

test("prevents duplicate entries, transactions and source lines from supporting a balanced result", () => {
  const duplicate = inspectBillingPayment({ ...input, entries: [...input.entries, entry] }, data.report, digests);
  expect(duplicate.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["duplicate_entry", "duplicate_transaction", "duplicate_source_line"]));
  expect(duplicate.supportedEntries).toBe(2); expect(duplicate.differenceUsd).toBeNull();
  for (const copied of [{ ...entry, entryId: "copy", sourceLineId: "other-line" }, { ...entry, entryId: "copy", transactionReference: "other-transaction" }]) {
    expect(inspectBillingPayment({ ...input, entries: [...input.entries, copied] }, data.report, new Map([...digests, ["copy", entry.documentSha256]])).status).toBe("incomplete");
  }
});

test("rejects wrong invoice/account allocation and payments after review without treating them as zero", () => {
  for (const mutation of [{ invoiceId: "other-invoice" }, { accountReference: "other-account" }, { occurredAt: "2026-10-02T01:00:00.001Z" }]) {
    const report = inspectBillingPayment({ ...input, entries: [{ ...entry, ...mutation }] }, data.report, digests);
    expect(report.status).toBe("incomplete"); expect(report.supportedNetPaymentUsd).toBeNull(); expect(report.differenceUsd).toBeNull();
  }
  expect(inspectBillingPayment({ ...input, reviewedAt: "2026-10-01T00:59:59.000Z" }, data.report, digests).issues.map((issue) => issue.reason)).toContain("review_predates_account");
});

test("keeps apparently balanced payments incomplete when the live invoice is stale or from another account", () => {
  for (const report of [{ ...data.report, status: "incomplete" as const }, { ...data.report, provider: "other" },
    { ...data.report, invoiceId: "other" }, { ...data.report, documentSha256: "f".repeat(64) }]) {
    const result = inspectBillingPayment(input, report, digests);
    expect(result.status).toBe("incomplete"); expect(result.differenceUsd).toBeNull();
    expect(result.paymentStatus).toBe("unknown");
  }
});

test("supports credit-invoice refunds and genuine zero invoices while exposing absent nonzero payment evidence", () => {
  const credit = invoice("-0.01", true);
  expect(inspectBillingPayment({ ...input, account: credit.account, entries: [refund] }, credit.report, digests))
    .toMatchObject({ status: "reconciled_owner_payment_packet", supportedNetPaymentUsd: "-0.010000000000", differenceUsd: "0.000000000000" });
  const zero = invoice("0");
  expect(inspectBillingPayment({ ...input, account: zero.account, entries: [] }, zero.report, new Map()))
    .toMatchObject({ status: "reconciled_owner_payment_packet", supportedNetPaymentUsd: "0.000000000000", paymentStatus: "unknown" });
  expect(inspectBillingPayment({ ...input, entries: [] }, data.report, new Map()).issues.map((issue) => issue.reason)).toContain("payment_total_mismatch");
});

test("bounds strict payment intake and requires positive exact-invoice USD entries and explicit provenance", () => {
  expect(billingPaymentSchema.safeParse(input).success).toBe(true);
  for (const mutation of [{ entries: Array.from({ length: 101 }, () => entry) }, { paymentStatus: "paid" },
    { scope: "provider_verified" }, ...[{ amountUsd: "0" }, { amountUsd: "-1" }, { amountUsd: "1e2" }, { currency: "EUR" },
      { allocation: "account_topup" }, { attributionReason: " " }, { sourceKind: "model_estimate" }].map((change) => ({ entries: [{ ...entry, ...change }] }))]) {
    expect(billingPaymentSchema.safeParse({ ...input, ...mutation }).success).toBe(false);
  }
  expect(billingPaymentEvidenceManifestSchema.safeParse({ version: "billing-payment-evidence-v1", files: [] }).success).toBe(true);
  expect(billingPaymentEvidenceManifestSchema.safeParse({ version: "billing-payment-evidence-v1", files: [], token: "forbidden" }).success).toBe(false);
  expect(billingPaymentEvidenceManifestSchema.safeParse({ version: "billing-payment-evidence-v1", files: Array.from({ length: 101 }, () => ({ entryId: "e", path: "source" })) }).success).toBe(false);
});
