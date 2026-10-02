import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, test } from "vitest";
import { Client } from "pg";
import { eq, inArray, sql } from "drizzle-orm";
import { buildCouncilReport, renderPrivateDelivery } from "@deliberation-ai/domain";
import { privateBranchBodySchema, type CouncilMemberConfig, type PrivateBranchBody } from "@deliberation-ai/contracts";
import { closeDatabase, getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { encryptJson, encryptText } from "./crypto";
import { conversationPrivateBranches as branches, conversations, conversationRuns, runs, privateBranchDeletions } from "./schema";
import { previewPrivateBranchDeletion, deletePrivateBranch, loadPrivateBranchDeletion, PrivateBranchDeletionBlockedError, PrivateBranchDeletionStaleError } from "./private-branch-deletion";
import { writePrivateDeliveryBody } from "./private-branches";
import { executePrivateDelivery } from "./private-deliveries";
import { appendPrivateDraft, createPrivateBranch, exportPrivateBranch, listPrivateBranches, loadPrivateBranch,
  previewPrivateBranchSeed, PrivateBranchConflictError, PrivateBranchSourceError } from "./private-branches";
import { ConversationIntegrityError, ConversationSizeError } from "./conversation-membership";
import { ConversationDeletionBlockedError, deleteEmptyConversation, previewConversationDeletion } from "./conversation-deletion";
import { exportConversation } from "./conversations";
import { pruneExpiredRuns } from "./run-retention";
import { auditRestoredEncryption } from "../scripts/backup-encryption-audit";

const conversationIds: string[] = []; const runIds: string[] = [];
afterEach(async () => {
  if (conversationIds.length) {
    await getDatabase().delete(privateBranchDeletions).where(inArray(privateBranchDeletions.conversationId, conversationIds));
    await getDatabase().delete(branches).where(inArray(branches.conversationId, conversationIds));
    await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.conversationId, conversationIds));
    await getDatabase().delete(conversations).where(inArray(conversations.id, conversationIds));
  }
  if (runIds.length) await getDatabase().delete(runs).where(inArray(runs.id, runIds));
  conversationIds.length = 0; runIds.length = 0;
});
afterAll(closeDatabase);
async function source(ownerId = LOCAL_OWNER_ID) {
  const id = randomUUID(); const conversationId = randomUUID(); runIds.push(id); conversationIds.push(conversationId);
  const members: CouncilMemberConfig[] = [
    { id: "private-one", label: "Selected minority", role: "Separate doubts", provider: "fake", model: "fake-one", perspective: "risk", councilRole: "red-team", reasoningLevel: "default", webSearchMode: "off" },
    { id: "private-two", label: "Excluded peer", role: "Other perspective", provider: "fake", model: "fake-two", perspective: "evidence", councilRole: "analyst", reasoningLevel: "default", webSearchMode: "off" },
  ];
  const report = buildCouncilReport(members.map((member, index) => ({ memberId: member.id, label: member.label, councilRole: member.councilRole,
    rawText: index === 0 ? "selected raw minority output" : "EXCLUDED PEER OUTPUT", parsed: { summary: member.label,
      claims: [{ statement: member.label, kind: "objection" as const, quote: member.label }] }, citations: [] })), []);
  await getDatabase().insert(runs).values({ id, ownerId, idempotencyKey: randomUUID(), requestHash: "private-fixture", snapshotId: randomUUID(),
    question: "[encrypted]", questionCiphertext: encryptText("Private source question", `run:${id}:question`),
    membersCiphertext: encryptJson(members, `run:${id}:members`), reportCiphertext: encryptJson(report, `run:${id}:report`),
    status: "completed", branchIndexVersion: 1, branchKind: "independent", finishedAt: new Date() });
  await getDatabase().insert(conversations).values({ id: conversationId, ownerId, anchorRunId: id, origin: "native" });
  await getDatabase().insert(conversationRuns).values({ ownerId, conversationId, runId: id, kind: "independent", createdAt: sql`(select created_at from runs where id = ${id}::uuid)` });
  return { id, conversationId, report, members };
}
async function root() {
  const saved = await source(); const preview = await previewPrivateBranchSeed(saved.id, "private-one");
  const input = { action: "create" as const, sourceRunId: saved.id, memberId: "private-one", expectedSeedSha256: preview!.sha256, requestId: randomUUID() };
  return { ...saved, preview: preview!, input, branch: (await createPrivateBranch(input))! };
}
const draft = (expectedRevision: number, text = "Private owner draft") => ({ requestId: randomUUID(), expectedRevision, text });

test("reviewed private deletion is read-only until confirmation, binds changed content and replays one content-free audit", async () => {
  const f = await root(); const id = f.branch.id;
  const first = (await previewPrivateBranchDeletion(id))!;
  expect(first).toMatchObject({ eligible: true, messageCount: 0, receiptCount: 0 });
  expect(await loadPrivateBranchDeletion(id)).toBeUndefined();
  const branch = (await appendPrivateDraft(id, draft(1)))!;
  await expect(deletePrivateBranch(id, first.fingerprint!)).rejects.toBeInstanceOf(PrivateBranchDeletionStaleError);
  expect(await loadPrivateBranch(id)).toEqual(branch);
  const preview = (await previewPrivateBranchDeletion(id))!;
  const [a, b] = await Promise.all([deletePrivateBranch(id, preview.fingerprint!), deletePrivateBranch(id, preview.fingerprint!)]);
  expect(a).toEqual(b); expect(await loadPrivateBranch(id)).toBeUndefined();
  expect(await exportPrivateBranch(id)).toBeUndefined(); expect(await listPrivateBranches(f.conversationId)).toEqual([]);
  expect(await loadPrivateBranchDeletion(id)).toEqual(a);
  await expect(createPrivateBranch(f.input)).rejects.toBeInstanceOf(PrivateBranchConflictError);
  await expect(deletePrivateBranch(id, "a".repeat(64))).rejects.toBeInstanceOf(PrivateBranchDeletionStaleError);
  const exported = (await exportConversation(f.conversationId))!;
  expect(exported.privateBranches).toEqual([]); expect(exported.privateBranchDeletions).toEqual([a]);
  expect(JSON.stringify(a)).not.toMatch(/Private owner draft|selected raw|Private source question|request|result/);
  expect((await getDatabase().select().from(runs).where(eq(runs.id, f.id)))[0]!.stateVersion).toBe(1);
});

test("private deletion preserves terminal usage and copied origins, blocks parents and allows reviewed leaf-first removal", async () => {
  const f = await root(); const id = f.branch.id;
  const parent = (await appendPrivateDraft(id, draft(1)))!;
  const result = { text: "Private terminal reply must disappear", model: "offline-model", remoteResponseId: "offline-receipt",
    inputTokens: 20, outputTokens: 5, tokenDetails: null, finishReason: "stop" as const };
  const operation = { id: randomUUID(), originBranchId: id, messageId: parent.body.messages[0]!.id, fingerprint: "a".repeat(64),
    connectionId: randomUUID(), connectionFingerprint: "b".repeat(64), request: renderPrivateDelivery(parent.body), status: "succeeded" as const,
    result, usage: { model: result.model, remoteResponseId: result.remoteResponseId, inputTokens: 20, outputTokens: 5, tokenDetails: null },
    errorCode: null, createdAt: new Date().toISOString(), submittedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
  await getDatabase().transaction((tx) => writePrivateDeliveryBody(tx, id, { ...parent.body, deliveries: [operation], deliveryVersion: 1 }));
  const child = (await createPrivateBranch({ action: "fork", parentBranchId: id, expectedRevision: 2, expectedDeliveryVersion: 1, requestId: randomUUID() }))!;
  const blocked = (await previewPrivateBranchDeletion(id))!;
  expect(blocked).toMatchObject({ eligible: false, copiedBranchIds: [child.id], fingerprint: null });
  await expect(deletePrivateBranch(id, "a".repeat(64))).rejects.toBeInstanceOf(PrivateBranchDeletionBlockedError);
  const childPreview = (await previewPrivateBranchDeletion(child.id))!;
  expect(childPreview.ownReceiptCount).toBe(0);
  const copiedAudit = (await deletePrivateBranch(child.id, childPreview.fingerprint!))!;
  expect(copiedAudit.receipts[0]).toMatchObject({ originBranchId: id, usage: { inputTokens: 20, outputTokens: 5 } });
  const final = (await previewPrivateBranchDeletion(id))!;
  const audit = (await deletePrivateBranch(id, final.fingerprint!))!;
  expect(audit.receipts[0]).toMatchObject({ status: "succeeded", originBranchId: id, usage: { inputTokens: 20 } });
  expect(JSON.stringify(audit)).not.toContain(result.text);
  let calls = 0; await executePrivateDelivery(id, operation.id, async () => { calls++; return { result }; }); expect(calls).toBe(0);
  // No restrictive FK from retained usage to removed conversation identity.
  await getDatabase().delete(runs).where(eq(runs.id, f.id));
  const metadata = (await previewConversationDeletion(f.conversationId))!; expect(metadata.eligible).toBe(true);
  await deleteEmptyConversation(f.conversationId, metadata.fingerprint!);
  expect(await loadPrivateBranchDeletion(id)).toEqual(audit);
});

test("private deletion refuses unresolved receipts and an active worker lease, including acknowledged unknown closure", async () => {
  const f = await root(); const id = f.branch.id; const branch = (await appendPrivateDraft(id, draft(1)))!;
  const operation = { id: randomUUID(), originBranchId: id, messageId: branch.body.messages[0]!.id, fingerprint: "a".repeat(64),
    connectionId: randomUUID(), connectionFingerprint: "b".repeat(64), request: renderPrivateDelivery(branch.body), result: null, errorCode: null,
    createdAt: new Date().toISOString(), submittedAt: new Date().toISOString(), finishedAt: null };
  for (const status of ["prepared", "submitted", "outcome_unknown"] as const) {
    await getDatabase().transaction((tx) => writePrivateDeliveryBody(tx, id, { ...branch.body, deliveries: [{ ...operation, status }] }));
    expect((await previewPrivateBranchDeletion(id))!.blockedReasons).toContain("pending_delivery");
    await expect(deletePrivateBranch(id, "a".repeat(64))).rejects.toBeInstanceOf(PrivateBranchDeletionBlockedError);
    expect(await loadPrivateBranchDeletion(id)).toBeUndefined();
  }
  await getDatabase().transaction((tx) => writePrivateDeliveryBody(tx, id, { ...branch.body, deliveries: [{ ...operation, status: "discarded" }] }));
  const preview = (await previewPrivateBranchDeletion(id))!;
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1), hashtext($2))", ["private-delivery-v1", id]);
    await expect(deletePrivateBranch(id, preview.fingerprint!)).rejects.toBeInstanceOf(PrivateBranchDeletionBlockedError);
    expect(await loadPrivateBranch(id)).toBeDefined();
  } finally { await client.end(); }
  const audit = (await deletePrivateBranch(id, preview.fingerprint!))!;
  expect(audit.receipts[0]).toMatchObject({ status: "discarded", usage: null });
});

test("private deletion finds detached copied origins and foreign children without exposing foreign identities", async () => {
  const f = await root(); const parent = (await appendPrivateDraft(f.branch.id, draft(1)))!;
  const child = (await createPrivateBranch({ action: "fork", parentBranchId: parent.id, expectedRevision: 2, requestId: randomUUID() }))!;
  const detachedParent = randomUUID();
  await getDatabase().update(branches).set({ parentBranchId: detachedParent,
    bodyCiphertext: encryptJson({ ...child.body, forkedFrom: { ...child.body.forkedFrom!, branchId: detachedParent } }, `private-branch:${child.id}:body`) }).where(eq(branches.id, child.id));
  expect((await previewPrivateBranchDeletion(parent.id))!.copiedBranchIds).toEqual([child.id]);
  await getDatabase().update(branches).set({ ownerId: "foreign-copy", parentBranchId: parent.id }).where(eq(branches.id, child.id));
  const preview = (await previewPrivateBranchDeletion(parent.id))!;
  expect(preview.blockedReasons).toContain("copied_branches"); expect(preview.copiedBranchIds).toEqual([]);
  expect(await previewPrivateBranchDeletion(child.id)).toBeUndefined();
  expect(await deletePrivateBranch(child.id, "a".repeat(64))).toBeUndefined();
});

test("private deletion fails closed on changed columns, incoming cascading dependencies and custom triggers", async () => {
  const f = await root(); const id = f.branch.id;
  const check = async () => {
    expect((await previewPrivateBranchDeletion(id))!.blockedReasons).toContain("schema_changed");
    await expect(deletePrivateBranch(id, "a".repeat(64))).rejects.toBeInstanceOf(PrivateBranchDeletionBlockedError);
    expect(await loadPrivateBranchDeletion(id)).toBeUndefined();
  };
  await getDatabase().execute(sql`alter table conversation_private_branches add column fixture_unknown text`);
  try { await check(); } finally { await getDatabase().execute(sql`alter table conversation_private_branches drop column fixture_unknown`); }
  await getDatabase().execute(sql`create table fixture_private_dependency (branch_id uuid references conversation_private_branches(id) on delete cascade)`);
  try { await check(); } finally { await getDatabase().execute(sql`drop table fixture_private_dependency`); }
  await getDatabase().execute(sql`create function fixture_private_trigger() returns trigger language plpgsql as $$ begin return old; end $$`);
  await getDatabase().execute(sql`create trigger fixture_private_delete before delete on conversation_private_branches for each row execute function fixture_private_trigger()`);
  try { await check(); } finally {
    await getDatabase().execute(sql`drop trigger fixture_private_delete on conversation_private_branches`);
    await getDatabase().execute(sql`drop function fixture_private_trigger()`);
  }
  expect((await previewPrivateBranchDeletion(id))!.eligible).toBe(true);
});

test("private deletion closes the boundary on unreadable copied bodies and bounded inspection overflow", async () => {
  const f = await root(); const other = await root();
  await getDatabase().update(branches).set({ bodyCiphertext: "invalid-envelope" }).where(eq(branches.id, other.branch.id));
  await expect(previewPrivateBranchDeletion(f.branch.id)).rejects.toThrow();
  await getDatabase().delete(branches).where(eq(branches.id, other.branch.id));
  const rows = Array.from({ length: 1_000 }, () => {
    const id = randomUUID(); return { id, ownerId: LOCAL_OWNER_ID, conversationId: f.conversationId, sourceRunId: f.id, sourceMemberId: "private-one",
      requestId: randomUUID(), requestHash: "bounded-private-fixture", bodyCiphertext: encryptJson(f.branch.body, `private-branch:${id}:body`) };
  });
  await getDatabase().insert(branches).values(rows);
  expect((await previewPrivateBranchDeletion(f.branch.id))!.blockedReasons).toContain("inspection_limit");
  await expect(deletePrivateBranch(f.branch.id, "a".repeat(64))).rejects.toBeInstanceOf(PrivateBranchDeletionBlockedError);
});

test("freezes only the selected reply and explicit provenance, encrypts owner drafts and exports no credentials or peer content", async () => {
  const value = await root();
  expect(JSON.stringify(value.preview)).not.toContain("EXCLUDED PEER OUTPUT");
  expect(await listPrivateBranches(value.conversationId)).toEqual([expect.objectContaining({ id: value.branch.id, messageCount: 0 })]);
  expect(JSON.stringify(await listPrivateBranches(value.conversationId))).not.toContain("selected raw");
  const updated = await appendPrivateDraft(value.branch.id, draft(1, "  Özgün boşluklar korunur.  "));
  expect(updated!.body.messages[0]).toMatchObject({ kind: "owner-draft", text: "  Özgün boşluklar korunur.  ", originBranchId: value.branch.id });
  const [stored] = await getDatabase().select().from(branches).where(eq(branches.id, value.branch.id));
  expect(JSON.stringify(stored)).not.toMatch(/selected raw|Özgün|Private source question/);
  expect(JSON.stringify(await exportPrivateBranch(value.branch.id))).not.toMatch(/EXCLUDED PEER|Ciphertext|requestHash|requestId|apiKey/);
  expect((await exportConversation(value.conversationId))!.privateBranches).toHaveLength(1);
  const [unchanged] = await getDatabase().select().from(runs).where(eq(runs.id, value.id));
  expect(unchanged!.stateVersion).toBe(1);
  expect(unchanged!.queueJobId).toBeNull();
  await expect(appendPrivateDraft(value.branch.id, { ...draft(2), kind: "assistant" } as ReturnType<typeof draft>)).rejects.toThrow();
  expect(privateBranchBodySchema.safeParse({ ...updated!.body, seed: { ...updated!.body.seed, member: { ...updated!.body.seed.member, apiKey: "secret" } } }).success).toBe(false);
});

test("binds a preview to source state and deduplicates simultaneous create intents even after source retention", async () => {
  const saved = await source(); const preview = (await previewPrivateBranchSeed(saved.id, "private-one"))!;
  const input = { action: "create" as const, sourceRunId: saved.id, memberId: "private-one", expectedSeedSha256: preview.sha256, requestId: randomUUID() };
  await getDatabase().update(runs).set({ stateVersion: 2 }).where(eq(runs.id, saved.id));
  await expect(createPrivateBranch(input)).rejects.toBeInstanceOf(PrivateBranchConflictError);
  const fresh = { ...input, expectedSeedSha256: (await previewPrivateBranchSeed(saved.id, "private-one"))!.sha256 };
  const [a, b] = await Promise.all([createPrivateBranch(fresh), createPrivateBranch(fresh)]);
  expect(a!.id).toBe(b!.id);
  await expect(createPrivateBranch({ ...fresh, memberId: "private-two" })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  await getDatabase().delete(runs).where(eq(runs.id, saved.id));
  expect((await createPrivateBranch(fresh))!.id).toBe(a!.id);
  expect(await previewPrivateBranchSeed(saved.id, "private-one")).toBeUndefined();
});

test("serializes competing drafts without lost updates and replays the committed message once", async () => {
  const value = await root(); const a = draft(1, "first competing message"); const b = draft(1, "second competing message");
  const result = await Promise.allSettled([appendPrivateDraft(value.branch.id, a), appendPrivateDraft(value.branch.id, b)]);
  expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  const failed = result.find((item) => item.status === "rejected") as PromiseRejectedResult;
  expect(failed.reason).toBeInstanceOf(PrivateBranchConflictError);
  const winner = (await loadPrivateBranch(value.branch.id))!.body.messages[0]!;
  const winningInput = winner.id === a.requestId ? a : b;
  await appendPrivateDraft(value.branch.id, draft(2, "later message"));
  expect((await appendPrivateDraft(value.branch.id, winningInput))!.body.messages).toHaveLength(2);
  await expect(appendPrivateDraft(value.branch.id, { ...winningInput, text: "changed retry" })).rejects.toBeInstanceOf(PrivateBranchConflictError);
});

test("forks a reviewed immutable prefix, preserves copy provenance and leaves parent and sibling changes separate", async () => {
  const value = await root(); await appendPrivateDraft(value.branch.id, draft(1, "copied prefix"));
  const input = { action: "fork" as const, parentBranchId: value.branch.id, expectedRevision: 2, requestId: randomUUID() };
  const child = (await createPrivateBranch(input))!;
  expect(child.body.forkedFrom).toEqual({ branchId: value.branch.id, revision: 2, messageCount: 1 });
  expect(child.body.messages[0]!.originBranchId).toBe(value.branch.id);
  await expect(appendPrivateDraft(child.id, { requestId: child.body.messages[0]!.id, expectedRevision: 1, text: "copied prefix" })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  await appendPrivateDraft(child.id, draft(1, "child only"));
  await appendPrivateDraft(value.branch.id, draft(2, "parent only"));
  expect((await createPrivateBranch(input))!.id).toBe(child.id);
  await expect(createPrivateBranch({ ...input, requestId: randomUUID() })).rejects.toBeInstanceOf(PrivateBranchConflictError);
  const grandchild = (await createPrivateBranch({ action: "fork", parentBranchId: child.id, expectedRevision: 2, requestId: randomUUID() }))!;
  expect(grandchild.body.messages.map((message) => message.text)).toEqual(["copied prefix", "child only"]);
  expect((await loadPrivateBranch(value.branch.id))!.body.messages.map((message) => message.text)).toEqual(["copied prefix", "parent only"]);
});

test("actual fixture retention preserves private content and blocks empty metadata deletion without schema drift", async () => {
  const value = await root(); await appendPrivateDraft(value.branch.id, draft(1));
  await getDatabase().update(runs).set({ finishedAt: new Date("2020-01-01") }).where(eq(runs.id, value.id));
  expect((await pruneExpiredRuns({ retentionDays: 1, apply: true, onlyRunIds: [value.id] })).count).toBe(1);
  expect((await loadPrivateBranch(value.branch.id))!.body.seed.rawText).toBe("selected raw minority output");
  const preview = (await previewConversationDeletion(value.conversationId))!;
  expect(preview.blockedReasons).toContain("private_branches");
  expect(preview.blockedReasons).not.toContain("schema_changed");
  await expect(deleteEmptyConversation(value.conversationId, "a".repeat(64))).rejects.toBeInstanceOf(ConversationDeletionBlockedError);
  const exported = (await exportConversation(value.conversationId))!;
  expect(exported.runs[0]!.availability).toBe("unavailable"); expect(exported.privateBranches![0]!.body.messages).toHaveLength(1);
});

test("rejects unknown/foreign sources and branch ownership drift, unavailable output and altered encrypted metadata", async () => {
  const foreign = await source("private-foreign-fixture");
  expect(await previewPrivateBranchSeed(foreign.id, "private-one")).toBeUndefined();
  const value = await root();
  expect(await previewPrivateBranchSeed(value.id, "no-such-member")).toBeUndefined();
  expect(await loadPrivateBranch(randomUUID())).toBeUndefined();
  await getDatabase().update(runs).set({ status: "running" }).where(eq(runs.id, value.id));
  await expect(previewPrivateBranchSeed(value.id, "private-one")).rejects.toBeInstanceOf(PrivateBranchSourceError);
  await getDatabase().update(branches).set({ sourceMemberId: "private-two" }).where(eq(branches.id, value.branch.id));
  await expect(loadPrivateBranch(value.branch.id)).rejects.toBeInstanceOf(ConversationIntegrityError);
  await getDatabase().update(branches).set({ sourceMemberId: "private-one", ownerId: "private-foreign-fixture" }).where(eq(branches.id, value.branch.id));
  expect(await loadPrivateBranch(value.branch.id)).toBeUndefined();
  await expect(listPrivateBranches(value.conversationId)).rejects.toBeInstanceOf(ConversationIntegrityError);
});

test("enforces full message/count/UTF-8 size bounds atomically and refuses partial oversized branch lists", async () => {
  const value = await root();
  const full: PrivateBranchBody = { ...value.branch.body, messages: Array.from({ length: 64 }, (_, index) => ({ id: randomUUID(), kind: "owner-draft",
    text: "bounded draft", createdAt: new Date().toISOString(), originBranchId: value.branch.id, acceptedRevision: index + 2 })) };
  await getDatabase().update(branches).set({ bodyCiphertext: encryptJson(full, `private-branch:${value.branch.id}:body`), messageCount: 64, revision: 65 }).where(eq(branches.id, value.branch.id));
  await expect(appendPrivateDraft(value.branch.id, draft(65))).rejects.toBeInstanceOf(ConversationSizeError);
  const large: PrivateBranchBody = { ...value.branch.body, seed: { ...value.branch.body.seed, rawText: "ı".repeat(250_000) },
    messages: Array.from({ length: 2 }, (_, index) => ({ id: randomUUID(), kind: "owner-draft", text: "ı".repeat(8_000), createdAt: new Date().toISOString(), originBranchId: value.branch.id, acceptedRevision: index + 2 })) };
  // It is not a partial success: the next body crosses the 512 KiB bound.
  const initial = { ...large, messages: large.messages.slice(0, 1) };
  await getDatabase().update(branches).set({ bodyCiphertext: encryptJson(initial, `private-branch:${value.branch.id}:body`), messageCount: 1, revision: 2 }).where(eq(branches.id, value.branch.id));
  await expect(appendPrivateDraft(value.branch.id, draft(2, "ı".repeat(8_000)))).rejects.toBeInstanceOf(ConversationSizeError);
  expect((await loadPrivateBranch(value.branch.id))!.messageCount).toBe(1);
  await getDatabase().update(branches).set({ bodyCiphertext: encryptJson(value.branch.body, `private-branch:${value.branch.id}:body`), messageCount: 0, revision: 1 }).where(eq(branches.id, value.branch.id));
  const copies = Array.from({ length: 99 }, () => { const id = randomUUID(); return { id, ownerId: LOCAL_OWNER_ID, conversationId: value.conversationId,
    sourceRunId: value.id, sourceMemberId: "private-one", requestId: randomUUID(), requestHash: "fixture", bodyCiphertext: encryptJson(value.branch.body, `private-branch:${id}:body`) }; });
  await getDatabase().insert(branches).values(copies);
  expect(await listPrivateBranches(value.conversationId)).toHaveLength(100);
  await expect(createPrivateBranch({ ...value.input, requestId: randomUUID() })).rejects.toBeInstanceOf(ConversationSizeError);
  const id = randomUUID(); await getDatabase().insert(branches).values({ ...copies[0]!, id, requestId: randomUUID(), bodyCiphertext: encryptJson(value.branch.body, `private-branch:${id}:body`) });
  await expect(listPrivateBranches(value.conversationId)).rejects.toBeInstanceOf(ConversationSizeError);
  await expect(exportConversation(value.conversationId)).rejects.toBeInstanceOf(ConversationSizeError);
});

test("backup audit decrypts populated private drafts and rejects authenticated metadata drift and wrong context", async () => {
  const value = await root(); await appendPrivateDraft(value.branch.id, draft(1));
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    await client.query("begin");
    expect((await auditRestoredEncryption(client)).decryptedValues).toBeGreaterThan(0);
    await client.query("update conversation_private_branches set message_count = 0 where id = $1", [value.branch.id]);
    await expect(auditRestoredEncryption(client)).rejects.toThrow("conversation_private_branches.body_ciphertext");
    await client.query("update conversation_private_branches set message_count = 1, body_ciphertext = $2 where id = $1", [value.branch.id, encryptJson(value.branch.body, "wrong-context")]);
    await expect(auditRestoredEncryption(client)).rejects.toThrow("conversation_private_branches.body_ciphertext");
  } finally { await client.query("rollback"); await client.end(); }
});

test.runIf(/\/da_it_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname))("old archives without the whole private-branch table remain readable, with schema changes rolled back", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { await client.query("begin"); await client.query("drop table conversation_private_branches"); await expect(auditRestoredEncryption(client)).resolves.toBeDefined(); }
  finally { await client.query("rollback"); await client.end(); }
});
