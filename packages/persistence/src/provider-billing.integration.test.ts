import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultFakeCouncilMembers, type BillingStatementInput, type BillingState, type ProviderBillingInput } from "@deliberation-ai/contracts";
import { eq, inArray } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDatabase, getDatabase } from "./database";
import { decryptJson, encryptJson, encryptText } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { getRunProviderUsage } from "./provider-operations";
import { billingReceiptFingerprint, getProviderBilling, listProviderBilling, previewProviderBilling, recordProviderBilling, previewProviderBillingChange, recordProviderBillingChange } from "./provider-billing";
import { pricingFingerprint } from "./provider-pricing";
import { providerBillingChanges, providerBillingClaims, providerBillingRecords, providerOperations, runs } from "./schema";
import { inspectOwnedBillingStatement } from "./billing-statement";

function statement(bill: BillingState): BillingStatementInput {
  return { version: "billing-statement-v1", connectionId: bill.connectionId, statementId: bill.statementId,
    documentSha256: bill.documentSha256, reviewedAt: new Date().toISOString(), currency: "USD", scope: "complete_connection_statement",
    totalUsd: bill.totalUsd, lines: [{ lineId: bill.lineId, amountUsd: bill.totalUsd, allocation: "attempt", recordId: bill.id, expectedFingerprint: bill.currentFingerprint }] };
}

test("statement command emits read-only reports and distinct incomplete/error exit statuses", async () => {
  const data = await fixture(); const bill = await recordProviderBilling(data.input, data.input.documentSha256);
  const directory = await mkdtemp(join(tmpdir(), "deliberation-da085-"));
  const inputPath = join(directory, "statement.json"); const evidencePath = join(directory, "source.txt");
  const evidence = "SYNTHETIC statement: attempt 0.020 USD. Not a provider invoice.";
  const packet = { ...statement(bill), documentSha256: createHash("sha256").update(evidence).digest("hex") };
  const command = () => spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("packages/persistence/scripts/billing-statement.ts"), inputPath, evidencePath],
    { env: process.env, encoding: "utf8", timeout: 20_000, maxBuffer: 1_000_000 });
  try {
    await writeFile(evidencePath, evidence); await writeFile(inputPath, JSON.stringify(packet));
    const good = command(); expect(good.status).toBe(0);
    expect(JSON.parse(good.stdout)).toMatchObject({ status: "reconciled_owner_packet", writes: false, providerAuthenticity: "unverified", paymentStatus: "unknown" });
    await writeFile(inputPath, JSON.stringify({ ...packet, totalUsd: "1" }));
    const incomplete = command(); expect(incomplete.status).toBe(2);
    expect(JSON.parse(incomplete.stdout).issues[0].reason).toBe("statement_total_mismatch");
    await writeFile(inputPath, JSON.stringify({ ...packet, documentSha256: "e".repeat(64) }));
    const invalid = command(); expect(invalid.status).toBe(1); expect(invalid.stdout).toBe("");
    expect(invalid.stderr).not.toContain(data.input.statementId);
    expect((await getProviderBilling(bill.id))!.changes).toHaveLength(0);
  } finally {
    await unlink(inputPath).catch(() => {}); await unlink(evidencePath).catch(() => {}); await rmdir(directory);
  }
}, 30_000);

const runIds: string[] = [];
async function fixture(ownerId = LOCAL_OWNER_ID, count = 1) {
  const runId = randomUUID(); runIds.push(runId);
  const connectionId = randomUUID();
  const members = defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible", model: "billing-fixture", connectionId }));
  await getDatabase().insert(runs).values({ id: runId, ownerId, idempotencyKey: randomUUID(), requestHash: "offline-billing-fixture",
    question: "[encrypted]", questionCiphertext: encryptText("Offline invoice mapping", `run:${runId}:question`), snapshotId: randomUUID(),
    status: "cancelled", finishedAt: new Date(), reviewRounds: 0, membersCiphertext: encryptJson(members, `run:${runId}:members`) });
  const ops = await getDatabase().insert(providerOperations).values(Array.from({ length: count }, (_, index) => ({ id: randomUUID(), runId,
    memberId: members[0]!.id, provider: "openai-compatible", model: "billing-fixture", round: 0, attempt: index + 1,
    status: "succeeded", submittedAt: new Date(), remoteResponseId: `offline-${randomUUID()}`, requestFingerprint: "offline-billing-fixture" }))).returning();
  const input: ProviderBillingInput = { version: "provider-billing-v1", operationId: ops[0]!.id, connectionId, provider: "openai-compatible",
    model: "billing-fixture", remoteResponseId: ops[0]!.remoteResponseId!, statementId: `synthetic-${runId}`, lineId: "1", documentSha256: "a".repeat(64),
    billedAt: new Date(Date.now() - 1000).toISOString(), reviewedAt: new Date().toISOString(), attribution: "exact_remote_response",
    scope: "all_charges_for_this_attempt", currency: "USD", totalUsd: "0.02", components: [{ kind: "tokens", amountUsd: "0.01" },
      { kind: "tools", amountUsd: "0.02" }, { kind: "credit", amountUsd: "-0.01" }] };
  return { runId, ops, input };
}
afterAll(async () => {
  if (runIds.length) {
    const bills = await getDatabase().select({ id: providerBillingRecords.id }).from(providerBillingRecords).where(inArray(providerBillingRecords.runId, runIds));
    if (bills.length) await getDatabase().delete(providerBillingChanges).where(inArray(providerBillingChanges.recordId, bills.map((item) => item.id)));
    if (bills.length) await getDatabase().delete(providerBillingClaims).where(inArray(providerBillingClaims.recordId, bills.map((item) => item.id)));
    await getDatabase().delete(providerBillingRecords).where(inArray(providerBillingRecords.runId, runIds));
    await getDatabase().delete(runs).where(inArray(runs.id, runIds));
  }
  await closeDatabase();
});

test("inspects statements without writes, separates shared charges and rejects bad evidence or foreign bindings", async () => {
  const data = await fixture(); const bill = await recordProviderBilling(data.input, data.input.documentSha256);
  const packet = statement(bill);
  packet.totalUsd = "0.025";
  packet.lines.push({ lineId: "tax", allocation: "unallocated", kind: "tax", amountUsd: "0.005", reason: "Shared synthetic tax" });
  const [before] = await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.id, bill.id));
  const result = await inspectOwnedBillingStatement(packet, packet.documentSha256);
  expect(result).toMatchObject({ status: "reconciled_owner_packet", writes: false, matchedAttemptSubtotalUsd: "0.020000000000", unallocatedSubtotalUsd: "0.005000000000", receiptChecks: { present: 1, retainedWithoutReceipt: 0 } });
  expect(await getDatabase().select().from(providerBillingChanges).where(eq(providerBillingChanges.recordId, bill.id))).toHaveLength(0);
  expect((await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.id, bill.id)))[0]).toEqual(before);
  await expect(inspectOwnedBillingStatement(packet, "c".repeat(64))).rejects.toThrow("evidence");
  await expect(inspectOwnedBillingStatement({ ...packet, reviewedAt: new Date(Date.now() + 60_000).toISOString() }, packet.documentSha256)).rejects.toThrow("review");
  await getDatabase().update(providerBillingRecords).set({ ownerId: "foreign-statement-fixture" }).where(eq(providerBillingRecords.id, bill.id));
  await expect(inspectOwnedBillingStatement(packet, packet.documentSha256)).rejects.toThrow("Owned");
  const owned = await fixture(); const ownedBill = await recordProviderBilling(owned.input, owned.input.documentSha256);
  const foreignLink = statement(ownedBill); foreignLink.lines[0] = { ...foreignLink.lines[0]!, allocation: "attempt", recordId: bill.id, expectedFingerprint: bill.currentFingerprint };
  expect((await inspectOwnedBillingStatement(foreignLink, foreignLink.documentSha256)).issues[0]!.reason).toBe("record_unavailable");
});

test("statement inspection invalidates corrected, voided or drifted receipts and retains historical provenance", async () => {
  const data = await fixture(); const bill = await recordProviderBilling(data.input, data.input.documentSha256);
  const packet = statement(bill);
  await recordProviderBillingChange({ version: "provider-billing-change-v1", recordId: bill.id, expectedFingerprint: bill.currentFingerprint,
    documentSha256: bill.documentSha256, reviewedAt: new Date().toISOString(), reason: "Synthetic void", action: "void" }, bill.documentSha256);
  expect((await inspectOwnedBillingStatement(packet, packet.documentSha256)).issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["stale_record", "voided_record"]));
  const voided = (await getProviderBilling(bill.id))!; const reviewedAt = new Date().toISOString();
  await recordProviderBillingChange({ version: "provider-billing-change-v1", recordId: bill.id, expectedFingerprint: voided.currentFingerprint,
    documentSha256: bill.documentSha256, reviewedAt, reason: "Synthetic restore", action: "replace", replacement: { ...data.input, reviewedAt } }, bill.documentSha256);
  const fresh = statement((await getProviderBilling(bill.id))!);
  await getDatabase().update(providerOperations).set({ remoteResponseId: "drifted-statement-receipt" }).where(eq(providerOperations.id, bill.operationId));
  const mismatched = await inspectOwnedBillingStatement(fresh, fresh.documentSha256);
  expect(mismatched.issues[0]!.reason).toBe("receipt_mismatch"); expect(mismatched.matchedAttemptSubtotalUsd).toBeNull();
  await getDatabase().update(providerOperations).set({ remoteResponseId: bill.remoteResponseId }).where(eq(providerOperations.id, bill.operationId));
  await getDatabase().delete(runs).where(eq(runs.id, data.runId));
  expect(await inspectOwnedBillingStatement(fresh, fresh.documentSha256)).toMatchObject({ status: "reconciled_owner_packet", receiptChecks: { present: 0, retainedWithoutReceipt: 1 } });
});

test("previews changes without writes, serializes duplicate replacement and preserves original ciphertext", async () => {
  const data = await fixture(); const bill = await recordProviderBilling(data.input, data.input.documentSha256);
  const [before] = await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.id, bill.id));
  const reviewedAt = new Date().toISOString();
  const change = { version: "provider-billing-change-v1" as const, recordId: bill.id, expectedFingerprint: bill.currentFingerprint,
    reviewedAt, reason: "Correct synthetic tool charge", documentSha256: data.input.documentSha256, action: "replace" as const,
    replacement: { ...data.input, reviewedAt, totalUsd: "0.03", components: [{ kind: "tools" as const, amountUsd: "0.03" }] } };
  expect((await previewProviderBillingChange(change, change.documentSha256)).sequence).toBe(1);
  expect(await getDatabase().select().from(providerBillingChanges).where(eq(providerBillingChanges.recordId, bill.id))).toHaveLength(0);
  const [first, duplicate] = await Promise.all([recordProviderBillingChange(change, change.documentSha256), recordProviderBillingChange(change, change.documentSha256)]);
  expect(first!.id).toBe(duplicate!.id);
  expect((await getProviderBilling(bill.id))!.totalUsd).toBe("0.03");
  expect((await getProviderBilling(bill.id))!.original.totalUsd).toBe("0.02");
  expect((await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.id, bill.id)))[0]!.payloadCiphertext).toBe(before!.payloadCiphertext);
  expect((await getRunProviderUsage(data.runId))!.billingLedger.recordedSubtotalUsd).toBe("0.030000000000");
  await expect(recordProviderBillingChange({ ...change, reason: "A different stale request" }, change.documentSha256)).rejects.toThrow("stale");
});
test("keeps voided calls pending, restores via a new replacement and preserves history after run deletion", async () => {
  const data = await fixture(); const bill = await recordProviderBilling(data.input, data.input.documentSha256);
  const change = { version: "provider-billing-change-v1" as const, recordId: bill.id, expectedFingerprint: bill.currentFingerprint,
    reviewedAt: new Date().toISOString(), reason: "Unsupported evidence withdrawn", documentSha256: data.input.documentSha256, action: "void" as const };
  const voided = await recordProviderBillingChange(change, change.documentSha256);
  expect((await getRunProviderUsage(data.runId))!.billingLedger).toMatchObject({ recordedSubtotalUsd: null, recordedOperations: 0, pendingOperations: 1, voidedOperations: 1 });
  const reviewedAt = new Date().toISOString();
  await recordProviderBillingChange({ ...change, action: "replace", expectedFingerprint: voided.fingerprint, reviewedAt,
    replacement: { ...data.input, reviewedAt } }, change.documentSha256);
  expect((await getRunProviderUsage(data.runId))!.billingLedger).toMatchObject({ recordedSubtotalUsd: "0.020000000000", pendingOperations: 0, voidedOperations: 0 });
  await getDatabase().delete(runs).where(eq(runs.id, data.runId));
  expect((await getProviderBilling(bill.id))!.changes).toHaveLength(2);
});
test("rejects foreign changes, evidence mismatch, remapping and conflicting concurrent edits", async () => {
  const data = await fixture(); const bill = await recordProviderBilling(data.input, data.input.documentSha256);
  const change = { version: "provider-billing-change-v1" as const, recordId: bill.id, expectedFingerprint: bill.currentFingerprint,
    reviewedAt: new Date().toISOString(), reason: "Withdraw synthetic evidence", documentSha256: data.input.documentSha256, action: "void" as const };
  await expect(recordProviderBillingChange({ ...change, recordId: randomUUID() }, change.documentSha256)).rejects.toThrow("Owned");
  await expect(recordProviderBillingChange(change, "b".repeat(64))).rejects.toThrow("evidence");
  await expect(recordProviderBillingChange({ ...change, action: "replace", replacement: { ...data.input, reviewedAt: change.reviewedAt, statementId: "different" } }, change.documentSha256)).rejects.toThrow("identity");
  const outcomes = await Promise.allSettled([recordProviderBillingChange(change, change.documentSha256), recordProviderBillingChange({ ...change, reason: "Competing edit" }, change.documentSha256)]);
  expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
  await getDatabase().update(providerBillingRecords).set({ ownerId: "other-owner-change-fixture" }).where(eq(providerBillingRecords.id, bill.id));
  await expect(recordProviderBillingChange(change, change.documentSha256)).rejects.toThrow("Owned");
});
test("validates a 100-event chain, bounds usage history to 10 and fails closed on a missing event", async () => {
  const data = await fixture(); const bill = await recordProviderBilling(data.input, data.input.documentSha256);
  let expectedFingerprint = bill.fingerprint;
  const values = Array.from({ length: 100 }, (_, index) => {
    const input = { version: "provider-billing-change-v1" as const, recordId: bill.id, expectedFingerprint, documentSha256: data.input.documentSha256,
      reviewedAt: data.input.reviewedAt, reason: `Synthetic history ${index}`, action: "replace" as const, replacement: data.input };
    const id = randomUUID(); const sequence = index + 1; const fingerprint = pricingFingerprint({ input, sequence }); expectedFingerprint = fingerprint;
    return { id, ownerId: LOCAL_OWNER_ID, recordId: bill.id, sequence, fingerprint, requestFingerprint: pricingFingerprint(input),
      payloadCiphertext: encryptJson(input, `provider-billing-change:${id}:payload`) };
  });
  await getDatabase().insert(providerBillingChanges).values(values);
  expect((await getProviderBilling(bill.id))!.changes).toHaveLength(100);
  const usage = (await getRunProviderUsage(data.runId))!;
  expect(usage.operations[0]!.billing).toMatchObject({ changeCount: 100, historyTruncated: true });
  expect(usage.operations[0]!.billing!.changes).toHaveLength(10);
  await expect(recordProviderBillingChange({ version: "provider-billing-change-v1", recordId: bill.id, expectedFingerprint,
    documentSha256: data.input.documentSha256, reviewedAt: new Date().toISOString(), reason: "One too many", action: "void" }, data.input.documentSha256)).rejects.toThrow("100");
  await getDatabase().delete(providerBillingChanges).where(eq(providerBillingChanges.id, values[50]!.id));
  await expect(getRunProviderUsage(data.runId)).rejects.toThrow("chain");
  await getDatabase().insert(providerBillingChanges).values(values[50]!);
});
test("previews without writes and records encrypted immutable evidence with concurrent idempotency", async () => {
  const data = await fixture();
  expect((await previewProviderBilling(data.input, data.input.documentSha256)).runId).toBe(data.runId);
  expect(await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.runId, data.runId))).toHaveLength(0);
  const [first, second] = await Promise.all([recordProviderBilling(data.input, data.input.documentSha256), recordProviderBilling(data.input, data.input.documentSha256)]);
  expect(first!.id).toBe(second!.id);
  const [stored] = await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.id, first!.id));
  expect(stored!.payloadCiphertext).not.toContain(data.input.statementId);
  expect(decryptJson<{ input: ProviderBillingInput }>(stored!.payloadCiphertext, `provider-billing:${first!.id}:payload`).input).toEqual(data.input);
  await closeDatabase();
  expect((await getRunProviderUsage(data.runId))!.billingLedger).toEqual({ currency: "USD", recordedSubtotalUsd: "0.020000000000", recordedOperations: 1, pendingOperations: 0, mismatchedOperations: 0, voidedOperations: 0, reallocatedOperations: 0 });
  expect((await getRunProviderUsage(data.runId))!.costLedger.estimatedTokenSubtotalUsd).toBeNull();
});
test("rejects foreign owners, evidence mismatches, unsubmitted receipts and wrong exact identity", async () => {
  const other = await fixture("other-owner-billing-fixture");
  await expect(recordProviderBilling(other.input, other.input.documentSha256)).rejects.toThrow("Owned");
  const data = await fixture();
  await expect(recordProviderBilling(data.input, "b".repeat(64))).rejects.toThrow("digest");
  for (const change of [{ connectionId: randomUUID() }, { remoteResponseId: "wrong" }, { provider: "claude" }, { model: "wrong" }]) {
    await expect(recordProviderBilling({ ...data.input, ...change }, data.input.documentSha256)).rejects.toThrow("exactly");
  }
  await getDatabase().update(providerOperations).set({ submittedAt: null }).where(eq(providerOperations.id, data.input.operationId));
  await expect(recordProviderBilling(data.input, data.input.documentSha256)).rejects.toThrow("exactly");
  expect((await getRunProviderUsage(data.runId))!.billingLedger.pendingOperations).toBe(1);
});
test("never overwrites a calculation or bills one source line / remote response twice", async () => {
  const data = await fixture(LOCAL_OWNER_ID, 3);
  await recordProviderBilling(data.input, data.input.documentSha256);
  await expect(recordProviderBilling({ ...data.input, totalUsd: "1", components: [{ kind: "tokens", amountUsd: "1" }] }, data.input.documentSha256)).rejects.toThrow("immutable");
  await expect(recordProviderBilling({ ...data.input, operationId: data.ops[1]!.id, remoteResponseId: data.ops[1]!.remoteResponseId! }, data.input.documentSha256)).rejects.toThrow("immutable");
  await getDatabase().update(providerOperations).set({ remoteResponseId: data.input.remoteResponseId }).where(eq(providerOperations.id, data.ops[2]!.id));
  await expect(recordProviderBilling({ ...data.input, operationId: data.ops[2]!.id, lineId: "another-line" }, data.input.documentSha256)).rejects.toThrow("immutable");
  expect((await getRunProviderUsage(data.runId))!.billingLedger.recordedSubtotalUsd).toBe("0.020000000000");
});
test("keeps missing billing pending through unknown/discard and excludes later identity drift", async () => {
  const data = await fixture(LOCAL_OWNER_ID, 2);
  await getDatabase().update(providerOperations).set({ status: "outcome_unknown" }).where(eq(providerOperations.id, data.ops[0]!.id));
  expect((await getRunProviderUsage(data.runId))!.billingLedger).toMatchObject({ recordedSubtotalUsd: null, pendingOperations: 2 });
  await recordProviderBilling(data.input, data.input.documentSha256);
  await getDatabase().update(providerOperations).set({ status: "discarded" }).where(eq(providerOperations.id, data.ops[0]!.id));
  expect((await getRunProviderUsage(data.runId))!.billingLedger.recordedOperations).toBe(1);
  await getDatabase().update(providerOperations).set({ remoteResponseId: "changed" }).where(eq(providerOperations.id, data.ops[0]!.id));
  expect((await getRunProviderUsage(data.runId))!.billingLedger).toMatchObject({ recordedSubtotalUsd: null, pendingOperations: 1, mismatchedOperations: 1 });
});
test("retains accounting evidence after run deletion and detects tampered encrypted records", async () => {
  const data = await fixture();
  const bill = await recordProviderBilling(data.input, data.input.documentSha256);
  await getDatabase().delete(runs).where(eq(runs.id, data.runId));
  expect((await listProviderBilling()).find((item) => item.id === bill.id)).toEqual(bill);
  expect(await getProviderBilling(bill.id)).toEqual(bill);
  await getDatabase().update(providerBillingRecords).set({ fingerprint: "tampered" }).where(eq(providerBillingRecords.id, bill.id));
  await expect(listProviderBilling()).rejects.toThrow("integrity");
  await getDatabase().update(providerBillingRecords).set({ fingerprint: bill.fingerprint, ownerId: "other-owner-billing-fixture" }).where(eq(providerBillingRecords.id, bill.id));
  expect((await listProviderBilling()).some((item) => item.id === bill.id)).toBe(false);
  expect(await getProviderBilling(bill.id)).toBeUndefined();
});
test("aggregates all 101 billed attempts despite the 100-row browser detail window", async () => {
  const data = await fixture(LOCAL_OWNER_ID, 101);
  await getDatabase().insert(providerBillingRecords).values(data.ops.map((operation, index) => {
    const input = { ...data.input, operationId: operation.id, remoteResponseId: operation.remoteResponseId!, lineId: String(index), totalUsd: "0.0001",
      components: [{ kind: "tokens" as const, amountUsd: "0.0001" }] };
    const id = randomUUID(); const receiptFingerprint = billingReceiptFingerprint(operation);
    return { id, ownerId: LOCAL_OWNER_ID, operationId: operation.id, runId: data.runId,
      fingerprint: pricingFingerprint({ input, receiptFingerprint, runId: data.runId }),
      sourceLineFingerprint: pricingFingerprint({ connectionId: input.connectionId, statementId: input.statementId, lineId: input.lineId }),
      remoteIdentityFingerprint: pricingFingerprint({ connectionId: input.connectionId, remoteResponseId: input.remoteResponseId }),
      payloadCiphertext: encryptJson({ input, receiptFingerprint }, `provider-billing:${id}:payload`) };
  }));
  const inserted = await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.runId, data.runId));
  await getDatabase().insert(providerBillingClaims).values(inserted.map((row) => ({ recordId: row.id, ownerId: row.ownerId, operationId: row.operationId,
    sourceLineFingerprint: row.sourceLineFingerprint, remoteIdentityFingerprint: row.remoteIdentityFingerprint })));
  const usage = await getRunProviderUsage(data.runId);
  expect(usage!.operations).toHaveLength(100);
  expect(usage!.operations.every((item) => item.billing?.status === "owner_recorded")).toBe(true);
  expect(usage!.billingLedger).toMatchObject({ recordedOperations: 101, pendingOperations: 0, recordedSubtotalUsd: "0.010100000000" });
  const bills = await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.runId, data.runId));
  const packet: BillingStatementInput = { version: "billing-statement-v1", connectionId: data.input.connectionId, statementId: data.input.statementId,
    documentSha256: data.input.documentSha256, reviewedAt: new Date().toISOString(), scope: "complete_connection_statement", currency: "USD", totalUsd: "0.0101",
    lines: bills.map((bill) => ({ lineId: data.ops.findIndex((op) => op.id === bill.operationId).toString(), amountUsd: "0.0001", allocation: "attempt", recordId: bill.id, expectedFingerprint: bill.fingerprint })) };
  expect(await inspectOwnedBillingStatement(packet, packet.documentSha256)).toMatchObject({ status: "reconciled_owner_packet", matchedAttempts: 101, matchedAttemptSubtotalUsd: "0.010100000000" });
  const partial = { ...packet, totalUsd: "0.01", lines: packet.lines.slice(0, 100) };
  expect((await inspectOwnedBillingStatement(partial, partial.documentSha256)).issues).toEqual([{ lineId: packet.lines[100]!.lineId, recordId: bills[100]!.id, reason: "known_record_omitted" }]);
});
