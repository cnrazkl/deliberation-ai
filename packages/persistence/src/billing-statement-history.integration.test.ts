import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { billingStatementChangeSchema, defaultFakeCouncilMembers, type BillingStatementChangeInput, type BillingStatementVersion } from "@deliberation-ai/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { encryptJson, encryptText } from "./crypto";
import { closeDatabase, getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { deleteProviderConnection, saveProviderConnection } from "./provider-connections";
import { recordProviderBilling, recordProviderBillingChange } from "./provider-billing";
import { getStatementHistory, listStatementHeads, previewStatementVersion, recordStatementVersion, statementIdentity } from "./billing-statement-history";
import { pricingFingerprint } from "./provider-pricing";
import { billingStatementVersions, providerBillingChanges, providerBillingClaims, providerBillingRecords, providerOperations, runs } from "./schema";

const fixtures: Array<{ runId: string; connectionId: string; identity: string }> = [];
const evidence = "SYNTHETIC OFFLINE STATEMENT: one attempt 0.020 USD plus shared tax 0.005 USD. Not a provider invoice.";
const digest = createHash("sha256").update(evidence).digest("hex");
async function fixture() {
  const connection = await saveProviderConnection({ provider: "openai-compatible", label: "Generated DA-086 fixture", apiKey: "", defaultModel: "offline-statement",
    baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object" });
  const runId = randomUUID(); const statementId = `synthetic-${runId}`;
  fixtures.push({ runId, connectionId: connection.id, identity: statementIdentity({ connectionId: connection.id, statementId }) });
  await getDatabase().insert(runs).values({ id: runId, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "offline-statement-history",
    question: "[encrypted]", questionCiphertext: encryptText("Generated statement history fixture", `run:${runId}:question`), snapshotId: randomUUID(),
    status: "cancelled", finishedAt: new Date(), reviewRounds: 0,
    membersCiphertext: encryptJson(defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible", model: "offline-statement", connectionId: connection.id })), `run:${runId}:members`) });
  const [operation] = await getDatabase().insert(providerOperations).values({ id: randomUUID(), runId, memberId: defaultFakeCouncilMembers[0]!.id,
    round: 0, attempt: 1, provider: "openai-compatible", model: "offline-statement", status: "succeeded", submittedAt: new Date(),
    remoteResponseId: randomUUID(), requestFingerprint: "offline-statement-history" }).returning();
  const billingInput = { version: "provider-billing-v1" as const, operationId: operation!.id, connectionId: connection.id, provider: "openai-compatible",
    model: "offline-statement", remoteResponseId: operation!.remoteResponseId!, statementId, lineId: "attempt", documentSha256: digest,
    billedAt: new Date(Date.now() - 1000).toISOString(), reviewedAt: new Date().toISOString(), attribution: "exact_remote_response" as const,
    scope: "all_charges_for_this_attempt" as const, currency: "USD" as const, totalUsd: "0.02", components: [{ kind: "tokens" as const, amountUsd: "0.02" }] };
  const bill = await recordProviderBilling(billingInput, digest);
  const reviewedAt = new Date().toISOString();
  const input: Extract<BillingStatementChangeInput, { action: "record" }> = { version: "billing-statement-change-v1", connectionId: connection.id, statementId,
    expectedFingerprint: null, documentSha256: digest, reviewedAt, reason: "Review generated statement", action: "record",
    packet: { version: "billing-statement-v1", connectionId: connection.id, statementId, documentSha256: digest, reviewedAt,
      currency: "USD", scope: "complete_connection_statement", totalUsd: "0.025", lines: [
        { lineId: bill.lineId, allocation: "attempt", recordId: bill.id, expectedFingerprint: bill.currentFingerprint, amountUsd: bill.totalUsd },
        { lineId: "shared-tax", allocation: "unallocated", kind: "tax", amountUsd: "0.005", reason: "Account tax not allocated to an attempt" },
      ] } };
  return { runId, connection, billingInput, bill, input };
}
function revision(input: Extract<BillingStatementChangeInput, { action: "record" }>, head: BillingStatementVersion) {
  const reviewedAt = new Date().toISOString();
  return { ...input, expectedFingerprint: head.fingerprint, reviewedAt, packet: { ...input.packet, reviewedAt, lines: input.packet.lines.map((line) => ({ ...line })) }, reason: "Review another generated source version" };
}
function withdrawal(head: BillingStatementVersion): BillingStatementChangeInput {
  return { version: "billing-statement-change-v1", action: "void", connectionId: head.input.connectionId, statementId: head.input.statementId,
    expectedFingerprint: head.fingerprint, documentSha256: digest, reviewedAt: new Date().toISOString(), reason: "Withdraw synthetic statement evidence" };
}
afterAll(async () => {
  if (fixtures.length) {
    const runIds = fixtures.map((item) => item.runId);
    await getDatabase().delete(billingStatementVersions).where(inArray(billingStatementVersions.identityFingerprint, fixtures.map((item) => item.identity)));
    const bills = await getDatabase().select({ id: providerBillingRecords.id }).from(providerBillingRecords).where(inArray(providerBillingRecords.runId, runIds));
    if (bills.length) await getDatabase().delete(providerBillingChanges).where(inArray(providerBillingChanges.recordId, bills.map((item) => item.id)));
    if (bills.length) await getDatabase().delete(providerBillingClaims).where(inArray(providerBillingClaims.recordId, bills.map((item) => item.id)));
    await getDatabase().delete(providerBillingRecords).where(inArray(providerBillingRecords.runId, runIds));
    await getDatabase().delete(runs).where(inArray(runs.id, runIds));
    for (const item of fixtures) await deleteProviderConnection(item.connectionId);
  }
  await closeDatabase();
});

test("previews without writes and serializes identical first appends without duplicate snapshots", async () => {
  const data = await fixture();
  expect((await previewStatementVersion(data.input, digest)).inspection!.status).toBe("reconciled_owner_packet");
  expect(await getDatabase().select().from(billingStatementVersions).where(eq(billingStatementVersions.identityFingerprint, statementIdentity(data.input)))).toHaveLength(0);
  const duplicates = await Promise.all(Array.from({ length: 4 }, () => recordStatementVersion(data.input, digest)));
  expect(new Set(duplicates.map((item) => item.id)).size).toBe(1);
  const [stored] = await getDatabase().select().from(billingStatementVersions).where(eq(billingStatementVersions.id, duplicates[0]!.id));
  expect(stored!.payloadCiphertext).not.toContain(data.input.statementId);
  expect(await getStatementHistory(stored!.id)).toMatchObject({ freshness: "current", status: "owner_recorded", providerAuthenticity: "unverified", paymentStatus: "unknown" });
});
test("preserves all packets, folds only the current amount and never reapplies an old exact request", async () => {
  const data = await fixture(); const first = await recordStatementVersion(data.input, digest);
  const [original] = await getDatabase().select().from(billingStatementVersions).where(eq(billingStatementVersions.id, first.id));
  const next = revision(data.input, first); next.packet.totalUsd = "0.026"; next.packet.lines[1]!.amountUsd = "0.006";
  const second = await recordStatementVersion(next, digest);
  const voided = await recordStatementVersion(withdrawal(second), digest);
  const state = (await getStatementHistory(first.id))!;
  expect(state.status).toBe("voided"); expect(state.effective).toBeNull(); expect(state.freshness).toBe("voided");
  expect(state.versions[0]!.inspection!.declaredTotalUsd).toBe("0.025000000000"); expect(state.versions[1]!.inspection!.declaredTotalUsd).toBe("0.026000000000");
  expect((await recordStatementVersion(data.input, digest)).id).toBe(first.id);
  expect((await getStatementHistory(first.id))!.head.id).toBe(voided.id);
  const restored = await recordStatementVersion(revision(data.input, voided), digest);
  expect((await getStatementHistory(restored.id))!.effective!.declaredTotalUsd).toBe("0.025000000000");
  expect((await getDatabase().select().from(billingStatementVersions).where(eq(billingStatementVersions.id, first.id)))[0]!.payloadCiphertext).toBe(original!.payloadCiphertext);
});
test("rejects conflicting reviewed versions, wrong source/identity, incomplete packets and foreign histories", async () => {
  const data = await fixture(); const first = await recordStatementVersion(data.input, digest);
  const left = revision(data.input, first); const right = { ...left, reason: "Competing generated revision" };
  const raced = await Promise.allSettled([recordStatementVersion(left, digest), recordStatementVersion(right, digest)]);
  expect(raced.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(raced.filter((item) => item.status === "rejected")).toHaveLength(1);
  await expect(recordStatementVersion({ ...left, reason: "Another stale edit" }, digest)).rejects.toThrow("stale");
  await expect(previewStatementVersion(data.input, "a".repeat(64))).rejects.toThrow("evidence");
  await expect(previewStatementVersion({ ...data.input, statementId: "different" }, digest)).rejects.toThrow("identity");
  const fresh = revision(data.input, (await getStatementHistory(first.id))!.head);
  await expect(recordStatementVersion({ ...fresh, packet: { ...fresh.packet, totalUsd: "2" } }, digest)).rejects.toThrow("incomplete");
  await getDatabase().update(billingStatementVersions).set({ ownerId: "foreign-generated-statement-owner" }).where(eq(billingStatementVersions.identityFingerprint, statementIdentity(data.input)));
  expect(await getStatementHistory(first.id)).toBeUndefined();
  expect((await listStatementHeads()).some((item) => item.id === first.id)).toBe(false);
  await expect(recordStatementVersion(fresh, digest)).rejects.toThrow("stale");
});
test("marks later billing corrections stale while keeping the recorded snapshot immutable", async () => {
  const data = await fixture(); const first = await recordStatementVersion(data.input, digest);
  const reviewedAt = new Date().toISOString();
  await recordProviderBillingChange({ version: "provider-billing-change-v1", recordId: data.bill.id, expectedFingerprint: data.bill.currentFingerprint,
    action: "replace", reason: "Correct generated receipt", reviewedAt, documentSha256: digest,
    replacement: { ...data.billingInput, reviewedAt, totalUsd: "0.03", components: [{ kind: "tokens", amountUsd: "0.03" }] } }, digest);
  const history = (await getStatementHistory(first.id))!;
  expect(history.freshness).toBe("ledger_changed"); expect(history.liveInspection!.status).toBe("incomplete");
  expect(history.effective!.declaredTotalUsd).toBe("0.025000000000");
  await expect(recordStatementVersion(revision(data.input, first), digest)).rejects.toThrow("incomplete");
});
test("preserves the saved snapshot but denies freshness when live encrypted billing evidence is unreadable", async () => {
  const data = await fixture(); const first = await recordStatementVersion(data.input, digest);
  await getDatabase().update(providerBillingRecords).set({ fingerprint: "altered-generated-proof" }).where(eq(providerBillingRecords.id, data.bill.id));
  try {
    const history = (await getStatementHistory(first.id))!;
    expect(history.freshness).toBe("inspection_unavailable"); expect(history.liveInspection).toBeNull();
    expect(history.effective!.declaredTotalUsd).toBe("0.025000000000"); expect(history.paymentStatus).toBe("unknown");
  } finally { await getDatabase().update(providerBillingRecords).set({ fingerprint: data.bill.fingerprint }).where(eq(providerBillingRecords.id, data.bill.id)); }
});

test("retains statement history after run/connection deletion and reports missing receipts", async () => {
  const data = await fixture(); const first = await recordStatementVersion(data.input, digest);
  await getDatabase().delete(runs).where(eq(runs.id, data.runId)); await deleteProviderConnection(data.connection.id);
  const historical = (await getStatementHistory(first.id))!;
  expect(historical.freshness).toBe("ledger_changed"); expect(historical.liveInspection!.receiptChecks.retainedWithoutReceipt).toBe(1);
  expect(historical.versions).toHaveLength(1);
  const reviewed = await recordStatementVersion(revision(data.input, first), digest);
  expect((await getStatementHistory(reviewed.id))!.freshness).toBe("current");
});
test("fails closed on altered/gapped history and enforces a full 100-version chain", async () => {
  const data = await fixture(); const first = await recordStatementVersion(data.input, digest);
  let head = first; const values: Array<typeof billingStatementVersions.$inferInsert> = [];
  for (let sequence = 2; sequence <= 100; sequence++) {
    const input = billingStatementChangeSchema.parse({ ...withdrawal(head), reviewedAt: first.input.reviewedAt }); const id = randomUUID(); const inspection = null;
    const fingerprint = pricingFingerprint({ input, inspection, sequence });
    values.push({ id, ownerId: LOCAL_OWNER_ID, identityFingerprint: statementIdentity(input), sequence, requestFingerprint: pricingFingerprint(input), fingerprint,
      payloadCiphertext: encryptJson({ input, inspection }, `billing-statement-version:${id}:payload`) });
    head = { id, input, inspection, sequence, fingerprint, recordedAt: first.recordedAt };
  }
  await getDatabase().insert(billingStatementVersions).values(values);
  expect((await getStatementHistory(first.id))!.versions).toHaveLength(100);
  await expect(recordStatementVersion(withdrawal(head), digest)).rejects.toThrow("100");
  await getDatabase().update(billingStatementVersions).set({ fingerprint: "tampered" }).where(eq(billingStatementVersions.id, first.id));
  await expect(getStatementHistory(first.id)).rejects.toThrow("integrity");
  await getDatabase().update(billingStatementVersions).set({ fingerprint: first.fingerprint }).where(eq(billingStatementVersions.id, first.id));
  await getDatabase().delete(billingStatementVersions).where(and(eq(billingStatementVersions.identityFingerprint, statementIdentity(data.input)), eq(billingStatementVersions.sequence, 51)));
  await expect(getStatementHistory(first.id)).rejects.toThrow("history");
  await getDatabase().insert(billingStatementVersions).values(values[49]!);
});
test("operator CLI previews, records and reopens a full statement history with generated evidence", async () => {
  const data = await fixture(); const directory = await mkdtemp(join(tmpdir(), "deliberation-da086-"));
  const inputPath = join(directory, "change.json"); const evidencePath = join(directory, "source.txt");
  const command = (args: string[]) => spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("packages/persistence/scripts/billing-statement-history.ts"), ...args],
    { env: process.env, encoding: "utf8", timeout: 20_000, maxBuffer: 1_000_000 });
  try {
    await writeFile(inputPath, JSON.stringify(data.input)); await writeFile(evidencePath, evidence);
    const preview = command(["preview", inputPath, evidencePath]); expect(preview.status).toBe(0); expect(JSON.parse(preview.stdout).writes).toBe(false);
    const saved = command(["record", inputPath, evidencePath]); expect(saved.status).toBe(0);
    const version = JSON.parse(saved.stdout) as BillingStatementVersion;
    const shown = command(["show", version.id]); expect(shown.status).toBe(0); expect(JSON.parse(shown.stdout).freshness).toBe("current");
    const list = command(["list"]); expect(list.status).toBe(0); expect(JSON.parse(list.stdout).statements.some((item: { id: string }) => item.id === version.id)).toBe(true);
  } finally { await unlink(inputPath).catch(() => {}); await unlink(evidencePath).catch(() => {}); await rmdir(directory); }
}, 30_000);
