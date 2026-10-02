import { billingPaymentSchema, type BillingAccountReport, type BillingPaymentInput, type BillingPaymentIssue, type BillingPaymentReport } from "@deliberation-ai/contracts";
import { usdToPico } from "./billing";
import { picoUsdToUsd } from "./token-cost";

const dollars = (value: bigint): string => value < BigInt(0) ? `-${picoUsdToUsd(-value)}` : picoUsdToUsd(value);
/** Caller supplies inspection of the exact embedded account packet and locally hashed source bytes. */
export function inspectBillingPayment(value: BillingPaymentInput, account: BillingAccountReport, evidenceDigests: ReadonlyMap<string, string>): BillingPaymentReport {
  const input = billingPaymentSchema.parse(value);
  const issues: BillingPaymentIssue[] = [];
  const issue = (reason: BillingPaymentIssue["reason"], entryId: string | null = null): void => { issues.push({ reason, entryId }); };
  const sameAccount = account.provider === input.account.provider && account.accountReference === input.account.accountReference
    && account.invoiceId === input.account.invoiceId && account.documentSha256 === input.account.documentSha256
    && account.reviewedAt === input.account.reviewedAt && account.period.start === input.account.period.start
    && account.period.endExclusive === input.account.period.endExclusive
    && usdToPico(account.declaredTotalUsd) === usdToPico(input.account.totalUsd);
  if (!sameAccount) issue("account_inspection_mismatch");
  if (account.status !== "reconciled_owner_account_packet" || account.issues.length) issue("account_incomplete");
  if (Date.parse(input.reviewedAt) < Date.parse(input.account.reviewedAt)) issue("review_predates_account");
  let listed = BigInt(0); let supported = BigInt(0); let supportedEntries = 0;
  const entryIds = new Set<string>(); const transactions = new Set<string>(); const sourceLines = new Set<string>();
  const entries: BillingPaymentReport["entries"] = [];
  for (const entry of input.entries) {
    const before = issues.length; const amount = usdToPico(entry.amountUsd) * (entry.kind === "refund" ? -BigInt(1) : BigInt(1));
    listed += amount;
    if (entryIds.has(entry.entryId)) issue("duplicate_entry", entry.entryId); entryIds.add(entry.entryId);
    if (transactions.has(entry.transactionReference)) issue("duplicate_transaction", entry.entryId); transactions.add(entry.transactionReference);
    const sourceLine = JSON.stringify([entry.documentSha256, entry.sourceLineId]);
    if (sourceLines.has(sourceLine)) issue("duplicate_source_line", entry.entryId); sourceLines.add(sourceLine);
    if (entry.invoiceId !== input.account.invoiceId || entry.accountReference !== input.account.accountReference) issue("entry_identity_mismatch", entry.entryId);
    if (Date.parse(entry.occurredAt) > Date.parse(input.reviewedAt)) issue("entry_after_review", entry.entryId);
    const digest = evidenceDigests.get(entry.entryId);
    const evidenceStatus = digest === undefined ? "missing" as const : digest === entry.documentSha256 ? "digest_matched" as const : "mismatch" as const;
    if (evidenceStatus !== "digest_matched") issue(evidenceStatus === "missing" ? "evidence_unavailable" : "evidence_digest_mismatch", entry.entryId);
    entries.push({ ...entry, evidenceStatus });
    if (issues.length === before) { supported += amount; supportedEntries++; }
  }
  // Partial evidence may have a diagnostic subtotal, but cannot establish a payable balance.
  const difference = issues.length ? null : usdToPico(input.account.totalUsd) - supported;
  if (difference !== null && difference !== BigInt(0)) issue("payment_total_mismatch");
  return { version: "billing-payment-inspection-v1", currency: "USD", status: issues.length ? "incomplete" : "reconciled_owner_payment_packet",
    provider: input.account.provider, accountReference: input.account.accountReference, invoiceId: input.account.invoiceId,
    reviewedAt: input.reviewedAt, reason: input.reason, scope: input.scope,
    declaredInvoiceTotalUsd: dollars(usdToPico(input.account.totalUsd)), listedNetPaymentUsd: dollars(listed),
    supportedNetPaymentUsd: supportedEntries || !input.entries.length ? dollars(supported) : null,
    differenceUsd: difference === null ? null : dollars(difference), supportedEntries, issues, entries, accountInspection: account,
    accountIdentity: "owner_declared", providerAuthenticity: "unverified", paymentEvidenceAuthenticity: "unverified",
    paymentStatus: "unknown", monetaryDispatchAllowed: false };
}
