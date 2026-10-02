import { billingStatementSchema, type BillingState, type BillingStatementInput } from "@deliberation-ai/contracts";
import { inspectBillingStatement } from "@deliberation-ai/domain";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { billingReceiptFingerprint, hydrateProviderBilling, readBillingStates } from "./provider-billing";
import { pricingFingerprint } from "./provider-pricing";
import { providerBillingRecords, providerConnections, providerOperations } from "./schema";

export async function inspectOwnedBillingStatement(value: BillingStatementInput, evidenceSha256: string) {
  return getDatabase().transaction((tx) => inspectStatementInSnapshot(value, evidenceSha256, tx), { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function inspectStatementInSnapshot(value: BillingStatementInput, evidenceSha256: string, tx: Pick<ReturnType<typeof getDatabase>, "select">) {
  const input = billingStatementSchema.parse(value);
  if (input.documentSha256 !== evidenceSha256 || Date.parse(input.reviewedAt) > Date.now()) throw new Error("Statement evidence/review is invalid.");
    const records: BillingState[] = [];
    const mismatched = new Set<string>();
    let presentReceipts = 0;
    let cursor: string | undefined;
    // Page by stable UUID, never the latest-100 billing detail window. A corrupt chain fails closed.
    for (;;) {
      const page = await tx.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.ownerId, LOCAL_OWNER_ID),
        cursor ? gt(providerBillingRecords.id, cursor) : undefined)).orderBy(asc(providerBillingRecords.id)).limit(100);
      if (!page.length) break;
      const relevant = page.map(hydrateProviderBilling).filter((record) => record.connectionId === input.connectionId && record.statementId === input.statementId);
      if (relevant.length) {
        const states = await readBillingStates(page.filter((row) => relevant.some((record) => record.id === row.id)), tx);
        const receipts = await tx.select().from(providerOperations).where(inArray(providerOperations.id, relevant.map((record) => record.operationId)));
        for (const record of states) {
          records.push(record);
          const receipt = receipts.find((operation) => operation.id === record.operationId);
          // Reallocated historical roots may share one operation; availability is per billing record.
          if (receipt) presentReceipts++;
          // Retention may remove the receipt; the immutable historical fingerprint still survives.
          if (receipt && billingReceiptFingerprint(receipt) !== record.receiptFingerprint) mismatched.add(record.id);
        }
      }
      cursor = page.at(-1)!.id;
    }
    if (!records.length) {
      const [connection] = await tx.select({ id: providerConnections.id }).from(providerConnections).where(and(
        eq(providerConnections.ownerId, LOCAL_OWNER_ID), eq(providerConnections.id, input.connectionId))).limit(1);
      if (!connection) throw new Error("Owned statement connection or historical billing record was not found.");
    }
    const report = inspectBillingStatement(input, records, mismatched);
    return { ...report, writes: false as const, packetFingerprint: pricingFingerprint(input),
      ledgerFingerprint: pricingFingerprint(records.map((record) => ({ id: record.id, currentFingerprint: record.currentFingerprint, receiptMismatch: mismatched.has(record.id) }))),
      inspectedAt: new Date().toISOString(), receiptChecks: { present: presentReceipts, retainedWithoutReceipt: records.length - presentReceipts } };
}
