import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, expect, test } from "vitest";
import { Client } from "pg";
import { eq, inArray, sql } from "drizzle-orm";
import type { CouncilMemberConfig, PrivateDeliveryResult, PrivateBranchBody } from "@deliberation-ai/contracts";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { closeDatabase, getDatabase } from "./database";
import { closeBoss } from "./queue";
import { decryptJson, encryptJson, encryptText } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { runs, conversations, conversationRuns, conversationPrivateBranches as branches, providerConnections } from "./schema";
import { createPrivateBranch, previewPrivateBranchSeed, appendPrivateDraft, loadPrivateBranch, exportPrivateBranch,
  PrivateBranchConflictError, writePrivateDeliveryBody, readPrivateBranch } from "./private-branches";
import { enqueuePrivateDelivery, previewPrivateDelivery, controlPrivateDelivery, executePrivateDelivery, PrivateDeliveryBlockedError } from "./private-deliveries";
import { exportConversation } from "./conversations";
import { auditRestoredEncryption } from "../scripts/backup-encryption-audit";
import { inspectAdditionalRecovery } from "../scripts/backup-recovery-inventory";
import { previewPrivateBranchDeletion, deletePrivateBranch } from "./private-branch-deletion";
import { privateBranchDeletions } from "./schema";
import { runDeletions, providerOperations } from "./schema";
import { deleteRunBody, previewRunDeletion } from "./run-deletion";
import { loadConversationPrivateUsage } from "./conversation-private-usage";
import { loadConversationCouncilUsage } from "./conversation-council-usage";
import { ConversationIntegrityError, ConversationSizeError } from "./conversation-membership";

const ids: string[] = []; const connections: string[] = []; const sources: string[] = [];
afterEach(async () => {
  if (sources.length) await getDatabase().delete(runDeletions).where(inArray(runDeletions.id, sources));
  if (ids.length) {
    await getDatabase().delete(privateBranchDeletions).where(inArray(privateBranchDeletions.conversationId, ids));
    await getDatabase().delete(branches).where(inArray(branches.conversationId, ids));
    await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.conversationId, ids));
    await getDatabase().delete(conversations).where(inArray(conversations.id, ids));
  }
  if (sources.length) await getDatabase().delete(runs).where(inArray(runs.id, sources));
  if (connections.length) await getDatabase().delete(providerConnections).where(inArray(providerConnections.id, connections));
  ids.length = 0; connections.length = 0; sources.length = 0;
});
afterAll(async () => { await closeBoss(); await closeDatabase(); });
async function fixture({ owner = LOCAL_OWNER_ID, question = "Compare database query syntax", text = "Explain the selected viewpoint", provider = "openai-compatible",
  reasoningLevel = "default", selectedText = "Selected copied answer", connectionProvider = provider === "fake" ? "openai-compatible" : provider,
  baseUrl = provider === "anthropic" || provider === "openai" || provider === "google" ? null : "http://127.0.0.1:9/v1", webSearchMode = "off" }: {
  owner?: string; question?: string; text?: string; provider?: CouncilMemberConfig["provider"]; reasoningLevel?: CouncilMemberConfig["reasoningLevel"]; selectedText?: string;
  connectionProvider?: CouncilMemberConfig["provider"]; baseUrl?: string | null; webSearchMode?: CouncilMemberConfig["webSearchMode"];
} = {}) {
  const id = randomUUID(); const conversationId = randomUUID(); const connectionId = randomUUID();
  ids.push(conversationId); connections.push(connectionId); sources.push(id);
  await getDatabase().insert(providerConnections).values({ id: connectionId, ownerId: owner, provider: connectionProvider, label: `Private offline ${connectionId}`,
    defaultModel: "offline-private", baseUrl, secretCiphertext: encryptText("", `provider-connection:${connectionId}:secret`) });
  const members: CouncilMemberConfig[] = [
    { id: "private-selected", label: "Selected", role: "Independent perspective", provider, model: "offline-private", connectionId,
      councilRole: "analyst", reasoningLevel, webSearchMode, ...(provider === "fake" ? { perspective: "risk" as const } : {}) },
    { id: "private-peer", label: "Peer", role: "Peer", provider: "fake", model: "offline-peer", perspective: "evidence", councilRole: "analyst", reasoningLevel: "default", webSearchMode: "off" },
  ];
  const report = buildCouncilReport(members.map((member) => ({ memberId: member.id, label: member.label, councilRole: member.councilRole,
    rawText: member.id === "private-selected" ? selectedText : "EXCLUDED PEER", parsed: { summary: member.label,
      claims: [{ statement: member.label, kind: "shared" as const, quote: member.label }] }, citations: [] })), []);
  await getDatabase().insert(runs).values({ id, ownerId: owner, idempotencyKey: randomUUID(), requestHash: "private-delivery-fixture", snapshotId: randomUUID(),
    question: "[encrypted]", questionCiphertext: encryptText(question, `run:${id}:question`), membersCiphertext: encryptJson(members, `run:${id}:members`),
    reportCiphertext: encryptJson(report, `run:${id}:report`), status: "completed", branchIndexVersion: 1, branchKind: "independent", finishedAt: new Date() });
  await getDatabase().insert(conversations).values({ id: conversationId, ownerId: owner, anchorRunId: id, origin: "native" });
  await getDatabase().insert(conversationRuns).values({ ownerId: owner, conversationId, runId: id, kind: "independent", createdAt: sql`(select created_at from runs where id = ${id}::uuid)` });
  const seed = await previewPrivateBranchSeed(id, "private-selected");
  if (!seed) return { id, conversationId, connectionId, branch: undefined };
  const branch = await createPrivateBranch({ action: "create", sourceRunId: id, memberId: "private-selected", expectedSeedSha256: seed.sha256, requestId: randomUUID() });
  return { id, conversationId, connectionId, branch: (await appendPrivateDraft(branch!.id, { requestId: randomUUID(), expectedRevision: 1, text }))! };
}
const reply: PrivateDeliveryResult = { text: "Private generated answer", model: "offline-private", remoteResponseId: "offline-response",
  inputTokens: 17, outputTokens: 5, tokenDetails: null, finishReason: "stop" };

test("reviewed output settings bind the frozen request and replay identity without raising capacity", async () => {
  const f = await fixture(); const id = f.branch!.id;
  const original = (await previewPrivateDelivery(id))!;
  const reduced = (await previewPrivateDelivery(id, { maxOutputTokens: 256 }))!;
  expect(original.maxOutputTokens).toBe(1024);
  expect(reduced.input.maxOutputTokens).toBe(256);
  expect(reduced.fingerprint).not.toBe(original.fingerprint);
  expect(reduced.input.messages).toEqual(original.input.messages);
  for (const maxOutputTokens of [127, 1025, 256.5, NaN]) {
    await expect(previewPrivateDelivery(id, { maxOutputTokens })).rejects.toThrow();
  }
  const requestId = randomUUID();
  await expect(enqueuePrivateDelivery(id, { requestId, fingerprint: reduced.fingerprint, maxOutputTokens: 512 })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  expect((await loadPrivateBranch(id))!.body.deliveries).toBeUndefined();
  const intent = { requestId, fingerprint: reduced.fingerprint, maxOutputTokens: 256 };
  await enqueuePrivateDelivery(id, intent);
  await enqueuePrivateDelivery(id, intent);
  await expect(enqueuePrivateDelivery(id, { ...intent, maxOutputTokens: 512 })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  const stored = (await loadPrivateBranch(id))!.body.deliveries!;
  expect(stored).toHaveLength(1);
  expect(stored[0]!.request.maxOutputTokens).toBe(256);
  let calls = 0;
  await executePrivateDelivery(id, requestId, async (operation) => {
    calls++; expect(operation.request.maxOutputTokens).toBe(256); return { result: reply };
  });
  await executePrivateDelivery(id, requestId, async () => { calls++; return { result: reply }; });
  expect(calls).toBe(1);
  expect((await loadPrivateBranch(id))!.body.deliveries![0]!.request.maxOutputTokens).toBe(256);
});
async function send(id: string) {
  const preview = (await previewPrivateDelivery(id))!;
  return enqueuePrivateDelivery(id, { requestId: randomUUID(), fingerprint: preview.fingerprint });
}

test("conversation usage reads one owned snapshot and survives copy deletion without double counting", async () => {
  const f = await fixture(); const id = f.branch!.id; const operation = (await send(id))!;
  await executePrivateDelivery(id, operation.operationId, async () => ({ result: reply }));
  const root = (await loadPrivateBranch(id))!;
  const child = (await createPrivateBranch({ action: "fork", parentBranchId: id, expectedRevision: root.revision,
    expectedDeliveryVersion: root.body.deliveryVersion ?? 0, requestId: randomUUID() }))!;
  const before = (await loadConversationPrivateUsage(f.conversationId))!;
  expect(before).toMatchObject({ retainedBranches: 2, deletedBranches: 0, ownReceipts: 1, submittedAttempts: 1, copiedReceipts: 1, unattributedCopies: 0 });
  expect(before.groups[0]!.input.total).toBe(17);
  expect(JSON.stringify(before)).not.toMatch(/Private generated answer|Explain the selected|Selected copied answer|requestHash|fingerprint|remoteResponseId/);
  await deletePrivateBranch(child.id, (await previewPrivateBranchDeletion(child.id))!.fingerprint!);
  await deletePrivateBranch(id, (await previewPrivateBranchDeletion(id))!.fingerprint!);
  const after = (await loadConversationPrivateUsage(f.conversationId))!;
  expect(after).toMatchObject({ retainedBranches: 0, deletedBranches: 2, submittedAttempts: 1, copiedReceipts: 1, unattributedCopies: 0 });
  expect(after.groups).toEqual(before.groups);
});
test("conversation usage denies missing/foreign conversations and foreign audit membership", async () => {
  expect(await loadConversationPrivateUsage(randomUUID())).toBeUndefined();
  const foreign = await fixture({ owner: "foreign-usage-owner" });
  expect(await loadConversationPrivateUsage(foreign.conversationId)).toBeUndefined();
  const f = await fixture(); const id = f.branch!.id;
  await deletePrivateBranch(id, (await previewPrivateBranchDeletion(id))!.fingerprint!);
  await getDatabase().update(privateBranchDeletions).set({ ownerId: "foreign-usage-owner" }).where(eq(privateBranchDeletions.id, id));
  await expect(loadConversationPrivateUsage(f.conversationId)).rejects.toBeInstanceOf(ConversationIntegrityError);
});
test("conversation usage rejects an authenticated conflicting copied receipt", async () => {
  const f = await fixture(); const operation = (await send(f.branch!.id))!;
  await executePrivateDelivery(f.branch!.id, operation.operationId, async () => ({ result: reply }));
  const root = (await loadPrivateBranch(f.branch!.id))!;
  const child = (await createPrivateBranch({ action: "fork", parentBranchId: root.id, expectedRevision: root.revision,
    expectedDeliveryVersion: root.body.deliveryVersion ?? 0, requestId: randomUUID() }))!;
  const body = structuredClone(child.body); body.deliveries![0]!.usage!.inputTokens = 123;
  await getDatabase().update(branches).set({ bodyCiphertext: encryptJson(body, `private-branch:${child.id}:body`) }).where(eq(branches.id, child.id));
  await expect(loadConversationPrivateUsage(f.conversationId)).rejects.toBeInstanceOf(ConversationIntegrityError);
});

test("conversation council usage retains actual receipts across content deletion without private double counting", async () => {
  const f = await fixture(); const operation = randomUUID();
  await getDatabase().insert(providerOperations).values({ id: operation, runId: f.id, memberId: "private-selected", provider: "openai",
    model: "requested-council", status: "succeeded", requestFingerprint: "fixture-council-usage", inputTokens: 0, outputTokens: 5,
    submittedAt: new Date(), resultMetadataCiphertext: encryptJson({ model: "returned-model", secretFixture: "EXCLUDED METADATA",
      tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "inclusive", reasoningTokens: 3 } },
      `provider-operation:${operation}:metadata`) });
  const privateOperation = (await send(f.branch!.id))!;
  await executePrivateDelivery(f.branch!.id, privateOperation.operationId, async () => ({ result: reply }));
  const before = (await loadConversationCouncilUsage(f.conversationId))!;
  expect(before).toMatchObject({ indexedRuns: 1, operationCount: 1, deletedRuns: 0, unavailableRuns: 0 });
  expect(before.groups[0]!.input.total).toBe(0); expect(before.groups[0]!.output.total).toBe(5);
  expect(before.groups[0]!.model).toBe("requested-council");
  expect(JSON.stringify(before)).not.toMatch(/EXCLUDED METADATA|returned-model|Private generated|Explain the selected|remoteResponseId|requestFingerprint/);
  await deletePrivateBranch(f.branch!.id, (await previewPrivateBranchDeletion(f.branch!.id))!.fingerprint!);
  await deleteRunBody(f.id, (await previewRunDeletion(f.id))!.fingerprint!);
  const after = (await loadConversationCouncilUsage(f.conversationId))!;
  expect(after).toMatchObject({ operationCount: 1, deletedRuns: 1, unavailableRuns: 0 });
  expect(after.groups).toEqual(before.groups);
  expect((await loadConversationPrivateUsage(f.conversationId))!.submittedAttempts).toBe(1);
  await getDatabase().update(runDeletions).set({ ownerId: "foreign-council-owner" }).where(eq(runDeletions.id, f.id));
  await expect(loadConversationCouncilUsage(f.conversationId)).rejects.toBeInstanceOf(ConversationIntegrityError);
});

test("conversation council usage separates missing history from zero usage and denies foreign/missing conversations", async () => {
  expect(await loadConversationCouncilUsage(randomUUID())).toBeUndefined();
  const foreign = await fixture({ owner: "foreign-council-owner" });
  expect(await loadConversationCouncilUsage(foreign.conversationId)).toBeUndefined();
  const f = await fixture();
  await getDatabase().delete(runs).where(eq(runs.id, f.id));
  expect(await loadConversationCouncilUsage(f.conversationId)).toMatchObject({ operationCount: 0, unavailableRuns: 1, runsWithoutReceipts: 1, groups: [] });
});

test("conversation council usage bounds projected text before loading metadata", async () => {
  const f = await fixture();
  await getDatabase().insert(providerOperations).values({ id: randomUUID(), runId: f.id, memberId: "oversized-fixture", provider: "openai",
    model: "x".repeat(8_193), status: "failed", requestFingerprint: "fixture", resultMetadataCiphertext: "must-not-be-decoded" });
  await expect(loadConversationCouncilUsage(f.conversationId)).rejects.toBeInstanceOf(ConversationSizeError);
});
test("preview is read-only, exact input is frozen, concurrent intents deduplicate and success replays without a second executor", async () => {
  const f = await fixture(); const id = f.branch!.id;
  const preview = (await previewPrivateDelivery(id))!;
  expect(preview).toMatchObject({ eligible: true, maxOutputTokens: 1_024, maximumProviderCalls: 1 });
  expect(JSON.stringify(preview)).not.toContain("EXCLUDED PEER");
  expect((await loadPrivateBranch(id))!.body.deliveries).toBeUndefined();
  const intent = { requestId: randomUUID(), fingerprint: preview.fingerprint };
  const [a, b] = await Promise.all([enqueuePrivateDelivery(id, intent), enqueuePrivateDelivery(id, intent)]);
  expect(a).toEqual(b);
  let calls = 0;
  const execute = async () => { calls++; return { result: reply }; };
  await executePrivateDelivery(id, a!.operationId, execute);
  await executePrivateDelivery(id, a!.operationId, execute);
  expect(calls).toBe(1);
  expect((await loadPrivateBranch(id))!.body.deliveries).toHaveLength(1);
  expect((await loadPrivateBranch(id))!.body.deliveries![0]).toMatchObject({ status: "succeeded", usage: { inputTokens: 17, outputTokens: 5 } });
  expect(await enqueuePrivateDelivery(id, intent)).toEqual(a);
  const [stored] = await getDatabase().select().from(branches).where(eq(branches.id, id));
  expect(JSON.stringify(stored)).not.toMatch(/Explain the selected|Private generated/);
  expect((await getDatabase().select().from(runs).where(eq(runs.id, f.id)))[0]!.stateVersion).toBe(1);
});
test("stale preview, foreign access, unsupported members and high-risk context never dispatch", async () => {
  const f = await fixture(); const id = f.branch!.id; const old = (await previewPrivateDelivery(id))!;
  await appendPrivateDraft(id, { requestId: randomUUID(), expectedRevision: 2, text: "Changed owner message" });
  await expect(enqueuePrivateDelivery(id, { requestId: randomUUID(), fingerprint: old.fingerprint })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  await getDatabase().update(providerConnections).set({ revision: 2 }).where(eq(providerConnections.id, f.connectionId));
  const risk = await fixture({ text: "Which medication dose is appropriate?" });
  expect((await previewPrivateDelivery(risk.branch!.id))!.blocks).toContain("high_risk");
  await expect(send(risk.branch!.id)).rejects.toBeInstanceOf(PrivateDeliveryBlockedError);
  const fake = await fixture({ provider: "fake" });
  expect((await previewPrivateDelivery(fake.branch!.id))!.blocks).toContain("unsupported_provider");
  const unsupported = await fixture({ reasoningLevel: "high" });
  expect((await previewPrivateDelivery(unsupported.branch!.id))!.blocks).toContain("unsupported_settings");
  await expect(send(unsupported.branch!.id)).rejects.toBeInstanceOf(PrivateDeliveryBlockedError);
  const oversized = await fixture({ selectedText: "é".repeat(33_000) });
  expect((await previewPrivateDelivery(oversized.branch!.id))!.blocks).toContain("capacity");
  await expect(send(oversized.branch!.id)).rejects.toBeInstanceOf(PrivateDeliveryBlockedError);
  await getDatabase().delete(providerConnections).where(eq(providerConnections.id, f.connectionId));
  expect((await previewPrivateDelivery(id))!.blocks).toContain("missing_connection");
  const foreign = await fixture({ owner: "other-owner" });
  expect(foreign.branch).toBeUndefined();
  await getDatabase().update(branches).set({ ownerId: "other-owner" }).where(eq(branches.id, id));
  expect(await previewPrivateDelivery(id)).toBeUndefined();
  expect(await enqueuePrivateDelivery(id, { requestId: randomUUID(), fingerprint: old.fingerprint })).toBeUndefined();
});
test("connection drift after enqueue rejects before network invocation", async () => {
  const f = await fixture(); const id = f.branch!.id; const operation = (await send(id))!;
  await getDatabase().update(providerConnections).set({ revision: 2 }).where(eq(providerConnections.id, f.connectionId));
  let calls = 0;
  await executePrivateDelivery(id, operation.operationId, async () => { calls++; return { result: reply }; });
  expect(calls).toBe(0);
  expect((await loadPrivateBranch(id))!.body.deliveries![0]).toMatchObject({ status: "failed", submittedAt: null, errorCode: "connection_or_risk_changed" });
});

test.each(["anthropic", "openai", "google"] as const)("%s default/custom targets freeze reviewed input, replay once and preserve native usage through export and forks", async (provider) => {
  for (const baseUrl of [null, provider === "anthropic" ? "http://127.0.0.1:9" : provider === "google" ? "http://127.0.0.1:9/v1beta" : "http://127.0.0.1:9/v1"]) {
    const f = await fixture({ provider, baseUrl }); const id = f.branch!.id;
    const preview = (await previewPrivateDelivery(id))!;
    expect(preview).toMatchObject({ eligible: true, provider, maximumProviderCalls: 1 });
    expect((await loadPrivateBranch(id))!.body.deliveries).toBeUndefined();
    const intent = { requestId: randomUUID(), fingerprint: preview.fingerprint };
    const operation = (await enqueuePrivateDelivery(id, intent))!;
    const result: PrivateDeliveryResult = { ...reply, finishReason: "length",
      tokenDetails: { version: "provider-token-details-v1", inputTokenKind: provider === "anthropic" ? "uncached" : "inclusive", outputTokenKind: provider === "google" ? "candidates" : "inclusive", cachedInputTokens: 9,
        ...(provider === "anthropic" ? { cacheWriteInputTokens: 3 } : { reasoningTokens: 3 }) } };
    let calls = 0;
    const execute: Parameters<typeof executePrivateDelivery>[2] = async (op, target) => {
      calls++;
      expect(op.request).toEqual(preview.input);
      expect(target).toMatchObject({ provider, baseUrl: baseUrl ?? (provider === "anthropic" ? "https://api.anthropic.com" : provider === "google" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1") });
      return { result };
    };
    await executePrivateDelivery(id, operation.operationId, execute);
    await executePrivateDelivery(id, operation.operationId, execute);
    expect(await enqueuePrivateDelivery(id, intent)).toEqual(operation);
    expect(calls).toBe(1);
    const branch = (await loadPrivateBranch(id))!;
    expect(branch.body.deliveries![0]).toMatchObject({ status: "succeeded", usage: { inputTokens: 17, tokenDetails: { inputTokenKind: result.tokenDetails!.inputTokenKind, cachedInputTokens: 9 } } });
    expect((await exportPrivateBranch(id))!.branch.body.deliveries![0]!.result).toEqual(result);
    const fork = (await createPrivateBranch({ action: "fork", parentBranchId: id, expectedRevision: branch.revision,
      expectedDeliveryVersion: branch.body.deliveryVersion ?? 0, requestId: randomUUID() }))!;
    await appendPrivateDraft(fork.id, { requestId: randomUUID(), expectedRevision: 1, text: "Follow up after copied native reply" });
    const next = (await previewPrivateDelivery(fork.id))!;
    expect(next).toMatchObject({ eligible: true, remainingBranchRequests: 8, provider });
    expect(next.input.messages.at(-2)).toEqual({ role: "assistant", content: result.text });
    const [stored] = await getDatabase().select().from(branches).where(eq(branches.id, id));
    expect(JSON.stringify(stored)).not.toContain(result.text);
  }
});

test("native eligibility fails closed on provider mismatch/search/reasoning and claim-time provider drift", async () => {
  for (const options of [{ provider: "google" as const, connectionProvider: "openai" as const },
    { provider: "google" as const, reasoningLevel: "high" as const },
    { provider: "google" as const, webSearchMode: "auto" as const },
    { provider: "google" as const, text: "Which medication dose is appropriate?" },
    { provider: "anthropic" as const, connectionProvider: "openai-compatible" as const },
    { provider: "openai-compatible" as const, connectionProvider: "anthropic" as const },
    { provider: "anthropic" as const, reasoningLevel: "high" as const },
    { provider: "anthropic" as const, webSearchMode: "auto" as const },
    { provider: "openai" as const, connectionProvider: "anthropic" as const },
    { provider: "openai" as const, connectionProvider: "openai-compatible" as const },
    { provider: "openai" as const, reasoningLevel: "high" as const },
    { provider: "openai" as const, webSearchMode: "auto" as const },
    { provider: "openai" as const, text: "Which medication dose is appropriate?" }]) {
    const f = await fixture(options);
    expect((await previewPrivateDelivery(f.branch!.id))!.eligible).toBe(false);
    await expect(send(f.branch!.id)).rejects.toBeInstanceOf(PrivateDeliveryBlockedError);
  }
  for (const provider of ["anthropic", "openai", "google"] as const) {
  const f = await fixture({ provider }); const id = f.branch!.id;
  const old = (await previewPrivateDelivery(id))!;
  await getDatabase().update(providerConnections).set({ baseUrl: "http://127.0.0.1:9" }).where(eq(providerConnections.id, f.connectionId));
  await expect(enqueuePrivateDelivery(id, { requestId: randomUUID(), fingerprint: old.fingerprint })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  const operation = (await send(id))!;
  await getDatabase().update(providerConnections).set({ provider: "openai-compatible" }).where(eq(providerConnections.id, f.connectionId));
  let calls = 0;
  await executePrivateDelivery(id, operation.operationId, async () => { calls++; return { result: reply }; });
  expect(calls).toBe(0);
  expect((await loadPrivateBranch(id))!.body.deliveries![0]).toMatchObject({ status: "failed", submittedAt: null, errorCode: "connection_or_risk_changed" });
  }
});
test("interrupted submission recovers as unknown, blocks editing/forks and requires explicit discard without resending", async () => {
  const f = await fixture(); const id = f.branch!.id; const op = (await send(id))!;
  await getDatabase().transaction(async (tx) => {
    const current = (await readPrivateBranch(tx, id, true))!; const body = current.value.body;
    body.deliveries![0]!.status = "submitted"; body.deliveries![0]!.submittedAt = new Date().toISOString();
    await writePrivateDeliveryBody(tx, id, body);
  });
  let calls = 0;
  await executePrivateDelivery(id, op.operationId, async () => { calls++; return { result: reply }; });
  expect(calls).toBe(0);
  expect((await loadPrivateBranch(id))!.body.deliveries![0]!.status).toBe("outcome_unknown");
  await expect(appendPrivateDraft(id, { requestId: randomUUID(), expectedRevision: 2, text: "Another question" })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  await expect(controlPrivateDelivery(id, { operationId: op.operationId, action: "discard_unknown" })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  await controlPrivateDelivery(id, { operationId: op.operationId, action: "discard_unknown", acknowledgeUnknown: true });
  await executePrivateDelivery(id, op.operationId, async () => { calls++; return { result: reply }; });
  expect(calls).toBe(0);
  await appendPrivateDraft(id, { requestId: randomUUID(), expectedRevision: 2, text: "Explicit new owner message" });
  expect((await previewPrivateDelivery(id))!.eligible).toBe(true);
});
test("overlapping execution is fenced and queued cancellation performs no dispatch", async () => {
  const f = await fixture(); const id = f.branch!.id; const op = (await send(id))!;
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; }); const barrier = new Promise<void>((resolve) => { release = resolve; });
  const first = executePrivateDelivery(id, op.operationId, async () => { enter(); await barrier; return { result: reply }; });
  await entered;
  try {
    await expect(executePrivateDelivery(id, op.operationId, async () => { throw new Error("Must not dispatch"); })).rejects.toThrow("already active");
    await expect(controlPrivateDelivery(id, { operationId: op.operationId, action: "cancel" })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  } finally { release(); await first; }
  await appendPrivateDraft(id, { requestId: randomUUID(), expectedRevision: 2, text: "New message" });
  const next = (await send(id))!;
  await controlPrivateDelivery(id, { operationId: next.operationId, action: "cancel" });
  let calls = 0; await executePrivateDelivery(id, next.operationId, async () => { calls++; return { result: reply }; });
  expect(calls).toBe(0);
});
test("cancelled attempts never refund branch allowance and failed-output usage survives", async () => {
  const f = await fixture(); const id = f.branch!.id;
  for (let i = 0; i < 8; i++) {
    if (i) await appendPrivateDraft(id, { requestId: randomUUID(), expectedRevision: i + 1, text: `Explicit message ${i}` });
    const op = (await send(id))!;
    if (i === 0) await executePrivateDelivery(id, op.operationId, async () => ({ outcome: "known", errorCode: "invalid_private_response", usage: {
      model: reply.model, remoteResponseId: reply.remoteResponseId, inputTokens: 17, outputTokens: 5, tokenDetails: null } }));
    else await controlPrivateDelivery(id, { operationId: op.operationId, action: "cancel" });
  }
  await appendPrivateDraft(id, { requestId: randomUUID(), expectedRevision: 9, text: "Over allowance" });
  expect((await previewPrivateDelivery(id))!.blocks).toContain("capacity");
  await expect(send(id)).rejects.toBeInstanceOf(PrivateDeliveryBlockedError);
  expect((await loadPrivateBranch(id))!.body.deliveries![0]!.usage!.inputTokens).toBe(17);
});
test("completed replies fork with provenance, survive source deletion and enter bounded export/encryption audit", async () => {
  const f = await fixture(); const id = f.branch!.id; const op = (await send(id))!;
  await executePrivateDelivery(id, op.operationId, async () => ({ result: reply }));
  const parent = (await loadPrivateBranch(id))!;
  await expect(createPrivateBranch({ action: "fork", parentBranchId: id, expectedRevision: 2, requestId: randomUUID() })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  const child = (await createPrivateBranch({ action: "fork", parentBranchId: id, expectedRevision: 2,
    expectedDeliveryVersion: parent.body.deliveryVersion!, requestId: randomUUID() }))!;
  expect(child.body.deliveries![0]!.originBranchId).toBe(id);
  await appendPrivateDraft(child.id, { requestId: randomUUID(), expectedRevision: 1, text: "Child-specific follow-up" });
  expect(JSON.stringify((await previewPrivateDelivery(child.id))!.input)).toContain(reply.text);
  await getDatabase().delete(runs).where(eq(runs.id, f.id));
  expect(JSON.stringify(await exportPrivateBranch(child.id))).toContain(reply.text);
  expect((await exportConversation(f.conversationId))!.privateBranches).toHaveLength(2);
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { expect((await auditRestoredEncryption(client)).decryptedValues).toBeGreaterThan(0); } finally { await client.end(); }
});
test("a populated native private receipt survives an actual disposable archive restore", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  // Never dump/restore the real owner's database from an ordinary test run.
  if (!/^\/da_it_[a-f0-9]+$/.test(url.pathname) || url.hostname !== "127.0.0.1") throw new Error("Requires isolated integration database");
  const f = await fixture({ provider: "anthropic" }); const id = f.branch!.id; const op = (await send(id))!;
  await executePrivateDelivery(id, op.operationId, async () => ({ result: { ...reply,
    tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "uncached", outputTokenKind: "inclusive", cachedInputTokens: 9, cacheWriteInputTokens: 3 } } }));
  const native = await fixture({ provider: "openai" }); const nativeId = native.branch!.id;
  const reduced = (await previewPrivateDelivery(nativeId, { maxOutputTokens: 128 }))!;
  const reducedIntent = await enqueuePrivateDelivery(nativeId, { requestId: randomUUID(), fingerprint: reduced.fingerprint, maxOutputTokens: 128 });
  await executePrivateDelivery(nativeId, reducedIntent!.operationId, async () => ({ result: { ...reply,
    tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "inclusive", cachedInputTokens: 9, reasoningTokens: 3 } } }));
  const directory = await mkdtemp(join(tmpdir(), "da-private-restore-"));
  const google = await fixture({ provider: "google" }); const googleId = google.branch!.id;
  await executePrivateDelivery(googleId, (await send(googleId))!.operationId, async () => ({ result: { ...reply,
    tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "candidates", cachedInputTokens: 9, reasoningTokens: 3, totalTokens: 25 } } }));
  await deletePrivateBranch(googleId, (await previewPrivateBranchDeletion(googleId))!.fingerprint!);
  const councilOperation = randomUUID();
  await getDatabase().insert(providerOperations).values({ id: councilOperation, runId: google.id, memberId: "private-one", provider: "google",
    model: "offline-council-model", status: "failed", requestFingerprint: "fixture-deleted-council", inputTokens: 7, outputTokens: null });
  await deleteRunBody(google.id, (await previewRunDeletion(google.id))!.fingerprint!);
  const name = `da_private_restore_${randomUUID().replaceAll("-", "")}`;
  const localRoot = join(process.env.LOCALAPPDATA!, "DeliberationAI");
  const adminFile = await readFile(join(localRoot, "postgres-admin.local"), "utf8");
  const password = adminFile.split(/\r?\n/).find((line) => line.startsWith("POSTGRES_SUPERUSER_PASSWORD="))?.slice("POSTGRES_SUPERUSER_PASSWORD=".length);
  if (!password) throw new Error("Local administrator unavailable");
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres"; adminUrl.username = "postgres"; adminUrl.password = password;
  const admin = new Client({ connectionString: adminUrl.toString() }); let created = false;
  await admin.connect();
  try {
    await admin.query(`create database "${name}" owner deliberation template template0`); created = true;
    const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
    const bin = join(localRoot, "postgresql-18.6", "pgsql", "bin"); const archive = join(directory, "private.dump");
    const dump = spawnSync(join(bin, "pg_dump.exe"), ["--format=custom", "--file", archive, "--dbname", url.pathname.slice(1)], { env, encoding: "utf8" });
    if (dump.status !== 0) throw new Error("Fixture archive failed");
    const restored = spawnSync(join(bin, "pg_restore.exe"), ["--exit-on-error", "--no-owner", "--dbname", name, archive], { env, encoding: "utf8" });
    if (restored.status !== 0) throw new Error("Fixture restore failed");
    const restoredUrl = new URL(url); restoredUrl.pathname = `/${name}`;
    const reader = new Client({ connectionString: restoredUrl.toString() }); await reader.connect();
    try {
      expect((await auditRestoredEncryption(reader)).decryptedValues).toBeGreaterThan(0);
      const recovery = await inspectAdditionalRecovery(reader);
      expect(recovery.privateBranches).toEqual({ branches: 2, ownDeliveryStatuses: { succeeded: 2 }, copiedDeliveryStatuses: {} });
      const sourceReader = new Client({ connectionString: url.toString() }); await sourceReader.connect();
      try { expect(recovery).toEqual(await inspectAdditionalRecovery(sourceReader)); } finally { await sourceReader.end(); }
      const value = await reader.query<{ body_ciphertext: string }>("select body_ciphertext from conversation_private_branches where id = $1", [id]);
      expect(value.rows[0]!.body_ciphertext).toBe((await getDatabase().select().from(branches).where(eq(branches.id, id)))[0]!.bodyCiphertext);
      const nativeValue = await reader.query<{ body_ciphertext: string }>("select body_ciphertext from conversation_private_branches where id = $1", [nativeId]);
      expect(nativeValue.rows[0]!.body_ciphertext).toBe((await getDatabase().select().from(branches).where(eq(branches.id, nativeId)))[0]!.bodyCiphertext);
      expect(decryptJson<PrivateBranchBody>(nativeValue.rows[0]!.body_ciphertext, `private-branch:${nativeId}:body`).deliveries![0]!.request.maxOutputTokens).toBe(128);
      const googleValue = await reader.query<{ audit_ciphertext: string }>("select audit_ciphertext from private_branch_deletions where id = $1", [googleId]);
      expect(googleValue.rows[0]!.audit_ciphertext).toBe((await getDatabase().select().from(privateBranchDeletions).where(eq(privateBranchDeletions.id, googleId)))[0]!.auditCiphertext);
      expect((await reader.query("select 1 from conversation_private_branches where id = $1", [googleId])).rowCount).toBe(0);
      const runAudit = await reader.query<{ audit_ciphertext: string }>("select audit_ciphertext from run_deletions where id=$1", [google.id]);
      expect(runAudit.rows[0]!.audit_ciphertext).toBe((await getDatabase().select().from(runDeletions).where(eq(runDeletions.id, google.id)))[0]!.auditCiphertext);
      expect((await reader.query("select 1 from runs where id=$1", [google.id])).rowCount).toBe(0);
    } finally { await reader.end(); }
  } finally {
    if (created) await admin.query(`drop database "${name}" with (force)`);
    await admin.end(); await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
