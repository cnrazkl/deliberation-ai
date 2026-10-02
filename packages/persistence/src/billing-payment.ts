import { billingPaymentSchema, type BillingPaymentInput } from "@deliberation-ai/contracts";
import { inspectBillingPayment } from "@deliberation-ai/domain";
import { inspectOwnedBillingAccount } from "./billing-account";
import { pricingFingerprint } from "./provider-pricing";

export async function inspectOwnedBillingPayment(value: BillingPaymentInput, invoiceSha256: string, evidenceDigests: ReadonlyMap<string, string>) {
  const input = billingPaymentSchema.parse(value);
  if (Date.parse(input.reviewedAt) > Date.now()) throw new Error("Payment review is future dated.");
  const ids = new Set(input.entries.map((entry) => entry.entryId));
  if ([...evidenceDigests].some(([id, digest]) => !ids.has(id) || !/^[a-f0-9]{64}$/u.test(digest))) throw new Error("Unexpected payment evidence.");
  const accountInspection = await inspectOwnedBillingAccount(input.account, invoiceSha256);
  const report = inspectBillingPayment(input, accountInspection, evidenceDigests);
  return { ...report, writes: false as const, packetFingerprint: pricingFingerprint(input),
    accountPacketFingerprint: accountInspection.packetFingerprint, ledgerFingerprint: accountInspection.ledgerFingerprint,
    evidenceFingerprint: pricingFingerprint(input.entries.map((entry) => ({ entryId: entry.entryId, sha256: evidenceDigests.get(entry.entryId) ?? null }))),
    accountInspectedAt: accountInspection.inspectedAt, inspectedAt: new Date().toISOString() };
}
