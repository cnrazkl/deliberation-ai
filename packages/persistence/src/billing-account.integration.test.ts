import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultFakeCouncilMembers, type BillingAccountInput, type BillingStatementChangeInput } from "@deliberation-ai/contracts";
import { eq, inArray, or } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { inspectOwnedBillingAccount } from "./billing-account";
import { recordBillingReallocation } from "./billing-reallocations";
import { recordStatementVersion, statementIdentity } from "./billing-statement-history";
import { encryptJson, encryptText } from "./crypto";
import { closeDatabase, getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { deleteProviderConnection, saveProviderConnection } from "./provider-connections";
import { getProviderBilling, recordProviderBilling, recordProviderBillingChange } from "./provider-billing";
import { billingStatementVersions, providerBillingChanges, providerBillingClaims, providerBillingReallocations, providerBillingRecords, providerOperations, runs } from "./schema";

const fixtureIds: Array<{ runId: string; connectionId: string; identity: string }> = [];
const evidence = "GENERATED DA-088 OFFLINE INVOICE: two connections, 0.020 and 0.030 USD, account tax 0.005. Not a provider invoice.";
const digest = createHash("sha256").update(evidence).digest("hex");
async function fixture(duplicates = false) {
  const db = getDatabase(); const invoiceId = `generated-account-${randomUUID()}`; const responseId = randomUUID();
  const slices = [];
  for (let index = 0; index < 2; index++) {
    const connection = await saveProviderConnection({ provider: "openai-compatible", label: `DA-088 ${invoiceId} ${index}`, apiKey: "",
      defaultModel: "offline-account", baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object" });
    const runId = randomUUID(); fixtureIds.push({ runId, connectionId: connection.id, identity: statementIdentity({ connectionId: connection.id, statementId: invoiceId }) });
    await db.insert(runs).values({ id: runId, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "offline-account",
      question: "[encrypted]", questionCiphertext: encryptText("Generated account invoice fixture", `run:${runId}:question`), snapshotId: randomUUID(),
      status: "cancelled", finishedAt: new Date(), reviewRounds: 0,
      membersCiphertext: encryptJson(defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible", model: "offline-account", connectionId: connection.id })), `run:${runId}:members`) });
    const [operation] = await db.insert(providerOperations).values({ id: randomUUID(), runId, memberId: defaultFakeCouncilMembers[0]!.id, round: 0, attempt: 1,
      provider: "openai-compatible", model: "offline-account", status: "succeeded", submittedAt: new Date(),
      remoteResponseId: duplicates ? responseId : randomUUID(), requestFingerprint: "offline-account" }).returning();
    const billingInput = { version: "provider-billing-v1" as const, operationId: operation!.id, connectionId: connection.id, provider: "openai-compatible",
      model: "offline-account", remoteResponseId: operation!.remoteResponseId!, statementId: invoiceId, lineId: duplicates ? "duplicate-line" : `attempt-${index}`,
      documentSha256: digest, billedAt: new Date(Date.now() - 1000).toISOString(), reviewedAt: new Date().toISOString(),
      attribution: "exact_remote_response" as const, scope: "all_charges_for_this_attempt" as const, currency: "USD" as const,
      totalUsd: index === 0 ? "0.020" : "0.030", components: [{ kind: "tokens" as const, amountUsd: index === 0 ? "0.020" : "0.030" }] };
    const bill = await recordProviderBilling(billingInput, digest); const reviewedAt = new Date().toISOString();
    const change: Extract<BillingStatementChangeInput, { action: "record" }> = { version: "billing-statement-change-v1", connectionId: connection.id,
      statementId: invoiceId, expectedFingerprint: null, documentSha256: digest, reviewedAt, reason: "Review generated invoice slice", action: "record",
      packet: { version: "billing-statement-v1", connectionId: connection.id, statementId: invoiceId, documentSha256: digest, reviewedAt,
        currency: "USD", scope: "complete_connection_statement", totalUsd: bill.totalUsd,
        lines: [{ allocation: "attempt", recordId: bill.id, expectedFingerprint: bill.currentFingerprint, lineId: bill.lineId, amountUsd: bill.totalUsd }] } };
    const version = await recordStatementVersion(change, digest);
    slices.push({ runId, connection, bill, billingInput, change, version });
  }
  const input: BillingAccountInput = { version: "billing-account-v1", provider: "openai-compatible", accountReference: "generated-owner-account",
    invoiceId, documentSha256: digest, reviewedAt: new Date().toISOString(), currency: "USD", scope: "complete_declared_connections_invoice",
    period: { start: new Date(Date.now() - 86400000).toISOString().slice(0, 10), endExclusive: new Date(Date.now() + 86400000).toISOString().slice(0, 10) },
    totalUsd: "0.055", connections: slices.map((slice) => ({ connectionId: slice.connection.id, accountMappingReason: "Generated offline account mapping",
      statementVersionId: slice.version.id, expectedFingerprint: slice.version.fingerprint })),
    unallocatedLines: [{ lineId: "account-tax", amountUsd: "0.005", kind: "tax", reason: "One account tax, not attributed to attempts" }] };
  return { input, slices };
}
afterAll(async () => {
  const db = getDatabase();
  if (fixtureIds.length) {
    const runIds = fixtureIds.map((item) => item.runId);
    await db.delete(billingStatementVersions).where(inArray(billingStatementVersions.identityFingerprint, fixtureIds.map((item) => item.identity)));
    const roots = await db.select({ id: providerBillingRecords.id }).from(providerBillingRecords).where(inArray(providerBillingRecords.runId, runIds));
    if (roots.length) {
      const ids = roots.map((row) => row.id);
      await db.delete(providerBillingReallocations).where(or(inArray(providerBillingReallocations.sourceRecordId, ids), inArray(providerBillingReallocations.targetRecordId, ids)));
      await db.delete(providerBillingChanges).where(inArray(providerBillingChanges.recordId, ids));
      await db.delete(providerBillingClaims).where(inArray(providerBillingClaims.recordId, ids));
      await db.delete(providerBillingRecords).where(inArray(providerBillingRecords.id, ids));
    }
    await db.delete(runs).where(inArray(runs.id, runIds));
    for (const item of fixtureIds) await deleteProviderConnection(item.connectionId);
  }
  await closeDatabase();
});
test("checks multiple connections in one read-only snapshot without changing saved evidence or dispatch", async () => {
  const data = await fixture(); const db = getDatabase();
  const before = await db.select().from(billingStatementVersions).where(inArray(billingStatementVersions.id, data.slices.map((slice) => slice.version.id)));
  const report = await inspectOwnedBillingAccount(data.input, digest);
  expect(report).toMatchObject({ status: "reconciled_owner_account_packet", writes: false, listedCurrentTotalUsd: "0.055000000000",
    matchedAttemptSubtotalUsd: "0.050000000000", unallocatedSubtotalUsd: "0.005000000000", matchedAttempts: 2,
    accountIdentity: "owner_declared", paymentStatus: "unknown", providerAuthenticity: "unverified", monetaryDispatchAllowed: false,
    receiptChecks: { checkedStatements: 2, unavailableStatements: 0, present: 2, retainedWithoutReceipt: 0 } });
  expect(await db.select().from(billingStatementVersions).where(inArray(billingStatementVersions.id, data.slices.map((slice) => slice.version.id)))).toEqual(before);
  expect((await inspectOwnedBillingAccount(data.input, digest)).ledgerFingerprint).toBe(report.ledgerFingerprint);
  expect((await getProviderBilling(data.slices[0]!.bill.id))!.currentFingerprint).toBe(data.slices[0]!.bill.currentFingerprint);
});

test("rejects mismatched evidence, future reviews and foreign or wrong-identity statement references", async () => {
  const data = await fixture(); const first = data.slices[0]!;
  await expect(inspectOwnedBillingAccount(data.input, "a".repeat(64))).rejects.toThrow("evidence");
  await expect(inspectOwnedBillingAccount({ ...data.input, reviewedAt: new Date(Date.now() + 60000).toISOString() }, digest)).rejects.toThrow("review");
  expect((await inspectOwnedBillingAccount({ ...data.input, invoiceId: "different-invoice" }, digest)).issues.map((issue) => issue.reason)).toContain("statement_identity_mismatch");
  await getDatabase().update(billingStatementVersions).set({ ownerId: "generated-foreign-account-owner" }).where(eq(billingStatementVersions.id, first.version.id));
  try {
    const report = await inspectOwnedBillingAccount(data.input, digest);
    expect(report.issues.map((issue) => issue.reason)).toContain("statement_unavailable");
    expect(report.listedCurrentTotalUsd).toBeNull(); expect(report.differenceUsd).toBeNull();
    expect(report.receiptChecks.unavailableStatements).toBe(1);
  } finally {
    await getDatabase().update(billingStatementVersions).set({ ownerId: LOCAL_OWNER_ID }).where(eq(billingStatementVersions.id, first.version.id));
  }
});

test("requires renewed slice and account review after a billing correction and never sums old versions", async () => {
  const data = await fixture(); const first = data.slices[0]!; const before = await inspectOwnedBillingAccount(data.input, digest);
  const reviewedAt = new Date().toISOString();
  await recordProviderBillingChange({ version: "provider-billing-change-v1", action: "replace", recordId: first.bill.id,
    expectedFingerprint: first.bill.currentFingerprint, documentSha256: digest, reviewedAt, reason: "Generated account amount correction",
    replacement: { ...first.billingInput, reviewedAt, totalUsd: "0.025", components: [{ kind: "tokens", amountUsd: "0.025" }] } }, digest);
  const changed = await inspectOwnedBillingAccount(data.input, digest);
  expect(changed.issues.map((issue) => issue.reason)).toContain("ledger_changed");
  expect(changed.matchedAttempts).toBe(1); expect(changed.ledgerFingerprint).not.toBe(before.ledgerFingerprint);
  const bill = (await getProviderBilling(first.bill.id))!; const nextReview = new Date().toISOString();
  const next = await recordStatementVersion({ ...first.change, expectedFingerprint: first.version.fingerprint, reviewedAt: nextReview,
    packet: { ...first.change.packet, reviewedAt: nextReview, totalUsd: "0.025",
      lines: [{ allocation: "attempt", recordId: bill.id, expectedFingerprint: bill.currentFingerprint, lineId: bill.lineId, amountUsd: bill.totalUsd }] } }, digest);
  expect((await inspectOwnedBillingAccount(data.input, digest)).issues.map((issue) => issue.reason)).toContain("stale_statement");
  const input = { ...data.input, totalUsd: "0.060", reviewedAt: new Date().toISOString(),
    connections: data.input.connections.map((binding, index) => index === 0 ? { ...binding, statementVersionId: next.id, expectedFingerprint: next.fingerprint } : binding) };
  expect(await inspectOwnedBillingAccount(input, digest)).toMatchObject({ status: "reconciled_owner_account_packet", matchedAttemptSubtotalUsd: "0.055000000000" });
});

test("detects duplicated source lines and account remote responses even when both connection ledgers balance", async () => {
  const data = await fixture(true);
  const report = await inspectOwnedBillingAccount(data.input, digest);
  expect(report.status).toBe("incomplete");
  expect(report.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["duplicate_account_line", "duplicate_account_response"]));
  expect(report.matchedAttempts).toBe(1);
});

test("preserves unknown totals for withdrawal and reports current receipt retention rather than archived availability", async () => {
  const data = await fixture(); const first = data.slices[0]!;
  await getDatabase().delete(runs).where(eq(runs.id, first.runId));
  const retained = await inspectOwnedBillingAccount(data.input, digest);
  expect(retained.issues.map((issue) => issue.reason)).toContain("ledger_changed");
  expect(retained.receiptChecks).toMatchObject({ present: 1, retainedWithoutReceipt: 1 });
  const reviewedAt = new Date().toISOString();
  const next = await recordStatementVersion({ ...first.change, expectedFingerprint: first.version.fingerprint, reviewedAt,
    reason: "Review generated retained provenance", packet: { ...first.change.packet, reviewedAt } }, digest);
  const input = { ...data.input, reviewedAt: new Date().toISOString(), connections: data.input.connections.map((binding, index) =>
    index === 0 ? { ...binding, statementVersionId: next.id, expectedFingerprint: next.fingerprint } : binding) };
  expect(await inspectOwnedBillingAccount(input, digest)).toMatchObject({ status: "reconciled_owner_account_packet",
    receiptChecks: { present: 1, retainedWithoutReceipt: 1 }, paymentStatus: "unknown" });
  await recordStatementVersion({ version: "billing-statement-change-v1", action: "void", connectionId: first.connection.id,
    statementId: data.input.invoiceId, expectedFingerprint: next.fingerprint, documentSha256: digest, reviewedAt: new Date().toISOString(),
    reason: "Withdraw generated invoice slice" }, digest);
  const voided = await inspectOwnedBillingAccount(input, digest);
  expect(voided.issues.map((issue) => issue.reason)).toContain("voided_statement");
  expect(voided.listedCurrentTotalUsd).toBeNull(); expect(voided.differenceUsd).toBeNull();
});

test("counts shared receipts per retained root after same-call reallocation without inventing absent evidence or extra spend", async () => {
  const data = await fixture(); const first = data.slices[0]!; const reviewedAt = new Date().toISOString();
  const move = await recordBillingReallocation({ version: "provider-billing-reallocation-v1", sourceRecordId: first.bill.id,
    expectedFingerprint: first.bill.currentFingerprint, documentSha256: digest, reviewedAt, reason: "Correct generated source line",
    replacement: { ...first.billingInput, reviewedAt, lineId: "corrected-attempt-0" } }, digest);
  expect((await inspectOwnedBillingAccount(data.input, digest)).issues.map((issue) => issue.reason)).toContain("ledger_changed");
  const bill = (await getProviderBilling(move.targetRecordId))!; const nextReview = new Date().toISOString();
  const next = await recordStatementVersion({ ...first.change, expectedFingerprint: first.version.fingerprint, reviewedAt: nextReview,
    packet: { ...first.change.packet, reviewedAt: nextReview,
      lines: [{ allocation: "attempt", recordId: bill.id, expectedFingerprint: bill.currentFingerprint, lineId: bill.lineId, amountUsd: bill.totalUsd }] } }, digest);
  const input = { ...data.input, reviewedAt: new Date().toISOString(), connections: data.input.connections.map((binding, index) =>
    index === 0 ? { ...binding, statementVersionId: next.id, expectedFingerprint: next.fingerprint } : binding) };
  expect(await inspectOwnedBillingAccount(input, digest)).toMatchObject({ status: "reconciled_owner_account_packet",
    listedCurrentTotalUsd: "0.055000000000", matchedAttempts: 2, matchedAttemptSubtotalUsd: "0.050000000000",
    receiptChecks: { unit: "billing_records", present: 3, retainedWithoutReceipt: 0 } });
});

test("runs the actual CLI with success, incomplete and generic-error exits using generated files", async () => {
  const data = await fixture(); const directory = await mkdtemp(join(tmpdir(), "da088-"));
  const inputPath = join(directory, "packet.json"); const evidencePath = join(directory, "evidence.txt");
  const run = () => spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("packages/persistence/scripts/billing-account.ts"), inputPath, evidencePath],
    { cwd: resolve("."), env: process.env, encoding: "utf8", timeout: 10000, maxBuffer: 1000000 });
  try {
    await writeFile(inputPath, JSON.stringify(data.input)); await writeFile(evidencePath, evidence);
    const success = run(); expect(success.status, success.stderr).toBe(0);
    expect(JSON.parse(success.stdout)).toMatchObject({ writes: false, status: "reconciled_owner_account_packet", paymentStatus: "unknown" });
    await writeFile(inputPath, JSON.stringify({ ...data.input, totalUsd: "2" }));
    const incomplete = run(); expect(incomplete.status, incomplete.stderr).toBe(2);
    expect(JSON.parse(incomplete.stdout).issues.map((issue: { reason: string }) => issue.reason)).toContain("invoice_total_mismatch");
    await writeFile(evidencePath, "wrong generated invoice bytes");
    const invalid = run(); expect(invalid.status).toBe(1); expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toContain("Account inspection failed"); expect(invalid.stderr).not.toContain(data.input.accountReference);
    await writeFile(inputPath, " ".repeat(200001));
    expect(run().status).toBe(1);
  } finally { await unlink(inputPath); await unlink(evidencePath); await rmdir(directory); }
}, 15000);
