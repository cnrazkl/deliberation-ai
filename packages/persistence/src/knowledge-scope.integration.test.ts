import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { Client } from "pg";
import { KnowledgeAccessError } from "@deliberation-ai/application";
import { closeDatabase, getDatabase } from "./database";
import { decryptJson } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import * as s from "./schema";
import { authorizeKnowledgeScope, changeKnowledgeGrant, conversationKnowledgeAuthorization, createKnowledgeCollection,
  exportConversationKnowledge, exportKnowledgeCollection, KnowledgeSelectionConflictError, setConversationKnowledge } from "./knowledge-scope";
import { exportConversation } from "./conversations";
import { ConversationDeletionBlockedError, deleteEmptyConversation, previewConversationDeletion } from "./conversation-deletion";
import { auditRestoredEncryption } from "../scripts/backup-encryption-audit";
import { pruneExpiredRuns } from "./run-retention";

const collections: string[] = [], conversations: string[] = [];
afterEach(async () => {
  if (conversations.length) {
    await getDatabase().delete(s.conversationKnowledgeSelections).where(inArray(s.conversationKnowledgeSelections.conversationId, conversations));
    await getDatabase().delete(s.conversationKnowledge).where(inArray(s.conversationKnowledge.conversationId, conversations));
    await getDatabase().delete(s.conversations).where(inArray(s.conversations.id, conversations));
  }
  if (collections.length) {
    await getDatabase().delete(s.knowledgeGrants).where(inArray(s.knowledgeGrants.collectionId, collections));
    await getDatabase().delete(s.knowledgeCollections).where(inArray(s.knowledgeCollections.id, collections));
  }
  collections.length = 0; conversations.length = 0;
});
afterAll(closeDatabase);
async function conversation(ownerId = LOCAL_OWNER_ID) {
  const id = randomUUID(); conversations.push(id);
  await getDatabase().insert(s.conversations).values({ id, ownerId, anchorRunId: randomUUID(), origin: "native" }); return id;
}
async function collection() {
  const value = await createKnowledgeCollection("Generated private title"); collections.push(value.id); return value;
}
async function granted() { const value = await collection(); return changeKnowledgeGrant(value.id, 1, "active"); }
test("collection creation starts revoked and encrypts title with authenticated identity", async () => {
  const value = await collection();
  const [row] = await getDatabase().select().from(s.knowledgeCollections).where(eq(s.knowledgeCollections.id, value.id));
  expect(row!.bodyCiphertext).not.toContain("Generated private title");
  expect(decryptJson(row!.bodyCiphertext, `knowledge-collection:${value.id}:body`)).toEqual({ title: value.title });
  expect(() => decryptJson(row!.bodyCiphertext, `knowledge-collection:${randomUUID()}:body`)).toThrow();
  expect(await authorizeKnowledgeScope({ ownerId: LOCAL_OWNER_ID, accountId: "local", collectionId: value.id,
    grantId: value.grantId, grantRevision: 1 })).toBe(false);
  expect(await exportKnowledgeCollection(value.id)).toMatchObject({ title: value.title, grantStatus: "revoked" });
});
test("many-to-many selections are explicit, encrypted and revision guarded", async () => {
  const first = await granted(), second = await granted(), a = await conversation(), b = await conversation();
  expect(await exportConversationKnowledge(a)).toBeNull();
  const revision = await setConversationKnowledge(a, null, { topic: "Sensitive topic", scopes: [first, second] });
  await setConversationKnowledge(b, null, { topic: "Other topic", scopes: [first] });
  expect(await getDatabase().select().from(s.conversationKnowledgeSelections)).toHaveLength(3);
  const [head] = await getDatabase().select().from(s.conversationKnowledge).where(eq(s.conversationKnowledge.conversationId, a));
  expect(head!.selectionCiphertext).not.toContain("Sensitive topic");
  expect(await exportConversationKnowledge(a)).toMatchObject({ revision, topic: "Sensitive topic", grants: [{ available: true }, { available: true }] });
  await expect(setConversationKnowledge(a, null, { topic: "Stale", scopes: [first] })).rejects.toBeInstanceOf(KnowledgeSelectionConflictError);
  expect((await exportConversation(a))!.knowledgeSelection).toMatchObject({ revision, topic: "Sensitive topic" });
});
test("owner/account/notebook/grant mismatches cannot mutate selections or expose titles", async () => {
  const scope = await granted(), target = await conversation(), foreign = await conversation("foreign-owner");
  for (const invalid of [{ ...scope, ownerId: "foreign-owner" }, { ...scope, accountId: "external" },
    { ...scope, collectionId: randomUUID() }, { ...scope, grantId: randomUUID() }, { ...scope, grantRevision: 1 }]) {
    expect(await authorizeKnowledgeScope(invalid)).toBe(false);
    await expect(setConversationKnowledge(target, null, { topic: "Denied", scopes: [invalid] })).rejects.toBeInstanceOf(KnowledgeAccessError);
  }
  await expect(setConversationKnowledge(foreign, null, { topic: "Denied", scopes: [scope] })).rejects.toBeInstanceOf(KnowledgeAccessError);
  expect(await exportKnowledgeCollection(randomUUID())).toBeUndefined();
  await getDatabase().update(s.knowledgeCollections).set({ ownerId: "foreign-owner" }).where(eq(s.knowledgeCollections.id, scope.collectionId));
  expect(await exportKnowledgeCollection(scope.collectionId)).toBeUndefined();
  expect(await authorizeKnowledgeScope(scope)).toBe(false);
});
test("revocation and regrant never revive old selections; history remains inspectable", async () => {
  const scope = await granted(), target = await conversation();
  const revision = (await setConversationKnowledge(target, null, { topic: "Retained topic", scopes: [scope] }))!;
  const authorization = conversationKnowledgeAuthorization(target, revision);
  expect(await authorization.authorize(scope)).toBe(true);
  const revoked = await changeKnowledgeGrant(scope.collectionId, scope.grantRevision, "revoked");
  expect(await authorization.authorize(scope)).toBe(false);
  expect(await exportConversationKnowledge(target)).toMatchObject({ topic: "Retained topic", grants: [{ available: false }] });
  const renewed = await changeKnowledgeGrant(scope.collectionId, revoked.grantRevision, "active");
  expect(await authorization.authorize(scope)).toBe(false);
  await expect(setConversationKnowledge(target, revision, { topic: "Old", scopes: [scope] })).rejects.toBeInstanceOf(KnowledgeAccessError);
  await setConversationKnowledge(target, revision, { topic: "New selection", scopes: [renewed] });
  expect(await authorization.authorize(renewed)).toBe(false);
});
test("selection clearing fences old gateway and preserves independent collection/grant", async () => {
  const scope = await granted(), target = await conversation();
  const revision = (await setConversationKnowledge(target, null, { topic: "Topic", scopes: [scope] }))!;
  const gateway = conversationKnowledgeAuthorization(target, revision);
  await setConversationKnowledge(target, revision, null);
  expect(await gateway.authorize(scope)).toBe(false);
  expect(await exportConversationKnowledge(target)).toBeNull();
  expect(await authorizeKnowledgeScope(scope)).toBe(true);
  expect(await exportKnowledgeCollection(scope.collectionId)).toBeDefined();
});
test("authenticated selection revision rejects replay of earlier ciphertext in the same conversation", async () => {
  const scope = await granted(), target = await conversation();
  const revision = await setConversationKnowledge(target, null, { topic: "Earlier topic", scopes: [scope] });
  const [earlier] = await getDatabase().select().from(s.conversationKnowledge).where(eq(s.conversationKnowledge.conversationId, target));
  await setConversationKnowledge(target, revision, { topic: "Current topic", scopes: [scope] });
  await getDatabase().update(s.conversationKnowledge).set({ selectionCiphertext: earlier!.selectionCiphertext }).where(eq(s.conversationKnowledge.conversationId, target));
  await expect(exportConversationKnowledge(target)).rejects.toThrow();
  expect(await conversationKnowledgeAuthorization(target, revision!).authorize(scope)).toBe(false);
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { await expect(auditRestoredEncryption(client)).rejects.toThrow("encryption audit failed"); } finally { await client.end(); }
});
test("reviewed empty conversation deletion blocks retained selections; clear and fresh preview permit only metadata deletion", async () => {
  const scope = await granted(), target = await conversation();
  const preview = (await previewConversationDeletion(target))!; expect(preview.eligible).toBe(true);
  const revision = await setConversationKnowledge(target, null, { topic: "Topic", scopes: [scope] });
  expect((await previewConversationDeletion(target))!.blockedReasons).toContain("retained_references");
  await expect(deleteEmptyConversation(target, preview.fingerprint!)).rejects.toBeInstanceOf(ConversationDeletionBlockedError);
  await setConversationKnowledge(target, revision, null);
  const fresh = (await previewConversationDeletion(target))!;
  expect(fresh.eligible).toBe(true); await deleteEmptyConversation(target, fresh.fingerprint!);
  expect(await authorizeKnowledgeScope(scope)).toBe(true);
});
test("concurrent writes have one winner and rollback leaves an intact encrypted/relational selection", async () => {
  const scope = await granted(), target = await conversation();
  const results = await Promise.allSettled([setConversationKnowledge(target, null, { topic: "A", scopes: [scope] }),
    setConversationKnowledge(target, null, { topic: "B", scopes: [scope] })]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const current = (await exportConversationKnowledge(target))!;
  await getDatabase().execute(sql`update conversation_knowledge_selections set grant_revision = grant_revision + 1 where conversation_id = ${target}::uuid`);
  await expect(setConversationKnowledge(target, current.revision, null)).rejects.toBeInstanceOf(KnowledgeAccessError);
});
test("backup audit authenticates both encrypted fields and rejects partial knowledge table era", async () => {
  const scope = await granted(), target = await conversation();
  await setConversationKnowledge(target, null, { topic: "Archive topic", scopes: [scope] });
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    expect((await auditRestoredEncryption(client)).decryptedValues).toBeGreaterThanOrEqual(2);
    await client.query("begin");
    await client.query("alter table knowledge_grants rename to knowledge_grants_hidden");
    await expect(auditRestoredEncryption(client)).rejects.toThrow("incomplete");
  } finally { await client.query("rollback"); await client.end(); }
});
test("fixture-only run retention leaves conversation selections and independent collections intact", async () => {
  const scope = await granted(), target = await conversation(), runId = randomUUID();
  const revision = await setConversationKnowledge(target, null, { topic: "Retained library topic", scopes: [scope] });
  try {
    await getDatabase().insert(s.runs).values({ id: runId, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "knowledge-retention-fixture",
      snapshotId: randomUUID(), question: "[encrypted]", questionCiphertext: "synthetic-unused-ciphertext", status: "completed", finishedAt: new Date("2000-01-01T00:00:00Z") });
    expect(await pruneExpiredRuns({ retentionDays: 30, apply: true, onlyRunIds: [runId] })).toMatchObject({ count: 1, applied: true });
    expect(await exportConversationKnowledge(target)).toMatchObject({ revision, topic: "Retained library topic", grants: [{ available: true }] });
    expect(await exportKnowledgeCollection(scope.collectionId)).toBeDefined();
  } finally { await getDatabase().delete(s.runs).where(eq(s.runs.id, runId)); }
});
