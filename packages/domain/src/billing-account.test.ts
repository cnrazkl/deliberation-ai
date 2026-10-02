import { billingAccountSchema, type BillingAccountInput, type BillingAccountStatement, type BillingStatementChangeInput, type ProviderBillingRecord } from "@deliberation-ai/contracts";
import { expect, test } from "vitest";
import { foldBillingChanges } from "./billing";
import { inspectBillingStatement } from "./billing-statement";
import { foldStatementVersions } from "./billing-statement-history";
import { inspectBillingAccount } from "./billing-account";

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const digest = "b".repeat(64); const reviewedAt = "2026-10-01T01:00:00.000Z";
function statement(index: number, amount: string): BillingAccountStatement {
  const original: ProviderBillingRecord = { version: "provider-billing-v1", id: id(index + 10), operationId: id(index + 20), connectionId: id(index),
    provider: "fixture", model: "fixture", remoteResponseId: `response-${index}`, runId: id(index + 30),
    fingerprint: "a".repeat(64), receiptFingerprint: "a".repeat(64), statementId: "invoice", lineId: `attempt-${index}`,
    documentSha256: digest, billedAt: "2026-09-30T23:59:59.000Z", reviewedAt, recordedAt: reviewedAt,
    attribution: "exact_remote_response", scope: "all_charges_for_this_attempt", currency: "USD", totalUsd: amount,
    components: [{ kind: "tokens", amountUsd: amount }] };
  const record = foldBillingChanges(original, []);
  const input: Extract<BillingStatementChangeInput, { action: "record" }> = { version: "billing-statement-change-v1",
    connectionId: original.connectionId, statementId: original.statementId, expectedFingerprint: null, documentSha256: digest, reviewedAt,
    reason: "Generated review", action: "record", packet: { version: "billing-statement-v1", connectionId: original.connectionId,
      statementId: "invoice", documentSha256: digest, reviewedAt, currency: "USD", scope: "complete_connection_statement",
      totalUsd: amount, lines: [{ allocation: "attempt", lineId: original.lineId, amountUsd: amount, recordId: original.id, expectedFingerprint: record.currentFingerprint }] } };
  const inspection = { ...inspectBillingStatement(input.packet, [record]), writes: false as const, packetFingerprint: "c".repeat(64),
    ledgerFingerprint: "d".repeat(64), inspectedAt: reviewedAt, receiptChecks: { present: 1, retainedWithoutReceipt: 0 } };
  const versionId = id(index + 40);
  return { connectionId: original.connectionId, requestedVersionId: versionId, freshness: "current", records: [record],
    state: foldStatementVersions([{ id: versionId, input, sequence: 1, fingerprint: "e".repeat(64), inspection, recordedAt: reviewedAt }]) };
}
const evidence = [statement(1, "0.020"), statement(2, "0.030")];
const input: BillingAccountInput = { version: "billing-account-v1", provider: "fixture", accountReference: "generated-account", invoiceId: "invoice",
  documentSha256: digest, reviewedAt, period: { start: "2026-09-01", endExclusive: "2026-10-01" }, currency: "USD",
  scope: "complete_declared_connections_invoice", totalUsd: "0.053", connections: evidence.map((item) => ({ connectionId: item.connectionId,
    statementVersionId: item.requestedVersionId, expectedFingerprint: item.state!.head.fingerprint, accountMappingReason: "Generated mapping review" })),
  unallocatedLines: [{ lineId: "tax", amountUsd: "0.005", kind: "tax", reason: "Unallocated account tax" },
    { lineId: "credit", amountUsd: "-0.002", kind: "credit", reason: "Account credit" }] };

test("reconciles multiple reviewed connections and exact credits without certifying account ownership or payment", () => {
  expect(inspectBillingAccount(input, evidence)).toMatchObject({ status: "reconciled_owner_account_packet",
    listedCurrentTotalUsd: "0.053000000000", differenceUsd: "0.000000000000", matchedAttemptSubtotalUsd: "0.050000000000",
    unallocatedSubtotalUsd: "0.003000000000", matchedAttempts: 2, unallocatedLines: 2,
    accountIdentity: "owner_declared", providerAuthenticity: "unverified", paymentStatus: "unknown", monetaryDispatchAllowed: false });
});

test("rejects duplicate connection/version references without inferring a known aggregate", () => {
  const result = inspectBillingAccount({ ...input, connections: [...input.connections, input.connections[0]!] }, evidence);
  expect(result.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["duplicate_connection", "duplicate_statement_version"]));
  expect(result.listedCurrentTotalUsd).toBeNull(); expect(result.differenceUsd).toBeNull(); expect(result.matchedAttempts).toBe(2);
});

test("detects invoice-line and account-response duplicates across connections and extra account charges", () => {
  const second = structuredClone(evidence[1]!);
  second.records[0]!.remoteResponseId = evidence[0]!.records[0]!.remoteResponseId;
  second.state!.packet!.lines[0]!.lineId = evidence[0]!.state!.packet!.lines[0]!.lineId;
  const result = inspectBillingAccount({ ...input, unallocatedLines: [...input.unallocatedLines, { ...input.unallocatedLines[0]! }] }, [evidence[0]!, second]);
  expect(result.status).toBe("incomplete");
  expect(result.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["duplicate_account_line", "duplicate_account_response"]));
  expect(result.matchedAttempts).toBe(1); expect(result.unallocatedLines).toBe(2);
  const sameRecord = structuredClone(evidence[1]!);
  const secondLine = sameRecord.state!.packet!.lines[0]!;
  if (secondLine.allocation !== "attempt") throw new Error("Expected generated attempt line.");
  secondLine.recordId = evidence[0]!.records[0]!.id;
  sameRecord.records[0]!.id = secondLine.recordId;
  expect(inspectBillingAccount(input, [evidence[0]!, sameRecord]).issues.map((issue) => issue.reason)).toContain("duplicate_billing_record");
});

test("preserves unavailable totals and denies missing, foreign-identity and withdrawn statements", () => {
  for (const item of [
    { ...evidence[0]!, state: null, freshness: "unavailable" as const },
    { ...evidence[0]!, state: { ...evidence[0]!.state!, head: { ...evidence[0]!.state!.head,
      input: { ...evidence[0]!.state!.head.input, statementId: "another-invoice" } } } },
    { ...evidence[0]!, state: { ...evidence[0]!.state!, status: "voided" as const, packet: null, effective: null }, freshness: "voided" as const },
  ]) {
    const report = inspectBillingAccount(input, [item, evidence[1]!]);
    expect(report.status).toBe("incomplete"); expect(report.listedCurrentTotalUsd).toBeNull(); expect(report.differenceUsd).toBeNull();
  }
});

test("excludes stale or unreadable statement subtotals and rejects provider, source, review and period drift", () => {
  const mutations: Array<Partial<BillingAccountStatement>> = [
    { freshness: "ledger_changed" }, { freshness: "inspection_unavailable" },
    { state: { ...evidence[0]!.state!, head: { ...evidence[0]!.state!.head, fingerprint: "f".repeat(64) } } },
    { state: { ...evidence[0]!.state!, packet: { ...evidence[0]!.state!.packet!, documentSha256: "f".repeat(64) } } },
    { records: [{ ...evidence[0]!.records[0]!, provider: "other" }] },
    { records: [{ ...evidence[0]!.records[0]!, billedAt: "2026-10-01T00:00:00.000Z" }] },
    { records: [{ ...evidence[0]!.records[0]!, billedAt: "2026-08-31T23:59:59.000Z" }] },
  ];
  for (const mutation of mutations) {
    const report = inspectBillingAccount(input, [{ ...evidence[0]!, ...mutation }, evidence[1]!]);
    expect(report.status).toBe("incomplete"); expect(report.matchedAttempts).toBe(1);
  }
  expect(inspectBillingAccount({ ...input, reviewedAt: "2026-10-01T00:59:59.000Z" }, evidence).issues.map((issue) => issue.reason)).toContain("review_predates_statement");
});

test("keeps genuine zero distinct from missing amounts and reports residuals and invalid charge signs", () => {
  const zero = statement(1, "0");
  const zeroInput = { ...input, totalUsd: "0", connections: [input.connections[0]!], unallocatedLines: [] };
  expect(inspectBillingAccount(zeroInput, [zero])).toMatchObject({ status: "reconciled_owner_account_packet",
    listedCurrentTotalUsd: "0.000000000000", matchedAttemptSubtotalUsd: "0.000000000000", unallocatedSubtotalUsd: null });
  expect(inspectBillingAccount({ ...input, totalUsd: "1" }, evidence).issues.at(-1)!.reason).toBe("invoice_total_mismatch");
  for (const kind of ["tax", "credit"] as const) {
    const amountUsd = kind === "tax" ? "-1" : "1";
    expect(inspectBillingAccount({ ...input, unallocatedLines: [{ lineId: "charge", amountUsd, kind, reason: "Review" }] }, evidence)
      .issues.map((issue) => issue.reason)).toContain("invalid_charge_sign");
  }
});

test("bounds strict account intake and requires explicit mapping reasons, ordered UTC periods and USD scope", () => {
  expect(billingAccountSchema.safeParse(input).success).toBe(true);
  for (const mutation of [{ connections: [] }, { connections: Array.from({ length: 101 }, () => input.connections[0]) },
    { unallocatedLines: Array.from({ length: 1001 }, () => input.unallocatedLines[0]) }, { currency: "EUR" },
    { totalUsd: "1e2" }, { totalUsd: "0.0000000000001" }, { providerAuthenticity: "verified" },
    { period: { start: "2026-10-01", endExclusive: "2026-09-01" } },
    { connections: [{ ...input.connections[0]!, accountMappingReason: " " }] }]) {
    expect(billingAccountSchema.safeParse({ ...input, ...mutation }).success).toBe(false);
  }
});
