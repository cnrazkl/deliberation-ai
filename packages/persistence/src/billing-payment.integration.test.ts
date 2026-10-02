import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, open, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultFakeCouncilMembers, type BillingPaymentInput, type BillingStatementChangeInput } from "@deliberation-ai/contracts";
import { eq, inArray } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { inspectOwnedBillingPayment } from "./billing-payment";
import { recordStatementVersion, statementIdentity } from "./billing-statement-history";
import { encryptJson, encryptText } from "./crypto";
import { closeDatabase, getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { deleteProviderConnection, saveProviderConnection } from "./provider-connections";
import { getProviderBilling, recordProviderBilling, recordProviderBillingChange } from "./provider-billing";
import { billingStatementVersions, providerBillingChanges, providerBillingClaims, providerBillingRecords, providerOperations, runs } from "./schema";

const fixtures: Array<{ runId: string; connectionId: string; identity: string }> = [];
const invoiceBytes = "SYNTHETIC DA-089 invoice evidence for local tests, not an authoritative invoice.";
const paymentBytes = "SYNTHETIC DA-089 payment and refund lines, not a bank statement or provider receipt.";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const invoiceDigest = sha(invoiceBytes); const paymentDigest = sha(paymentBytes);
async function fixture() {
  const nonce = randomUUID(); const invoiceId = `invoice-${nonce}`;
  const connection = await saveProviderConnection({ provider: "openai-compatible", label: `DA-089 ${nonce}`, apiKey: "",
    defaultModel: "offline-payment", baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object" });
  const runId = randomUUID(); fixtures.push({ runId, connectionId: connection.id, identity: statementIdentity({ connectionId: connection.id, statementId: invoiceId }) });
  const db = getDatabase();
  await db.insert(runs).values({ id: runId, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "offline-payment", question: "[encrypted]",
    questionCiphertext: encryptText("Generated invoice payment fixture", `run:${runId}:question`), snapshotId: randomUUID(), status: "cancelled", finishedAt: new Date(),
    reviewRounds: 0, membersCiphertext: encryptJson(defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible",
      model: "offline-payment", connectionId: connection.id })), `run:${runId}:members`) });
  const [operation] = await db.insert(providerOperations).values({ id: randomUUID(), runId, memberId: defaultFakeCouncilMembers[0]!.id, round: 0, attempt: 1,
    provider: "openai-compatible", model: "offline-payment", status: "succeeded", submittedAt: new Date(Date.now() - 172800000),
    remoteResponseId: randomUUID(), requestFingerprint: "offline-payment" }).returning();
  const billingInput = { version: "provider-billing-v1" as const, operationId: operation!.id, connectionId: connection.id,
    provider: "openai-compatible", model: "offline-payment", remoteResponseId: operation!.remoteResponseId!, statementId: invoiceId, lineId: "attempt",
    documentSha256: invoiceDigest, billedAt: new Date(Date.now() - 172799000).toISOString(), reviewedAt: new Date().toISOString(),
    attribution: "exact_remote_response" as const, scope: "all_charges_for_this_attempt" as const, currency: "USD" as const,
    totalUsd: "0.02", components: [{ kind: "tokens" as const, amountUsd: "0.02" }] };
  const bill = await recordProviderBilling(billingInput, invoiceDigest); const reviewedAt = new Date().toISOString();
  const statement: Extract<BillingStatementChangeInput, { action: "record" }> = { version: "billing-statement-change-v1", action: "record",
    connectionId: connection.id, statementId: invoiceId, documentSha256: invoiceDigest, reviewedAt, expectedFingerprint: null, reason: "Review generated invoice",
    packet: { version: "billing-statement-v1", connectionId: connection.id, statementId: invoiceId, documentSha256: invoiceDigest, reviewedAt,
      currency: "USD", scope: "complete_connection_statement", totalUsd: "0.02",
      lines: [{ allocation: "attempt", lineId: "attempt", recordId: bill.id, expectedFingerprint: bill.currentFingerprint, amountUsd: bill.totalUsd }] } };
  const version = await recordStatementVersion(statement, invoiceDigest);
  const account = { version: "billing-account-v1" as const, provider: "openai-compatible", accountReference: "generated-payment-account", invoiceId,
    documentSha256: invoiceDigest, reviewedAt: new Date().toISOString(), period: { start: new Date(Date.now() - 259200000).toISOString().slice(0, 10),
      endExclusive: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }, currency: "USD" as const,
    scope: "complete_declared_connections_invoice" as const, totalUsd: "0.02", unallocatedLines: [],
    connections: [{ connectionId: connection.id, accountMappingReason: "Generated account mapping", statementVersionId: version.id, expectedFingerprint: version.fingerprint }] };
  const occurredAt = new Date().toISOString();
  const entry = { entryId: "payment", transactionReference: "payment-transaction", invoiceId, accountReference: account.accountReference,
    kind: "payment" as const, amountUsd: "0.03", currency: "USD" as const, allocation: "exact_invoice" as const, occurredAt,
    sourceKind: "bank_statement" as const, documentSha256: paymentDigest, sourceLineId: "payment-line", attributionReason: "Generated exact invoice payment" };
  const refund = { ...entry, entryId: "refund", transactionReference: "refund-transaction", kind: "refund" as const, amountUsd: "0.01", sourceLineId: "refund-line" };
  const input: BillingPaymentInput = { version: "billing-payment-v1", account, reviewedAt: new Date().toISOString(), reason: "Review generated payment evidence",
    scope: "complete_declared_invoice_payment_evidence", entries: [entry, refund] };
  return { input, bill, billingInput, statement, version, runId, connection, digests: new Map([[entry.entryId, paymentDigest], [refund.entryId, paymentDigest]]) };
}
afterAll(async () => {
  const db = getDatabase();
  if (fixtures.length) {
    const runIds = fixtures.map((item) => item.runId);
    await db.delete(billingStatementVersions).where(inArray(billingStatementVersions.identityFingerprint, fixtures.map((item) => item.identity)));
    const roots = await db.select({ id: providerBillingRecords.id }).from(providerBillingRecords).where(inArray(providerBillingRecords.runId, runIds));
    if (roots.length) {
      const ids = roots.map((row) => row.id);
      await db.delete(providerBillingChanges).where(inArray(providerBillingChanges.recordId, ids));
      await db.delete(providerBillingClaims).where(inArray(providerBillingClaims.recordId, ids));
      await db.delete(providerBillingRecords).where(inArray(providerBillingRecords.id, ids));
    }
    await db.delete(runs).where(inArray(runs.id, runIds));
    for (const item of fixtures) await deleteProviderConnection(item.connectionId);
  }
  await closeDatabase();
});
function cli(inputPath: string, invoicePath: string, manifestPath: string) {
  return spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("packages/persistence/scripts/billing-payment.ts"), inputPath, invoicePath, manifestPath],
    { cwd: resolve("."), env: process.env, encoding: "utf8", timeout: 10000, maxBuffer: 1000000 });
}

test("uses live invoice evidence in a read-only snapshot and keeps balanced payments distinct from settlement", async () => {
  const data = await fixture(); const db = getDatabase();
  const before = (await db.select().from(billingStatementVersions).where(eq(billingStatementVersions.id, data.version.id)))[0];
  const report = await inspectOwnedBillingPayment(data.input, invoiceDigest, data.digests);
  expect(report).toMatchObject({ status: "reconciled_owner_payment_packet", writes: false,
    supportedNetPaymentUsd: "0.020000000000", differenceUsd: "0.000000000000", supportedEntries: 2,
    paymentStatus: "unknown", paymentEvidenceAuthenticity: "unverified", monetaryDispatchAllowed: false });
  expect(report.accountInspection.status).toBe("reconciled_owner_account_packet");
  expect((await inspectOwnedBillingPayment(data.input, invoiceDigest, data.digests)).ledgerFingerprint).toBe(report.ledgerFingerprint);
  expect((await db.select().from(billingStatementVersions).where(eq(billingStatementVersions.id, data.version.id)))[0]).toEqual(before);
  expect((await getProviderBilling(data.bill.id))!.currentFingerprint).toBe(data.bill.currentFingerprint);
});

test("rejects invalid intake and never treats absent or mismatched source evidence as zero payment", async () => {
  const data = await fixture();
  await expect(inspectOwnedBillingPayment(data.input, "a".repeat(64), data.digests)).rejects.toThrow("evidence");
  await expect(inspectOwnedBillingPayment({ ...data.input, reviewedAt: new Date(Date.now() + 60000).toISOString() }, invoiceDigest, data.digests)).rejects.toThrow("future");
  await expect(inspectOwnedBillingPayment(data.input, invoiceDigest, new Map([...data.digests, ["unknown", paymentDigest]]))).rejects.toThrow("Unexpected");
  await expect(inspectOwnedBillingPayment(data.input, invoiceDigest, new Map([["payment", "not-a-digest"]]))).rejects.toThrow("Unexpected");
  const missing = await inspectOwnedBillingPayment(data.input, invoiceDigest, new Map());
  expect(missing.status).toBe("incomplete"); expect(missing.supportedNetPaymentUsd).toBeNull(); expect(missing.differenceUsd).toBeNull();
  const wrong = await inspectOwnedBillingPayment(data.input, invoiceDigest, new Map([["payment", "a".repeat(64)], ["refund", paymentDigest]]));
  expect(wrong.issues.map((issue) => issue.reason)).toContain("evidence_digest_mismatch");
});

test("requires refreshed invoice and payment review after billing changes instead of accepting balanced old amounts", async () => {
  const data = await fixture(); const reviewedAt = new Date().toISOString();
  await recordProviderBillingChange({ version: "provider-billing-change-v1", action: "replace", recordId: data.bill.id, expectedFingerprint: data.bill.currentFingerprint,
    reviewedAt, documentSha256: invoiceDigest, reason: "Generated invoice correction", replacement: { ...data.billingInput,
      reviewedAt, totalUsd: "0.025", components: [{ kind: "tokens", amountUsd: "0.025" }] } }, invoiceDigest);
  const stale = await inspectOwnedBillingPayment(data.input, invoiceDigest, data.digests);
  expect(stale.issues.map((issue) => issue.reason)).toContain("account_incomplete"); expect(stale.differenceUsd).toBeNull();
  const bill = (await getProviderBilling(data.bill.id))!; const nextReview = new Date().toISOString();
  const next = await recordStatementVersion({ ...data.statement, expectedFingerprint: data.version.fingerprint, reviewedAt: nextReview,
    packet: { ...data.statement.packet, reviewedAt: nextReview, totalUsd: bill.totalUsd,
      lines: [{ allocation: "attempt", recordId: bill.id, expectedFingerprint: bill.currentFingerprint, lineId: bill.lineId, amountUsd: bill.totalUsd }] } }, invoiceDigest);
  const account = { ...data.input.account, reviewedAt: new Date().toISOString(), totalUsd: bill.totalUsd,
    connections: [{ ...data.input.account.connections[0]!, statementVersionId: next.id, expectedFingerprint: next.fingerprint }] };
  const fresh = { ...data.input, account, reviewedAt: new Date().toISOString() };
  expect(await inspectOwnedBillingPayment(fresh, invoiceDigest, data.digests)).toMatchObject({ status: "incomplete", differenceUsd: "0.005000000000" });
  const corrected = { ...fresh, entries: fresh.entries.map((entry) => entry.kind === "payment" ? { ...entry, amountUsd: "0.035" } : entry) };
  expect((await inspectOwnedBillingPayment(corrected, invoiceDigest, data.digests)).status).toBe("reconciled_owner_payment_packet");
});

test("rejects duplicated payment references and wrong invoice/account allocation without writing", async () => {
  const data = await fixture(); const first = data.input.entries[0]!;
  const duplicate = await inspectOwnedBillingPayment({ ...data.input, entries: [...data.input.entries, first] }, invoiceDigest, data.digests);
  expect(duplicate.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["duplicate_entry", "duplicate_transaction", "duplicate_source_line"]));
  expect(duplicate.differenceUsd).toBeNull();
  for (const mutation of [{ invoiceId: "other-invoice" }, { accountReference: "other-account" }, { occurredAt: new Date(Date.now() + 60000).toISOString() }]) {
    const report = await inspectOwnedBillingPayment({ ...data.input, entries: [{ ...first, ...mutation }] }, invoiceDigest, new Map([[first.entryId, paymentDigest]]));
    expect(report.status).toBe("incomplete"); expect(report.supportedNetPaymentUsd).toBeNull(); expect(report.differenceUsd).toBeNull();
  }
});

test("denies balanced payments against foreign, withdrawn or unreadable owned statement history", async () => {
  const data = await fixture(); const db = getDatabase();
  await db.update(billingStatementVersions).set({ ownerId: "generated-foreign-payment-owner" }).where(eq(billingStatementVersions.id, data.version.id));
  try {
    expect((await inspectOwnedBillingPayment(data.input, invoiceDigest, data.digests)).issues.map((issue) => issue.reason)).toContain("account_incomplete");
  } finally { await db.update(billingStatementVersions).set({ ownerId: LOCAL_OWNER_ID }).where(eq(billingStatementVersions.id, data.version.id)); }
  const [stored] = await db.select().from(billingStatementVersions).where(eq(billingStatementVersions.id, data.version.id));
  await db.update(billingStatementVersions).set({ payloadCiphertext: "corrupt-generated-history" }).where(eq(billingStatementVersions.id, data.version.id));
  try { await expect(inspectOwnedBillingPayment(data.input, invoiceDigest, data.digests)).rejects.toThrow(); }
  finally { await db.update(billingStatementVersions).set({ payloadCiphertext: stored!.payloadCiphertext }).where(eq(billingStatementVersions.id, data.version.id)); }
  await recordStatementVersion({ version: "billing-statement-change-v1", action: "void", connectionId: data.connection.id, statementId: data.input.account.invoiceId,
    expectedFingerprint: data.version.fingerprint, documentSha256: invoiceDigest, reviewedAt: new Date().toISOString(), reason: "Withdraw generated invoice" }, invoiceDigest);
  const voided = await inspectOwnedBillingPayment(data.input, invoiceDigest, data.digests);
  expect(voided.status).toBe("incomplete"); expect(voided.differenceUsd).toBeNull();
});

test("hashes selected local invoice/payment bytes in the actual CLI and exposes success, incomplete and generic-error exits", async () => {
  const data = await fixture(); const directory = await mkdtemp(join(tmpdir(), "da089-"));
  const inputPath = join(directory, "packet.json"); const invoicePath = join(directory, "invoice.txt");
  const paymentPath = join(directory, "payment.txt"); const manifestPath = join(directory, "manifest.json");
  const manifest = { version: "billing-payment-evidence-v1", files: data.input.entries.map((entry) => ({ entryId: entry.entryId, path: paymentPath })) };
  try {
    await writeFile(inputPath, JSON.stringify(data.input)); await writeFile(invoicePath, invoiceBytes);
    await writeFile(paymentPath, paymentBytes); await writeFile(manifestPath, JSON.stringify(manifest));
    const success = cli(inputPath, invoicePath, manifestPath); expect(success.status, success.stderr).toBe(0);
    const report = JSON.parse(success.stdout);
    expect(report).toMatchObject({ writes: false, status: "reconciled_owner_payment_packet", paymentStatus: "unknown" });
    await writeFile(paymentPath, "Different generated source bytes");
    const changed = cli(inputPath, invoicePath, manifestPath); expect(changed.status, changed.stderr).toBe(2);
    const changedReport = JSON.parse(changed.stdout);
    expect(changedReport.issues.map((issue: { reason: string }) => issue.reason)).toContain("evidence_digest_mismatch");
    expect(changedReport.evidenceFingerprint).not.toBe(report.evidenceFingerprint);
    expect(changedReport.ledgerFingerprint).toBe(report.ledgerFingerprint);
    await writeFile(invoicePath, "Wrong generated invoice source");
    const invalid = cli(inputPath, invoicePath, manifestPath); expect(invalid.status).toBe(1); expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toContain("Payment inspection failed"); expect(invalid.stderr).not.toContain(data.input.account.accountReference);
  } finally { for (const path of [inputPath, invoicePath, paymentPath, manifestPath]) await unlink(path); await rmdir(directory); }
}, 20000);

test("bounds actual CLI source files and rejects unknown/duplicate/relative manifest bindings before inspection", async () => {
  const data = await fixture(); const directory = await mkdtemp(join(tmpdir(), "da089-"));
  const inputPath = join(directory, "packet.json"); const invoicePath = join(directory, "invoice.txt"); const manifestPath = join(directory, "manifest.json");
  const paths = Array.from({ length: 6 }, (_, index) => join(directory, `proof-${index}.txt`));
  try {
    await writeFile(inputPath, JSON.stringify(data.input)); await writeFile(invoicePath, invoiceBytes);
    const file = { entryId: "payment", path: invoicePath };
    for (const files of [[{ ...file, entryId: "unknown" }], [file, file], [{ ...file, path: "relative-proof.txt" }]]) {
      await writeFile(manifestPath, JSON.stringify({ version: "billing-payment-evidence-v1", files }));
      expect(cli(inputPath, invoicePath, manifestPath).status).toBe(1);
    }
    await writeFile(manifestPath, JSON.stringify({ version: "billing-payment-evidence-v1", files: [] }));
    expect(cli(inputPath, invoicePath, manifestPath).status).toBe(2);
    await writeFile(inputPath, " ".repeat(250001)); expect(cli(inputPath, invoicePath, manifestPath).status).toBe(1);
    await writeFile(inputPath, JSON.stringify(data.input));
    for (const path of paths) { const handle = await open(path, "w"); try { await handle.truncate(20_000_000); } finally { await handle.close(); } }
    const handle = await open(paths[0]!, "r+"); try { await handle.truncate(20_000_001); } finally { await handle.close(); }
    await writeFile(manifestPath, JSON.stringify({ version: "billing-payment-evidence-v1", files: [{ entryId: "payment", path: paths[0] }] }));
    expect(cli(inputPath, invoicePath, manifestPath).status).toBe(1);
    const resize = await open(paths[0]!, "r+"); try { await resize.truncate(20_000_000); } finally { await resize.close(); }
    const entries = paths.map((_, index) => ({ ...data.input.entries[0]!, entryId: `payment-${index}`, transactionReference: `transaction-${index}`, sourceLineId: `line-${index}` }));
    await writeFile(inputPath, JSON.stringify({ ...data.input, entries }));
    await writeFile(manifestPath, JSON.stringify({ version: "billing-payment-evidence-v1", files: paths.map((path, index) => ({ entryId: entries[index]!.entryId, path })) }));
    expect(cli(inputPath, invoicePath, manifestPath).status).toBe(1);
  } finally {
    for (const path of [inputPath, invoicePath, manifestPath, ...paths]) await unlink(path).catch(() => {});
    await rmdir(directory);
  }
}, 30000);
