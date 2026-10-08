import { randomUUID } from "node:crypto";
import { providerBillingSchema, providerBillingChangeSchema, providerBillingReallocationSchema, type BillingProjection, type BillingState, type ProviderBillingChange, type ProviderBillingChangeInput, type ProviderBillingInput, type ProviderBillingRecord, type ProviderBillingReallocation } from "@deliberation-ai/contracts";
import { foldBillingChanges, validateBillingAmounts, validateBillingReplacement, validateBillingReallocation } from "@deliberation-ai/domain";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { decryptJson, encryptJson } from "./crypto";
import { getDatabase } from "./database";
import { getOwnerId } from "./owner";
import { pricingFingerprint } from "./provider-pricing";
import { providerBillingChanges, providerBillingClaims, providerBillingReallocations, providerBillingRecords, providerOperations, runs } from "./schema";

type BillingReader = Pick<ReturnType<typeof getDatabase>, "select">;

type BillingReceipt = Pick<typeof providerOperations.$inferSelect, "id" | "runId" | "provider" | "model" | "remoteResponseId">;
export function billingReceiptFingerprint(operation: BillingReceipt): string {
  return pricingFingerprint({ id: operation.id, runId: operation.runId, provider: operation.provider,
    model: operation.model, remoteResponseId: operation.remoteResponseId });
}
export function hydrateProviderBilling(row: typeof providerBillingRecords.$inferSelect): ProviderBillingRecord {
  const payload = decryptJson<{ input: ProviderBillingInput; receiptFingerprint: string }>(row.payloadCiphertext, `provider-billing:${row.id}:payload`);
  const input = providerBillingSchema.parse(payload.input);
  validateBillingAmounts(input);
  if (input.operationId !== row.operationId || pricingFingerprint({ input, receiptFingerprint: payload.receiptFingerprint, runId: row.runId }) !== row.fingerprint
    || pricingFingerprint({ connectionId: input.connectionId, statementId: input.statementId, lineId: input.lineId }) !== row.sourceLineFingerprint
    || pricingFingerprint({ connectionId: input.connectionId, remoteResponseId: input.remoteResponseId }) !== row.remoteIdentityFingerprint) {
    throw new Error("Billing record integrity check failed.");
  }
  return { ...input, id: row.id, runId: row.runId, fingerprint: row.fingerprint,
    receiptFingerprint: payload.receiptFingerprint, recordedAt: row.recordedAt.toISOString() };
}
export function hydrateProviderBillingChange(row: typeof providerBillingChanges.$inferSelect): ProviderBillingChange {
  const input = providerBillingChangeSchema.parse(decryptJson(row.payloadCiphertext, `provider-billing-change:${row.id}:payload`));
  if (input.recordId !== row.recordId || pricingFingerprint(input) !== row.requestFingerprint
    || pricingFingerprint({ input, sequence: row.sequence }) !== row.fingerprint) throw new Error("Billing change integrity check failed.");
  return { ...input, id: row.id, sequence: row.sequence, fingerprint: row.fingerprint, recordedAt: row.recordedAt.toISOString() };
}
export function projectBillingState(record: BillingState, operation: BillingReceipt): BillingProjection {
  return { ...record, status: ["voided", "reallocated"].includes(record.status) ? record.status : record.receiptFingerprint === billingReceiptFingerprint(operation) ? "owner_recorded" : "receipt_mismatch",
    changeCount: record.changes.length, changes: record.changes.slice(-10), historyTruncated: record.changes.length > 10 };
}
export function projectProviderBilling(row: typeof providerBillingRecords.$inferSelect, operation: BillingReceipt, changes: readonly ProviderBillingChange[] = []): BillingProjection {
  return projectBillingState(foldBillingChanges(hydrateProviderBilling(row), changes), operation);
}
export function hydrateBillingReallocation(row: typeof providerBillingReallocations.$inferSelect): ProviderBillingReallocation {
  const payload = decryptJson<{ input: unknown; targetFingerprint: string }>(row.payloadCiphertext, `provider-billing-reallocation:${row.id}:payload`);
  const input = providerBillingReallocationSchema.parse(payload.input);
  if (input.sourceRecordId !== row.sourceRecordId || pricingFingerprint(input) !== row.requestFingerprint
    || pricingFingerprint({ input, targetRecordId: row.targetRecordId, targetFingerprint: payload.targetFingerprint }) !== row.fingerprint) throw new Error("Billing reallocation integrity check failed.");
  return { id: row.id, input, targetRecordId: row.targetRecordId, targetFingerprint: payload.targetFingerprint, fingerprint: row.fingerprint, recordedAt: row.recordedAt.toISOString() };
}
export async function readBillingStates(rows: readonly (typeof providerBillingRecords.$inferSelect)[], db: BillingReader): Promise<BillingState[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const movements = await db.select().from(providerBillingReallocations).where(and(eq(providerBillingReallocations.ownerId, getOwnerId()),
    or(inArray(providerBillingReallocations.sourceRecordId, ids), inArray(providerBillingReallocations.targetRecordId, ids))));
  const linkedIds = [...new Set([...ids, ...movements.flatMap((movement) => [movement.sourceRecordId, movement.targetRecordId])])];
  const linked = await db.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.ownerId, getOwnerId()), inArray(providerBillingRecords.id, linkedIds)));
  const changes = await db.select().from(providerBillingChanges).where(and(eq(providerBillingChanges.ownerId, getOwnerId()), inArray(providerBillingChanges.recordId, linkedIds))).orderBy(asc(providerBillingChanges.sequence));
  const base = new Map(linked.map((row) => [row.id, foldBillingChanges(hydrateProviderBilling(row), changes.filter((change) => change.recordId === row.id).map(hydrateProviderBillingChange))]));
  const events = movements.map(hydrateBillingReallocation);
  for (const event of events) {
    const source = base.get(event.input.sourceRecordId); const target = base.get(event.targetRecordId);
    if (!source || !target || target.fingerprint !== event.targetFingerprint) throw new Error("Billing reallocation linked records are invalid.");
    const targetInput = providerBillingSchema.parse(Object.fromEntries(Object.keys(providerBillingSchema.shape).map((key) => [key, target.original[key as keyof ProviderBillingRecord]])));
    if (pricingFingerprint(event.input.replacement) !== pricingFingerprint(targetInput)) throw new Error("Billing reallocation replacement does not match its target.");
    validateBillingReallocation(source, event.input);
  }
  const claims = await db.select().from(providerBillingClaims).where(inArray(providerBillingClaims.recordId, ids));
  return rows.map((row) => {
    const state = base.get(row.id); if (!state) throw new Error("Owned billing state was not found.");
    const outgoing = events.find((event) => event.input.sourceRecordId === row.id); const incoming = events.find((event) => event.targetRecordId === row.id);
    const claim = claims.find((claim) => claim.recordId === row.id);
    if (outgoing ? !!claim : !claim || claim.ownerId !== row.ownerId || claim.operationId !== row.operationId
      || claim.sourceLineFingerprint !== row.sourceLineFingerprint || claim.remoteIdentityFingerprint !== row.remoteIdentityFingerprint) throw new Error("Billing identity claims do not match current ownership.");
    return { ...state, ...(incoming ? { reallocationIn: incoming } : {}), ...(outgoing ? { status: "reallocated" as const, currentFingerprint: outgoing.fingerprint, reallocationOut: outgoing } : {}) };
  });
}
export async function validateOwnedBillingReceipt(value: ProviderBillingInput, evidenceSha256: string, db: BillingReader): Promise<{ input: ProviderBillingInput; runId: string; receiptFingerprint: string }> {
  const input = providerBillingSchema.parse(value);
  validateBillingAmounts(input);
  if (input.documentSha256 !== evidenceSha256) throw new Error("Billing evidence digest does not match.");
  if (Date.parse(input.reviewedAt) > Date.now() || Date.parse(input.billedAt) > Date.parse(input.reviewedAt)) throw new Error("Billing dates are future or unordered.");
  const [owned] = await db.select({ operation: providerOperations, members: runs.membersCiphertext }).from(providerOperations)
    .innerJoin(runs, eq(runs.id, providerOperations.runId)).where(and(eq(providerOperations.id, input.operationId), eq(runs.ownerId, getOwnerId()))).limit(1);
  if (!owned) throw new Error("Owned billing operation was not found.");
  const operation = owned.operation;
  const members = owned.members ? decryptJson<Array<{ id: string; connectionId?: string; model: string; provider: string }>>(owned.members, `run:${operation.runId}:members`) : [];
  const member = members.find((candidate) => candidate.id === operation.memberId);
  if (!operation.submittedAt || ["prepared", "submitted"].includes(operation.status) || operation.provider !== input.provider || operation.model !== input.model
    || operation.remoteResponseId !== input.remoteResponseId || member?.connectionId !== input.connectionId
    || member.model !== operation.model || member.provider !== operation.provider) {
    throw new Error("Billing evidence does not exactly match a submitted receipt and frozen connection.");
  }
  return { input, runId: operation.runId, receiptFingerprint: billingReceiptFingerprint(operation) };
}
export async function previewProviderBilling(value: ProviderBillingInput, evidenceSha256: string, db: BillingReader = getDatabase()): Promise<{ input: ProviderBillingInput; runId: string; receiptFingerprint: string }> {
  const checked = await validateOwnedBillingReceipt(value, evidenceSha256, db); const input = checked.input;
  const fingerprint = pricingFingerprint({ input, receiptFingerprint: checked.receiptFingerprint, runId: checked.runId });
  const conflicts = await db.select({ fingerprint: providerBillingRecords.fingerprint }).from(providerBillingClaims).innerJoin(providerBillingRecords, eq(providerBillingRecords.id, providerBillingClaims.recordId))
    .where(and(eq(providerBillingClaims.ownerId, getOwnerId()), or(eq(providerBillingClaims.operationId, input.operationId),
      eq(providerBillingClaims.sourceLineFingerprint, pricingFingerprint({ connectionId: input.connectionId, statementId: input.statementId, lineId: input.lineId })),
      eq(providerBillingClaims.remoteIdentityFingerprint, pricingFingerprint({ connectionId: input.connectionId, remoteResponseId: input.remoteResponseId })))));
  if (conflicts.some((row) => row.fingerprint !== fingerprint)) throw new Error("Billing operation or source line already has a different immutable record.");
  return checked;
}
export async function recordProviderBilling(input: ProviderBillingInput, evidenceSha256: string): Promise<BillingState> {
  input = providerBillingSchema.parse(input);
  // Recheck receipt under the same run/attempt locks used by submission and resolution.
  return getDatabase().transaction(async (tx) => {
    const [candidate] = await tx.select({ runId: providerOperations.runId }).from(providerOperations).where(eq(providerOperations.id, input.operationId)).limit(1);
    if (!candidate) throw new Error("Owned billing operation was not found.");
    const [run] = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.id, candidate.runId), eq(runs.ownerId, getOwnerId()))).for("update").limit(1);
    if (!run) throw new Error("Owned billing operation was not found.");
    const [operation] = await tx.select().from(providerOperations).where(eq(providerOperations.id, input.operationId)).for("update").limit(1);
    if (!operation) throw new Error("Owned billing operation was not found.");
    const checked = await validateOwnedBillingReceipt(input, evidenceSha256, tx);
    const fingerprint = pricingFingerprint({ input: checked.input, receiptFingerprint: checked.receiptFingerprint, runId: checked.runId });
    const [historical] = await tx.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.ownerId, getOwnerId()), eq(providerBillingRecords.fingerprint, fingerprint))).limit(1);
    if (historical) return (await readBillingStates([historical], tx))[0]!;
    await previewProviderBilling(input, evidenceSha256, tx);
    const id = randomUUID();
    const [created] = await tx.insert(providerBillingRecords).values({ id, ownerId: getOwnerId(), operationId: input.operationId,
      runId: checked.runId, fingerprint, sourceLineFingerprint: pricingFingerprint({ connectionId: checked.input.connectionId, statementId: checked.input.statementId, lineId: checked.input.lineId }),
      remoteIdentityFingerprint: pricingFingerprint({ connectionId: checked.input.connectionId, remoteResponseId: checked.input.remoteResponseId }),
      payloadCiphertext: encryptJson({ input: checked.input, receiptFingerprint: checked.receiptFingerprint }, `provider-billing:${id}:payload`) }).onConflictDoNothing().returning();
    if (created) {
      await tx.insert(providerBillingClaims).values({ recordId: created.id, ownerId: getOwnerId(), operationId: created.operationId,
        sourceLineFingerprint: created.sourceLineFingerprint, remoteIdentityFingerprint: created.remoteIdentityFingerprint });
      return (await readBillingStates([created], tx))[0]!;
    }
    const [existing] = await tx.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.ownerId, getOwnerId()),
      eq(providerBillingRecords.fingerprint, fingerprint))).limit(1);
    if (existing?.fingerprint === fingerprint) {
      return (await readBillingStates([existing], tx))[0]!;
    }
    throw new Error("Billing operation or source line already has a different immutable record.");
  });
}
export async function listProviderBilling(): Promise<BillingState[]> {
  return getDatabase().transaction(async (db) => {
  const rows = await db.select().from(providerBillingRecords).where(eq(providerBillingRecords.ownerId, getOwnerId()))
    .orderBy(desc(providerBillingRecords.recordedAt), desc(providerBillingRecords.id)).limit(100);
  return readBillingStates(rows, db);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function getProviderBilling(id: string): Promise<BillingState | undefined> {
  return getDatabase().transaction(async (db) => {
  const [row] = await db.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.ownerId, getOwnerId()),
    eq(providerBillingRecords.id, id))).limit(1);
  if (!row) return undefined;
  return (await readBillingStates([row], db))[0];
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function previewProviderBillingChange(value: ProviderBillingChangeInput, evidenceSha256: string,
  db: Pick<ReturnType<typeof getDatabase>, "select"> = getDatabase()): Promise<{ input: ProviderBillingChangeInput; sequence: number; duplicate: ProviderBillingChange | null }> {
  const input = providerBillingChangeSchema.parse(value);
  if (input.documentSha256 !== evidenceSha256 || Date.parse(input.reviewedAt) > Date.now()) throw new Error("Billing change evidence/review is invalid.");
  const [root] = await db.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.ownerId, getOwnerId()), eq(providerBillingRecords.id, input.recordId))).limit(1);
  if (!root) throw new Error("Owned billing record was not found.");
  const rows = await db.select().from(providerBillingChanges).where(and(eq(providerBillingChanges.ownerId, getOwnerId()), eq(providerBillingChanges.recordId, input.recordId))).orderBy(asc(providerBillingChanges.sequence));
  const changes = rows.map(hydrateProviderBillingChange);
  const original = hydrateProviderBilling(root);
  const state = foldBillingChanges(original, changes);
  validateBillingReplacement(original, input);
  const duplicate = changes.find((change) => rows.find((row) => row.id === change.id)?.requestFingerprint === pricingFingerprint(input));
  if (duplicate) return { input, sequence: duplicate.sequence, duplicate };
  if ((await readBillingStates([root], db))[0]!.status === "reallocated") throw new Error("Reallocated source evidence cannot be reactivated or edited.");
  if (input.expectedFingerprint !== state.currentFingerprint) throw new Error("Billing change is stale; review the current version first.");
  if (Date.parse(input.reviewedAt) < Date.parse(changes.at(-1)?.reviewedAt ?? original.reviewedAt)) throw new Error("Billing reviews must be chronological.");
  if (changes.length >= 100) throw new Error("Billing change limit is 100 per record.");
  return { input, sequence: changes.length + 1, duplicate: null };
}
export async function recordProviderBillingChange(value: ProviderBillingChangeInput, evidenceSha256: string): Promise<ProviderBillingChange> {
  const input = providerBillingChangeSchema.parse(value);
  return getDatabase().transaction(async (tx) => {
    const [root] = await tx.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.ownerId, getOwnerId()), eq(providerBillingRecords.id, input.recordId))).for("update").limit(1);
    if (!root) throw new Error("Owned billing record was not found.");
    const checked = await previewProviderBillingChange(input, evidenceSha256, tx);
    if (checked.duplicate) return checked.duplicate;
    const id = randomUUID();
    const [row] = await tx.insert(providerBillingChanges).values({ id, ownerId: getOwnerId(), recordId: input.recordId, sequence: checked.sequence,
      requestFingerprint: pricingFingerprint(checked.input), fingerprint: pricingFingerprint({ input: checked.input, sequence: checked.sequence }),
      payloadCiphertext: encryptJson(checked.input, `provider-billing-change:${id}:payload`) }).returning();
    return hydrateProviderBillingChange(row!);
  });
}
