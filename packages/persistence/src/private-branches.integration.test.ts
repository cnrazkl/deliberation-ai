import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, test } from "vitest";
import { Client } from "pg";
import { eq, inArray, sql } from "drizzle-orm";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { privateBranchBodySchema, type CouncilMemberConfig, type PrivateBranchBody } from "@deliberation-ai/contracts";
import { closeDatabase, getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { encryptJson, encryptText } from "./crypto";
import { conversationPrivateBranches as branches, conversations, conversationRuns, runs } from "./schema";
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
