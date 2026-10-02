import { billingAccountSchema, type BillingAccountInput, type BillingAccountIssue, type BillingAccountReport, type BillingAccountStatement } from "@deliberation-ai/contracts";
import { usdToPico } from "./billing";
import { picoUsdToUsd } from "./token-cost";

const dollars = (value: bigint): string => value < BigInt(0) ? `-${picoUsdToUsd(-value)}` : picoUsdToUsd(value);
/** Complete owned histories and current ledger checks must come from one caller snapshot. */
export function inspectBillingAccount(value: BillingAccountInput, evidence: readonly BillingAccountStatement[]): BillingAccountReport {
  const input = billingAccountSchema.parse(value);
  const issues: BillingAccountIssue[] = [];
  const statements: BillingAccountReport["statements"] = [];
  const connections = new Set<string>(); const versions = new Set<string>();
  const lines = new Set<string>(); const records = new Set<string>(); const responses = new Set<string>();
  let listed = BigInt(0); let totalKnown = true; let matched = BigInt(0); let shared = BigInt(0);
  let matchedAttempts = 0; let unallocatedLines = 0;
  const periodStart = Date.parse(input.period.start); const periodEnd = Date.parse(input.period.endExclusive);
  const addIssue = (reason: BillingAccountIssue["reason"], connectionId: string | null = null, lineId: string | null = null): void => {
    issues.push({ reason, connectionId, lineId });
  };
  const visitLine = (lineId: string, connectionId: string | null): boolean => {
    if (lines.has(lineId)) { addIssue("duplicate_account_line", connectionId, lineId); return false; }
    lines.add(lineId); return true;
  };
  for (const binding of input.connections) {
    const connectionId = binding.connectionId;
    const duplicate = connections.has(connectionId) || versions.has(binding.statementVersionId);
    if (connections.has(connectionId)) addIssue("duplicate_connection", connectionId);
    if (versions.has(binding.statementVersionId)) addIssue("duplicate_statement_version", connectionId);
    connections.add(connectionId); versions.add(binding.statementVersionId);
    const item = evidence.find((candidate) => candidate.connectionId === connectionId && candidate.requestedVersionId === binding.statementVersionId);
    const state = item?.state; const packet = state?.packet;
    statements.push({ connectionId, accountMappingReason: binding.accountMappingReason, expectedFingerprint: binding.expectedFingerprint,
      requestedVersionId: binding.statementVersionId, headVersionId: state?.head.id ?? null,
      currentFingerprint: state?.head.fingerprint ?? null, freshness: item?.freshness ?? "unavailable", currentTotalUsd: packet ? dollars(usdToPico(packet.totalUsd)) : null });
    if (duplicate) { totalKnown = false; continue; }
    const before = issues.length;
    if (!state) { addIssue("statement_unavailable", connectionId); totalKnown = false; continue; }
    if (state.head.input.connectionId !== connectionId || state.head.input.statementId !== input.invoiceId) {
      addIssue("statement_identity_mismatch", connectionId); totalKnown = false; continue;
    }
    if (state.head.id !== binding.statementVersionId || state.head.fingerprint !== binding.expectedFingerprint) addIssue("stale_statement", connectionId);
    if (state.status === "voided" || !packet || !state.effective) {
      addIssue("voided_statement", connectionId); totalKnown = false; continue;
    }
    if (item!.freshness === "ledger_changed") addIssue("ledger_changed", connectionId);
    else if (item!.freshness !== "current") addIssue("inspection_unavailable", connectionId);
    if (packet.documentSha256 !== input.documentSha256) addIssue("source_mismatch", connectionId);
    if (Date.parse(input.reviewedAt) < Date.parse(state.head.input.reviewedAt)) addIssue("review_predates_statement", connectionId);
    listed += usdToPico(packet.totalUsd);
    const validStatement = issues.length === before;
    const byId = new Map(item!.records.map((record) => [record.id, record]));
    for (const line of packet.lines) {
      const lineBefore = issues.length; const unique = visitLine(line.lineId, connectionId);
      if (line.allocation === "unallocated") {
        const amount = usdToPico(line.amountUsd);
        if ((line.kind === "credit" && amount > BigInt(0)) || (line.kind !== "credit" && amount < BigInt(0))) addIssue("invalid_charge_sign", connectionId, line.lineId);
        if (validStatement && unique && issues.length === lineBefore) { shared += amount; unallocatedLines++; }
        continue;
      }
      if (records.has(line.recordId)) addIssue("duplicate_billing_record", connectionId, line.lineId);
      records.add(line.recordId);
      const record = byId.get(line.recordId);
      if (!record || record.status !== "owner_recorded" || record.currentFingerprint !== line.expectedFingerprint) addIssue("record_unavailable", connectionId, line.lineId);
      else {
        if (record.provider !== input.provider) addIssue("provider_mismatch", connectionId, line.lineId);
        const billedAt = Date.parse(record.billedAt);
        if (billedAt < periodStart || billedAt >= periodEnd) addIssue("attempt_outside_period", connectionId, line.lineId);
        // The reviewed account scope makes a remote response duplicate across connections observable.
        if (responses.has(record.remoteResponseId)) addIssue("duplicate_account_response", connectionId, line.lineId);
        responses.add(record.remoteResponseId);
      }
      if (validStatement && unique && issues.length === lineBefore) { matched += usdToPico(line.amountUsd); matchedAttempts++; }
    }
  }
  for (const line of input.unallocatedLines) {
    const before = issues.length; const unique = visitLine(line.lineId, null); const amount = usdToPico(line.amountUsd);
    listed += amount;
    if ((line.kind === "credit" && amount > BigInt(0)) || (line.kind !== "credit" && amount < BigInt(0))) addIssue("invalid_charge_sign", null, line.lineId);
    if (unique && issues.length === before) { shared += amount; unallocatedLines++; }
  }
  const difference = totalKnown ? usdToPico(input.totalUsd) - listed : null;
  if (difference !== null && difference !== BigInt(0)) addIssue("invoice_total_mismatch");
  return { version: "billing-account-inspection-v1", currency: "USD", status: issues.length ? "incomplete" : "reconciled_owner_account_packet",
    provider: input.provider, accountReference: input.accountReference, invoiceId: input.invoiceId, documentSha256: input.documentSha256,
    reviewedAt: input.reviewedAt, period: input.period, scope: input.scope,
    declaredTotalUsd: dollars(usdToPico(input.totalUsd)), listedCurrentTotalUsd: totalKnown ? dollars(listed) : null,
    differenceUsd: difference === null ? null : dollars(difference), matchedAttemptSubtotalUsd: matchedAttempts ? dollars(matched) : null,
    unallocatedSubtotalUsd: unallocatedLines ? dollars(shared) : null, matchedAttempts, unallocatedLines, statements, issues,
    accountIdentity: "owner_declared", providerAuthenticity: "unverified", paymentStatus: "unknown", monetaryDispatchAllowed: false };
}
