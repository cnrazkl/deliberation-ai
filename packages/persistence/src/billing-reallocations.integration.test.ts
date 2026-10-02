import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultFakeCouncilMembers, type ProviderBillingInput, type ProviderBillingReallocationInput, type BillingState } from "@deliberation-ai/contracts";
import { eq, inArray, or } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { encryptJson, encryptText } from "./crypto";
import { closeDatabase, getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { getProviderBilling, recordProviderBilling, recordProviderBillingChange } from "./provider-billing";
import { recordBillingReallocation, previewBillingReallocation } from "./billing-reallocations";
import { getRunProviderUsage } from "./provider-operations";
import { getStatementHistory, recordStatementVersion } from "./billing-statement-history";
import { billingStatementVersions, providerBillingClaims, providerBillingChanges, providerBillingRecords, providerBillingReallocations, providerOperations, runs } from "./schema";

const runIds: string[] = []; const statementIds: string[] = [];
const evidence = "SYNTHETIC OFFLINE REALLOCATION: corrected attribution of a 0.020 USD line. Not a provider invoice.";
const digest = createHash("sha256").update(evidence).digest("hex");
async function fixture(ownerId = LOCAL_OWNER_ID) {
  const runId = randomUUID(); runIds.push(runId); const connectionId = randomUUID();
  const members = defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible", model: "offline-reallocation", connectionId }));
  await getDatabase().insert(runs).values({ id: runId, ownerId, idempotencyKey: randomUUID(), requestHash: "generated-reallocation",
    question: "[encrypted]", questionCiphertext: encryptText("Generated offline reallocation", `run:${runId}:question`), snapshotId: randomUUID(),
    status: "cancelled", finishedAt: new Date(), reviewRounds: 0, membersCiphertext: encryptJson(members, `run:${runId}:members`) });
  const operations = await getDatabase().insert(providerOperations).values([1, 2].map((attempt) => ({ id: randomUUID(), runId,
    memberId: members[0]!.id, provider: "openai-compatible", model: "offline-reallocation", round: 0, attempt,
    status: "succeeded", submittedAt: new Date(), remoteResponseId: randomUUID(), requestFingerprint: "generated-reallocation" }))).returning();
  const input: ProviderBillingInput = { version: "provider-billing-v1", operationId: operations[0]!.id, connectionId,
    provider: "openai-compatible", model: "offline-reallocation", remoteResponseId: operations[0]!.remoteResponseId!, statementId: `synthetic-${runId}`, lineId: "line",
    documentSha256: digest, billedAt: new Date(Date.now() - 1000).toISOString(), reviewedAt: new Date().toISOString(),
    attribution: "exact_remote_response", scope: "all_charges_for_this_attempt", currency: "USD", totalUsd: "0.02", components: [{ kind: "tokens", amountUsd: "0.02" }] };
  return { runId, connectionId, operations, input };
}
function move(source: BillingState, replacement: ProviderBillingInput): ProviderBillingReallocationInput {
  const reviewedAt = new Date().toISOString();
  return { version: "provider-billing-reallocation-v1", sourceRecordId: source.id, expectedFingerprint: source.currentFingerprint,
    documentSha256: digest, reviewedAt, reason: "Correct generated attribution", replacement: { ...replacement, reviewedAt, documentSha256: digest } };
}
afterAll(async () => {
  if (statementIds.length) await getDatabase().delete(billingStatementVersions).where(inArray(billingStatementVersions.id, statementIds));
  if (runIds.length) {
    const roots = await getDatabase().select({ id: providerBillingRecords.id }).from(providerBillingRecords).where(inArray(providerBillingRecords.runId, runIds));
    const ids = roots.map((root) => root.id);
    if (ids.length) {
      await getDatabase().delete(providerBillingReallocations).where(or(inArray(providerBillingReallocations.sourceRecordId, ids), inArray(providerBillingReallocations.targetRecordId, ids)));
      await getDatabase().delete(providerBillingClaims).where(inArray(providerBillingClaims.recordId, ids));
      await getDatabase().delete(providerBillingChanges).where(inArray(providerBillingChanges.recordId, ids));
      await getDatabase().delete(providerBillingRecords).where(inArray(providerBillingRecords.id, ids));
    }
    await getDatabase().delete(runs).where(inArray(runs.id, runIds));
  }
  await closeDatabase();
});

test("previews without writes and moves one invoice line atomically between owned calls", async () => {
  const data = await fixture(); const source = await recordProviderBilling(data.input, digest);
  const [before] = await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.id, source.id));
  const target = data.operations[1]!;
  const input = move(source, { ...data.input, operationId: target.id, remoteResponseId: target.remoteResponseId! });
  expect((await previewBillingReallocation(input, digest)).checked!.runId).toBe(data.runId);
  expect(await getDatabase().select().from(providerBillingReallocations).where(eq(providerBillingReallocations.sourceRecordId, source.id))).toHaveLength(0);
  const [first, duplicate] = await Promise.all([recordBillingReallocation(input, digest), recordBillingReallocation(input, digest)]);
  expect(first.id).toBe(duplicate.id);
  expect((await getDatabase().select().from(providerBillingRecords).where(eq(providerBillingRecords.id, source.id)))[0]!.payloadCiphertext).toBe(before!.payloadCiphertext);
  expect(await getProviderBilling(source.id)).toMatchObject({ status: "reallocated", reallocationOut: { targetRecordId: first.targetRecordId } });
  expect(await getProviderBilling(first.targetRecordId)).toMatchObject({ status: "owner_recorded", reallocationIn: { input: { sourceRecordId: source.id } } });
  const usage = (await getRunProviderUsage(data.runId))!;
  expect(usage.billingLedger).toMatchObject({ recordedOperations: 1, pendingOperations: 1, reallocatedOperations: 1, recordedSubtotalUsd: "0.020000000000" });
  expect(usage.operations.find((operation) => operation.id === target.id)!.billing!.id).toBe(first.targetRecordId);
  expect((await recordProviderBilling(data.input, digest)).status).toBe("reallocated");
  await expect(recordProviderBillingChange({ version: "provider-billing-change-v1", recordId: source.id, expectedFingerprint: first.fingerprint,
    action: "void", documentSha256: digest, reviewedAt: new Date().toISOString(), reason: "Attempt to alter historical source" }, digest)).rejects.toThrow("reactivated");
});
test("can correct source identity on one call and reallocate again through a new immutable root", async () => {
  const data = await fixture(); const source = await recordProviderBilling(data.input, digest);
  const first = await recordBillingReallocation(move(source, { ...data.input, lineId: "corrected-line" }), digest);
  expect((await getRunProviderUsage(data.runId))!.billingLedger).toMatchObject({ recordedOperations: 1, reallocatedOperations: 0, recordedSubtotalUsd: "0.020000000000" });
  const current = (await getProviderBilling(first.targetRecordId))!; const target = data.operations[1]!;
  const second = await recordBillingReallocation(move(current, { ...data.input, lineId: "corrected-line", operationId: target.id, remoteResponseId: target.remoteResponseId! }), digest);
  expect((await recordBillingReallocation(first.input, digest)).id).toBe(first.id);
  expect((await getProviderBilling(second.targetRecordId))!.status).toBe("owner_recorded");
  expect((await getProviderBilling(first.targetRecordId))!.status).toBe("reallocated");
});
test("keeps void reservations until explicit reallocation and blocks conflicting target claims", async () => {
  const data = await fixture(); const source = await recordProviderBilling(data.input, digest);
  const change = await recordProviderBillingChange({ version: "provider-billing-change-v1", recordId: source.id, expectedFingerprint: source.currentFingerprint,
    action: "void", documentSha256: digest, reviewedAt: new Date().toISOString(), reason: "Withdraw generated mapping" }, digest);
  const target = data.operations[1]!;
  await expect(recordProviderBilling({ ...data.input, operationId: target.id, remoteResponseId: target.remoteResponseId! }, digest)).rejects.toThrow("immutable");
  const voided = (await getProviderBilling(source.id))!;
  const moved = await recordBillingReallocation(move(voided, { ...data.input, operationId: target.id, remoteResponseId: target.remoteResponseId! }), digest);
  expect(moved.input.expectedFingerprint).toBe(change.fingerprint);
  const other = await fixture(); const otherSource = await recordProviderBilling(other.input, digest);
  await expect(recordBillingReallocation(move(otherSource, { ...data.input, operationId: target.id, remoteResponseId: target.remoteResponseId! }), digest)).rejects.toThrow("reserved");
  expect(await getDatabase().select().from(providerBillingClaims).where(eq(providerBillingClaims.recordId, otherSource.id))).toHaveLength(1);
  expect((await getProviderBilling(otherSource.id))!.status).toBe("owner_recorded");
});
test("rejects foreign targets, stale reviews, mismatched evidence and nonmatching receipts", async () => {
  const data = await fixture(); const source = await recordProviderBilling(data.input, digest); const other = await fixture("foreign-generated-owner");
  await expect(recordBillingReallocation(move(source, other.input), digest)).rejects.toThrow("Owned");
  const valid = move(source, { ...data.input, lineId: "new-line" });
  await expect(recordBillingReallocation({ ...valid, expectedFingerprint: "a".repeat(64) }, digest)).rejects.toThrow("stale");
  await expect(recordBillingReallocation(valid, "b".repeat(64))).rejects.toThrow("evidence");
  await expect(recordBillingReallocation({ ...valid, replacement: { ...valid.replacement, remoteResponseId: "wrong" } }, digest)).rejects.toThrow("exactly");
  const raced = await Promise.allSettled([recordBillingReallocation(valid, digest), recordBillingReallocation({ ...valid, reason: "Conflicting review" }, digest)]);
  expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(raced.filter((result) => result.status === "rejected")).toHaveLength(1);
});
test("serializes different sources competing for one free receipt without releasing the losing source", async () => {
  const left = await fixture(); const right = await fixture(); const target = await fixture();
  const a = await recordProviderBilling(left.input, digest); const b = await recordProviderBilling(right.input, digest);
  const raced = await Promise.allSettled([recordBillingReallocation(move(a, target.input), digest), recordBillingReallocation(move(b, target.input), digest)]);
  expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const states = [(await getProviderBilling(a.id))!, (await getProviderBilling(b.id))!];
  expect(states.filter((state) => state.status === "reallocated")).toHaveLength(1);
  const untouched = states.find((state) => state.status === "owner_recorded")!;
  expect(await getDatabase().select().from(providerBillingClaims).where(eq(providerBillingClaims.recordId, untouched.id))).toHaveLength(1);
  expect((await getRunProviderUsage(target.runId))!.billingLedger).toMatchObject({ recordedOperations: 1, recordedSubtotalUsd: "0.020000000000" });
});

test("refreshes durable statement coverage to the new attribution without double counting history", async () => {
  const data = await fixture(); const source = await recordProviderBilling(data.input, digest); let reviewedAt = new Date().toISOString();
  const packet = { version: "billing-statement-v1" as const, connectionId: data.connectionId, statementId: data.input.statementId, documentSha256: digest, reviewedAt,
    currency: "USD" as const, scope: "complete_connection_statement" as const, totalUsd: "0.02", lines: [{ allocation: "attempt" as const,
      lineId: source.lineId, recordId: source.id, expectedFingerprint: source.currentFingerprint, amountUsd: source.totalUsd }] };
  const saved = await recordStatementVersion({ version: "billing-statement-change-v1", connectionId: data.connectionId, statementId: packet.statementId,
    expectedFingerprint: null, documentSha256: digest, reviewedAt, reason: "Generated statement", action: "record", packet }, digest); statementIds.push(saved.id);
  const target = data.operations[1]!; const transfer = await recordBillingReallocation(move(source, { ...data.input, operationId: target.id, remoteResponseId: target.remoteResponseId! }), digest);
  expect((await getStatementHistory(saved.id))!.freshness).toBe("ledger_changed");
  const current = (await getProviderBilling(transfer.targetRecordId))!; reviewedAt = new Date().toISOString();
  const next = await recordStatementVersion({ ...saved.input, action: "record", expectedFingerprint: saved.fingerprint, reviewedAt,
    packet: { ...packet, reviewedAt, lines: [{ ...packet.lines[0]!, recordId: current.id, expectedFingerprint: current.currentFingerprint }] } }, digest); statementIds.push(next.id);
  expect((await getStatementHistory(next.id))!.freshness).toBe("current");
  expect((await getStatementHistory(next.id))!.effective!.matchedAttempts).toBe(1);
});
test("preserves moves after source and target run retention and rejects altered event/claim links", async () => {
  const data = await fixture(); const other = await fixture(); const source = await recordProviderBilling(data.input, digest);
  const movement = await recordBillingReallocation(move(source, other.input), digest);
  await getDatabase().delete(runs).where(inArray(runs.id, [data.runId, other.runId]));
  expect((await recordBillingReallocation(movement.input, digest)).id).toBe(movement.id);
  expect((await getProviderBilling(movement.targetRecordId))!.reallocationIn!.id).toBe(movement.id);
  await getDatabase().update(providerBillingReallocations).set({ fingerprint: "altered" }).where(eq(providerBillingReallocations.id, movement.id));
  await expect(getProviderBilling(source.id)).rejects.toThrow("integrity");
  await getDatabase().update(providerBillingReallocations).set({ fingerprint: movement.fingerprint }).where(eq(providerBillingReallocations.id, movement.id));
  await getDatabase().update(providerBillingClaims).set({ operationId: randomUUID() }).where(eq(providerBillingClaims.recordId, movement.targetRecordId));
  await expect(getProviderBilling(movement.targetRecordId)).rejects.toThrow("claims");
  await getDatabase().update(providerBillingClaims).set({ operationId: other.input.operationId }).where(eq(providerBillingClaims.recordId, movement.targetRecordId));
});
test("operator CLI previews and records generated evidence and exposes source/target provenance", async () => {
  const data = await fixture(); const source = await recordProviderBilling(data.input, digest); const target = data.operations[1]!;
  const input = move(source, { ...data.input, operationId: target.id, remoteResponseId: target.remoteResponseId! });
  const directory = await mkdtemp(join(tmpdir(), "deliberation-da087-")); const inputPath = join(directory, "change.json"); const sourcePath = join(directory, "source.txt");
  const command = (args: string[]) => spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("packages/persistence/scripts/provider-billing.ts"), ...args],
    { env: process.env, encoding: "utf8", timeout: 20_000, maxBuffer: 1_000_000 });
  try {
    await writeFile(inputPath, JSON.stringify(input)); await writeFile(sourcePath, evidence);
    const preview = command(["reallocate-preview", inputPath, sourcePath]); expect(preview.status).toBe(0); expect(JSON.parse(preview.stdout).writes).toBe(false);
    const saved = command(["reallocate-record", inputPath, sourcePath]); expect(saved.status).toBe(0); const targetId = JSON.parse(saved.stdout).targetRecordId as string;
    const shown = command(["show", targetId]); expect(shown.status).toBe(0); expect(JSON.parse(shown.stdout).reallocationIn.input.sourceRecordId).toBe(source.id);
  } finally { await unlink(inputPath).catch(() => {}); await unlink(sourcePath).catch(() => {}); await rmdir(directory); }
}, 30_000);
