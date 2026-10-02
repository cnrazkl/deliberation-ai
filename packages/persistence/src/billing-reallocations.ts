import { randomUUID } from "node:crypto";
import { providerBillingReallocationSchema, type ProviderBillingReallocationInput } from "@deliberation-ai/contracts";
import { validateBillingReallocation } from "@deliberation-ai/domain";
import { and, eq, or } from "drizzle-orm";
import { encryptJson } from "./crypto";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { hydrateBillingReallocation, readBillingStates, validateOwnedBillingReceipt } from "./provider-billing";
import { pricingFingerprint } from "./provider-pricing";
import { providerBillingClaims, providerBillingReallocations, providerBillingRecords, providerOperations, runs } from "./schema";

type Reader = Pick<ReturnType<typeof getDatabase>, "select">;
async function prepare(input: ProviderBillingReallocationInput, evidenceSha256: string, db: Reader) {
  if (input.documentSha256 !== evidenceSha256 || Date.parse(input.reviewedAt) > Date.now()) throw new Error("Reallocation evidence/review is invalid.");
  const [sourceRow] = await db.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.id, input.sourceRecordId), eq(providerBillingRecords.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!sourceRow) throw new Error("Owned billing source was not found.");
  const source = (await readBillingStates([sourceRow], db))[0]!;
  const [existing] = await db.select().from(providerBillingReallocations).where(and(eq(providerBillingReallocations.ownerId, LOCAL_OWNER_ID), eq(providerBillingReallocations.requestFingerprint, pricingFingerprint(input)))).limit(1);
  if (existing) return { source, duplicate: hydrateBillingReallocation(existing), checked: null, sourceLineFingerprint: null, remoteIdentityFingerprint: null };
  validateBillingReallocation(source, input);
  const checked = await validateOwnedBillingReceipt(input.replacement, evidenceSha256, db);
  const sourceLineFingerprint = pricingFingerprint({ connectionId: checked.input.connectionId, statementId: checked.input.statementId, lineId: checked.input.lineId });
  const remoteIdentityFingerprint = pricingFingerprint({ connectionId: checked.input.connectionId, remoteResponseId: checked.input.remoteResponseId });
  const claims = await db.select().from(providerBillingClaims).where(and(eq(providerBillingClaims.ownerId, LOCAL_OWNER_ID), or(
    eq(providerBillingClaims.operationId, checked.input.operationId), eq(providerBillingClaims.sourceLineFingerprint, sourceLineFingerprint), eq(providerBillingClaims.remoteIdentityFingerprint, remoteIdentityFingerprint))));
  if (claims.some((claim) => claim.recordId !== source.id)) throw new Error("Reallocation target identities are already reserved by another billing record.");
  return { source, duplicate: null, checked, sourceLineFingerprint, remoteIdentityFingerprint };
}
export async function previewBillingReallocation(value: ProviderBillingReallocationInput, evidenceSha256: string) {
  const input = providerBillingReallocationSchema.parse(value);
  return getDatabase().transaction((tx) => prepare(input, evidenceSha256, tx), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function recordBillingReallocation(value: ProviderBillingReallocationInput, evidenceSha256: string) {
  const input = providerBillingReallocationSchema.parse(value);
  return getDatabase().transaction(async (tx) => {
    const [source] = await tx.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.id, input.sourceRecordId), eq(providerBillingRecords.ownerId, LOCAL_OWNER_ID))).limit(1);
    if (!source) throw new Error("Owned billing source was not found.");
    const [prior] = await tx.select().from(providerBillingReallocations).where(and(eq(providerBillingReallocations.ownerId, LOCAL_OWNER_ID), eq(providerBillingReallocations.requestFingerprint, pricingFingerprint(input)))).limit(1);
    // Exact replay remains inspectable after run retention and never moves ownership again.
    if (prior) return (await prepare(input, evidenceSha256, tx)).duplicate!;
    const [candidate] = await tx.select({ runId: providerOperations.runId }).from(providerOperations).innerJoin(runs, eq(runs.id, providerOperations.runId))
      .where(and(eq(providerOperations.id, input.replacement.operationId), eq(runs.ownerId, LOCAL_OWNER_ID))).limit(1);
    if (!candidate) throw new Error("Owned target receipt was not found.");
    const runIds = [...new Set([source.runId, candidate.runId])].sort();
    for (const runId of runIds) await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID))).for("update");
    await tx.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.id, input.sourceRecordId), eq(providerBillingRecords.ownerId, LOCAL_OWNER_ID))).for("update");
    await tx.select({ id: providerOperations.id }).from(providerOperations).where(eq(providerOperations.id, input.replacement.operationId)).for("update");
    const prepared = await prepare(input, evidenceSha256, tx);
    if (prepared.duplicate) return prepared.duplicate;
    if (!prepared.checked || !prepared.sourceLineFingerprint || !prepared.remoteIdentityFingerprint) throw new Error("Reallocation receipt is unavailable.");
    const checked = prepared.checked; const targetRecordId = randomUUID(); const id = randomUUID();
    const targetFingerprint = pricingFingerprint({ input: checked.input, receiptFingerprint: checked.receiptFingerprint, runId: checked.runId });
    const [target] = await tx.insert(providerBillingRecords).values({ id: targetRecordId, ownerId: LOCAL_OWNER_ID, operationId: checked.input.operationId,
      runId: checked.runId, sourceLineFingerprint: prepared.sourceLineFingerprint, remoteIdentityFingerprint: prepared.remoteIdentityFingerprint, fingerprint: targetFingerprint,
      payloadCiphertext: encryptJson({ input: checked.input, receiptFingerprint: checked.receiptFingerprint }, `provider-billing:${targetRecordId}:payload`) }).returning();
    const fingerprint = pricingFingerprint({ input, targetRecordId, targetFingerprint });
    const [movement] = await tx.insert(providerBillingReallocations).values({ id, ownerId: LOCAL_OWNER_ID, sourceRecordId: source.id, targetRecordId,
      requestFingerprint: pricingFingerprint(input), fingerprint, payloadCiphertext: encryptJson({ input, targetFingerprint }, `provider-billing-reallocation:${id}:payload`) }).returning();
    await tx.delete(providerBillingClaims).where(eq(providerBillingClaims.recordId, source.id));
    await tx.insert(providerBillingClaims).values({ recordId: targetRecordId, ownerId: LOCAL_OWNER_ID, operationId: target!.operationId,
      sourceLineFingerprint: target!.sourceLineFingerprint, remoteIdentityFingerprint: target!.remoteIdentityFingerprint });
    // Validate both sides and claims before committing; any failure rolls back the complete move.
    await readBillingStates([source, target!], tx);
    return hydrateBillingReallocation(movement!);
  });
}
