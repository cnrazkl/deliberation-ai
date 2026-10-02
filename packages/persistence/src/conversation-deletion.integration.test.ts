import { randomUUID } from "node:crypto";
import { afterEach, afterAll, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDatabase, getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { conversations, conversationRuns, runs } from "./schema";
import { lockConversationMembership } from "./conversation-membership";
import { ConversationDeletionBlockedError, ConversationDeletionStaleError, deleteEmptyConversation,
  MAX_CONVERSATION_DELETION_MEMBERS, previewConversationDeletion } from "./conversation-deletion";

const conversationIds: string[] = [];
const runIds: string[] = [];
afterEach(async () => {
  if (conversationIds.length) {
    await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.conversationId, conversationIds));
    await getDatabase().delete(conversations).where(inArray(conversations.id, conversationIds));
  }
  if (runIds.length) await getDatabase().delete(runs).where(inArray(runs.id, runIds));
  conversationIds.length = 0; runIds.length = 0;
});
afterAll(closeDatabase);

async function empty(ownerId = LOCAL_OWNER_ID) {
  const id = randomUUID(); conversationIds.push(id);
  const anchorRunId = randomUUID(); runIds.push(anchorRunId);
  await getDatabase().insert(conversations).values({ id, ownerId, anchorRunId, origin: "native" });
  return { id, anchorRunId };
}
async function membership(conversationId: string, runId = randomUUID(), ownerId = LOCAL_OWNER_ID, sourceRunId: string | null = null) {
  runIds.push(runId);
  await getDatabase().insert(conversationRuns).values({ conversationId, runId, ownerId, sourceRunId,
    kind: sourceRunId ? "continuation-full" : "independent", createdAt: sql`now()` });
  return runId;
}
async function body(id: string, ownerId = LOCAL_OWNER_ID, sourceRunId: string | null = null) {
  runIds.push(id);
  await getDatabase().insert(runs).values({ id, ownerId, idempotencyKey: randomUUID(), requestHash: "deletion-fixture",
    snapshotId: randomUUID(), question: "[encrypted]", questionCiphertext: "unreadable-question-fixture",
    reportCiphertext: "unreadable-report-fixture", status: "completed", branchIndexVersion: 1,
    branchKind: sourceRunId ? "continuation-full" : "independent", branchSourceRunId: sourceRunId });
}

test("preview writes nothing and exact reviewed deletion removes only the selected empty metadata", async () => {
  const target = await empty(); const neighbor = await empty();
  const first = await membership(target.id, target.anchorRunId);
  await membership(target.id, randomUUID(), LOCAL_OWNER_ID, first);
  const preview = await previewConversationDeletion(target.id);
  expect(preview).toMatchObject({ version: "empty-conversation-deletion-v1", eligible: true, recordedRunCount: 2, blockedReasons: [] });
  expect(preview!.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(await previewConversationDeletion(target.id)).toEqual(preview);
  expect(await getDatabase().select().from(conversations).where(eq(conversations.id, target.id))).toHaveLength(1);
  expect(await deleteEmptyConversation(target.id, preview!.fingerprint!)).toEqual({ deleted: true, conversationId: target.id, deletedMembershipCount: 2 });
  expect(await previewConversationDeletion(target.id)).toBeUndefined();
  expect(await getDatabase().select().from(conversationRuns).where(eq(conversationRuns.conversationId, target.id))).toHaveLength(0);
  expect(await previewConversationDeletion(neighbor.id)).toMatchObject({ eligible: true, recordedRunCount: 0 });
});

test("retained bodies block deletion without decrypting or modifying their content", async () => {
  const target = await empty(); await membership(target.id, target.anchorRunId);
  const oldPreview = await previewConversationDeletion(target.id);
  await body(target.anchorRunId);
  const preview = await previewConversationDeletion(target.id);
  expect(preview).toMatchObject({ eligible: false, fingerprint: null });
  expect(preview!.blockedReasons).toContain("available_runs");
  await expect(deleteEmptyConversation(target.id, oldPreview!.fingerprint!)).rejects.toBeInstanceOf(ConversationDeletionBlockedError);
  const [saved] = await getDatabase().select({ question: runs.questionCiphertext, report: runs.reportCiphertext }).from(runs).where(eq(runs.id, target.anchorRunId));
  expect(saved).toEqual({ question: "unreadable-question-fixture", report: "unreadable-report-fixture" });
});

test("unknown/foreign identities and mixed-owner metadata cannot be deleted", async () => {
  const foreign = await empty("foreign-fixture");
  expect(await previewConversationDeletion(foreign.id)).toBeUndefined();
  expect(await deleteEmptyConversation(foreign.id, "a".repeat(64))).toBeUndefined();
  expect(await previewConversationDeletion(randomUUID())).toBeUndefined();
  const target = await empty(); await membership(target.id, randomUUID(), "foreign-fixture");
  expect((await previewConversationDeletion(target.id))!.blockedReasons).toContain("owner_mismatch");
  await expect(deleteEmptyConversation(target.id, "a".repeat(64))).rejects.toBeInstanceOf(ConversationDeletionBlockedError);
  const second = await empty(); await membership(second.id, second.anchorRunId); await body(second.anchorRunId, "foreign-fixture");
  expect((await previewConversationDeletion(second.id))!.blockedReasons).toContain("owner_mismatch");
});

test("full-precision timestamps and changed memberships invalidate the reviewed fingerprint", async () => {
  const target = await empty(); await membership(target.id, target.anchorRunId);
  await getDatabase().update(conversationRuns).set({ createdAt: sql`'2100-01-01 00:00:00.123456+00'::timestamptz` }).where(eq(conversationRuns.conversationId, target.id));
  const preview = await previewConversationDeletion(target.id);
  await getDatabase().update(conversationRuns).set({ createdAt: sql`'2100-01-01 00:00:00.123457+00'::timestamptz` }).where(eq(conversationRuns.conversationId, target.id));
  await expect(deleteEmptyConversation(target.id, preview!.fingerprint!)).rejects.toBeInstanceOf(ConversationDeletionStaleError);
  const fresh = await previewConversationDeletion(target.id);
  expect(fresh!.fingerprint).not.toBe(preview!.fingerprint);
  await membership(target.id);
  await expect(deleteEmptyConversation(target.id, fresh!.fingerprint!)).rejects.toBeInstanceOf(ConversationDeletionStaleError);
  expect((await previewConversationDeletion(target.id))!.recordedRunCount).toBe(2);
});

test("pending legacy indexing and retained external source links preserve metadata", async () => {
  const target = await empty(); const source = await membership(target.id, target.anchorRunId);
  const unindexed = randomUUID(); await body(unindexed);
  expect((await previewConversationDeletion(target.id))!.blockedReasons).toContain("pending_index");
  const other = await empty(); const external = await membership(other.id, unindexed, LOCAL_OWNER_ID, source);
  await getDatabase().update(runs).set({ branchSourceRunId: source, branchKind: "continuation-full" }).where(eq(runs.id, external));
  expect((await previewConversationDeletion(target.id))!.blockedReasons).not.toContain("pending_index");
  expect((await previewConversationDeletion(target.id))!.blockedReasons).toContain("retained_references");
  await getDatabase().delete(runs).where(eq(runs.id, external));
  // Unavailable membership links in a different conversation still matter.
  expect((await previewConversationDeletion(target.id))!.blockedReasons).toContain("retained_references");
});

test("concurrent deletion is exact-once and a serialized new membership requires new review", async () => {
  const target = await empty(); await membership(target.id, target.anchorRunId);
  const preview = await previewConversationDeletion(target.id);
  const results = await Promise.all([deleteEmptyConversation(target.id, preview!.fingerprint!), deleteEmptyConversation(target.id, preview!.fingerprint!)]);
  expect(results.filter((value) => value?.deleted)).toHaveLength(1);
  expect(results.filter((value) => value === undefined)).toHaveLength(1);
  const changed = await empty(); const before = await previewConversationDeletion(changed.id);
  let release!: () => void; let acquired!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const locked = new Promise<void>((resolve) => { acquired = resolve; });
  const newId = randomUUID(); runIds.push(newId);
  const writer = getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx); acquired(); await gate;
    await tx.insert(conversationRuns).values({ conversationId: changed.id, ownerId: LOCAL_OWNER_ID, runId: newId, kind: "independent", createdAt: sql`now()` });
  });
  await locked;
  const deletion = deleteEmptyConversation(changed.id, before!.fingerprint!);
  const assertion = expect(deletion).rejects.toBeInstanceOf(ConversationDeletionStaleError);
  release(); await writer; await assertion;
  expect((await previewConversationDeletion(changed.id))!.recordedRunCount).toBe(1);
});

test("oversized metadata is blocked without exposing a partial membership preview", async () => {
  const target = await empty();
  const values = Array.from({ length: MAX_CONVERSATION_DELETION_MEMBERS + 1 }, () => ({
    conversationId: target.id, ownerId: LOCAL_OWNER_ID, runId: randomUUID(), kind: "independent", createdAt: new Date(),
  }));
  runIds.push(...values.map((row) => row.runId)); await getDatabase().insert(conversationRuns).values(values);
  expect(await previewConversationDeletion(target.id)).toMatchObject({ eligible: false, fingerprint: null,
    recordedRunCount: MAX_CONVERSATION_DELETION_MEMBERS + 1, memberRunIds: [], blockedReasons: ["too_many_members"] });
  await expect(deleteEmptyConversation(target.id, "a".repeat(64))).rejects.toBeInstanceOf(ConversationDeletionBlockedError);
});

// Schema-drift fixtures are confined to the generated isolated database.
test.runIf(/\/da_it_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname))(
  "new dependent tables, metadata columns and custom triggers close the deletion boundary", async () => {
    const target = await empty();
    const suffix = randomUUID().replaceAll("-", "");
    const table = sql.identifier("deletion_fixture_" + suffix);
    const column = sql.identifier("deletion_fixture_" + suffix);
    const fn = sql.identifier("deletion_fixture_fn_" + suffix);
    const trigger = sql.identifier("deletion_fixture_trigger_" + suffix);
    try {
      await getDatabase().execute(sql`create table ${table} (conversation_id uuid references public.conversations(id))`);
      expect((await previewConversationDeletion(target.id))!.blockedReasons).toContain("schema_changed");
    } finally { await getDatabase().execute(sql`drop table if exists ${table}`); }
    try {
      await getDatabase().execute(sql`alter table public.conversations add column ${column} text`);
      expect((await previewConversationDeletion(target.id))!.blockedReasons).toContain("schema_changed");
    } finally { await getDatabase().execute(sql`alter table public.conversations drop column if exists ${column}`); }
    try {
      await getDatabase().execute(sql`create function ${fn}() returns trigger language plpgsql as 'begin return old; end;'`);
      await getDatabase().execute(sql`create trigger ${trigger} before delete on public.conversations for each row execute function ${fn}()`);
      expect((await previewConversationDeletion(target.id))!.blockedReasons).toContain("schema_changed");
      await expect(deleteEmptyConversation(target.id, "a".repeat(64))).rejects.toBeInstanceOf(ConversationDeletionBlockedError);
    } finally {
      await getDatabase().execute(sql`drop trigger if exists ${trigger} on public.conversations`);
      await getDatabase().execute(sql`drop function if exists ${fn}()`);
    }
    expect((await previewConversationDeletion(target.id))!.eligible).toBe(true);
  });
