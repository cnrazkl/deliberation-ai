import { billingAccountSchema, type BillingAccountInput, type BillingAccountStatement } from "@deliberation-ai/contracts";
import { inspectBillingAccount } from "@deliberation-ai/domain";
import { and, eq, inArray } from "drizzle-orm";
import { getDatabase } from "./database";
import { getStatementHistoryInSnapshot } from "./billing-statement-history";
import { LOCAL_OWNER_ID } from "./owner";
import { readBillingStates } from "./provider-billing";
import { pricingFingerprint } from "./provider-pricing";
import { providerBillingRecords } from "./schema";

export async function inspectOwnedBillingAccount(value: BillingAccountInput, evidenceSha256: string) {
  const input = billingAccountSchema.parse(value);
  if (input.documentSha256 !== evidenceSha256 || Date.parse(input.reviewedAt) > Date.now()) throw new Error("Account evidence/review is invalid.");
  return getDatabase().transaction(async (tx) => {
    const evidence: BillingAccountStatement[] = [];
    const snapshots: unknown[] = [];
    const receiptEvidence = new Map<string, { present: number; retainedWithoutReceipt: number }>();
    let unavailableReceiptChecks = 0;
    for (const binding of input.connections) {
      const history = await getStatementHistoryInSnapshot(binding.statementVersionId, tx);
      const liveReceiptChecks = history?.liveInspection?.receiptChecks;
      if (liveReceiptChecks) receiptEvidence.set(history!.head.id, liveReceiptChecks);
      else unavailableReceiptChecks++;
      const records: BillingAccountStatement["records"][number][] = [];
      const ids = [...new Set(history?.packet?.lines.flatMap((line) => line.allocation === "attempt" ? [line.recordId] : []) ?? [])];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const rows = await tx.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.ownerId, LOCAL_OWNER_ID),
          inArray(providerBillingRecords.id, ids.slice(offset, offset + 100))));
        records.push(...await readBillingStates(rows, tx));
      }
      evidence.push({ connectionId: binding.connectionId, requestedVersionId: binding.statementVersionId,
        state: history ?? null, freshness: history?.freshness ?? "unavailable", records });
      snapshots.push({ connectionId: binding.connectionId, requestedVersionId: binding.statementVersionId,
        headFingerprint: history?.head.fingerprint ?? null, freshness: history?.freshness ?? "unavailable",
        liveLedgerFingerprint: history?.liveInspection?.ledgerFingerprint ?? null,
        receiptChecks: history?.liveInspection?.receiptChecks ?? null,
        records: records.map((record) => ({ id: record.id, currentFingerprint: record.currentFingerprint })).sort((left, right) => left.id.localeCompare(right.id)) });
    }
    const report = inspectBillingAccount(input, evidence);
    return { ...report, writes: false as const, packetFingerprint: pricingFingerprint(input), ledgerFingerprint: pricingFingerprint(snapshots),
      inspectedAt: new Date().toISOString(),
      receiptChecks: {
        unit: "billing_records" as const,
        checkedStatements: receiptEvidence.size, unavailableStatements: unavailableReceiptChecks,
        present: [...receiptEvidence.values()].reduce((total, item) => total + item.present, 0),
        retainedWithoutReceipt: [...receiptEvidence.values()].reduce((total, item) => total + item.retainedWithoutReceipt, 0),
      } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
