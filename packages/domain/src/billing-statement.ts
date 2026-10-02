import { billingStatementSchema, type BillingState, type BillingStatementInput, type BillingStatementIssue, type BillingStatementReport } from "@deliberation-ai/contracts";
import { usdToPico } from "./billing";
import { picoUsdToUsd } from "./token-cost";

const dollars = (value: bigint): string => value < BigInt(0) ? `-${picoUsdToUsd(-value)}` : picoUsdToUsd(value);
/** The caller supplies the complete, authenticated owner ledger from one snapshot. */
export function inspectBillingStatement(value: BillingStatementInput, records: readonly BillingState[], mismatchedReceipts: ReadonlySet<string> = new Set()): BillingStatementReport {
  const input = billingStatementSchema.parse(value);
  const issues: BillingStatementIssue[] = [];
  const lines = new Set<string>(); const linked = new Set<string>();
  const byId = new Map(records.map((record) => [record.id, record]));
  let listed = BigInt(0); let matched = BigInt(0); let unallocated = BigInt(0);
  let matchedAttempts = 0; let unallocatedLines = 0;
  for (const line of input.lines) {
    const recordId = line.allocation === "attempt" ? line.recordId : null;
    const issue = (reason: BillingStatementIssue["reason"]): void => { issues.push({ lineId: line.lineId, recordId, reason }); };
    const amount = usdToPico(line.amountUsd); listed += amount;
    const duplicateLine = lines.has(line.lineId); if (duplicateLine) issue("duplicate_line"); lines.add(line.lineId);
    if (line.allocation === "unallocated") {
      if ((line.kind === "credit" && amount > BigInt(0)) || (line.kind !== "credit" && amount < BigInt(0))) issue("invalid_charge_sign");
      unallocated += amount; unallocatedLines++; continue;
    }
    const before = issues.length;
    if (linked.has(line.recordId)) issue("duplicate_record"); linked.add(line.recordId);
    const record = byId.get(line.recordId);
    if (!record) issue("record_unavailable");
    else {
      if (mismatchedReceipts.has(record.id)) issue("receipt_mismatch");
      if (record.connectionId !== input.connectionId || record.statementId !== input.statementId || record.lineId !== line.lineId) issue("identity_mismatch");
      if (record.currentFingerprint !== line.expectedFingerprint) issue("stale_record");
      if (record.status === "voided") issue("voided_record");
      if (record.status === "reallocated") issue("reallocated_record");
      if (usdToPico(record.totalUsd) !== amount) issue("amount_mismatch");
      if (Date.parse(input.reviewedAt) < Date.parse(record.reviewedAt)) issue("review_predates_record");
    }
    if (!duplicateLine && issues.length === before) { matched += amount; matchedAttempts++; }
  }
  for (const record of records) {
    if (record.status !== "reallocated" && record.connectionId === input.connectionId && record.statementId === input.statementId && !linked.has(record.id)) {
      issues.push({ lineId: record.lineId, recordId: record.id, reason: "known_record_omitted" });
    }
  }
  const difference = usdToPico(input.totalUsd) - listed;
  if (difference !== BigInt(0)) issues.push({ lineId: null, recordId: null, reason: "statement_total_mismatch" });
  return { version: "billing-statement-inspection-v1", currency: "USD", status: issues.length ? "incomplete" : "reconciled_owner_packet",
    statementId: input.statementId, connectionId: input.connectionId, documentSha256: input.documentSha256,
    declaredTotalUsd: dollars(usdToPico(input.totalUsd)), listedTotalUsd: dollars(listed), differenceUsd: dollars(difference),
    matchedAttemptSubtotalUsd: matchedAttempts ? dollars(matched) : null,
    unallocatedSubtotalUsd: unallocatedLines ? dollars(unallocated) : null, matchedAttempts, unallocatedLines, issues,
    providerAuthenticity: "unverified", paymentStatus: "unknown", monetaryDispatchAllowed: false };
}
