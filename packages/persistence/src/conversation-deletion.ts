import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { conversations, conversationRuns, runs } from "./schema";
import { lockConversationMembership, type ConversationTransaction } from "./conversation-membership";

export const MAX_CONVERSATION_DELETION_MEMBERS = 1_000;
export type ConversationDeletionBlock = "available_runs" | "pending_index" | "owner_mismatch" |
  "retained_references" | "private_branches" | "too_many_members" | "schema_changed";
export type ConversationDeletionPreview = {
  version: "empty-conversation-deletion-v1";
  conversationId: string;
  createdAt: string;
  origin: "native" | "legacy-reconstructed";
  recordedRunCount: number;
  memberRunIds: string[];
  eligible: boolean;
  blockedReasons: ConversationDeletionBlock[];
  fingerprint: string | null;
};
export class ConversationDeletionBlockedError extends Error {}
export class ConversationDeletionStaleError extends Error {}

// DA-096 registers private branches as retained content, never deletion targets.
// Undeclared columns, dependencies or triggers still block metadata deletion.
async function supportsMetadataDeletion(tx: ConversationTransaction): Promise<boolean> {
  const columns = await tx.execute<{ table: string; column: string; type: string }>(sql`
    select c.relname as "table", a.attname as "column", format_type(a.atttypid, a.atttypmod) as "type"
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where a.attrelid in ('public.conversations'::regclass, 'public.conversation_runs'::regclass, 'public.conversation_private_branches'::regclass,
      'public.conversation_knowledge'::regclass, 'public.conversation_knowledge_selections'::regclass)
      and a.attnum > 0 and not a.attisdropped order by c.relname, a.attname
  `);
  const expected = {
    conversation_knowledge: { conversation_id: "uuid", owner_id: "text", revision: "uuid", selection_ciphertext: "text" },
    conversation_knowledge_selections: { collection_id: "uuid", conversation_id: "uuid", grant_id: "uuid", grant_revision: "integer", owner_id: "text" },
    conversation_private_branches: { body_ciphertext: "text", conversation_id: "uuid", created_at: "timestamp with time zone", id: "uuid",
      message_count: "integer", owner_id: "text", parent_branch_id: "uuid", request_hash: "text", request_id: "uuid", revision: "integer",
      source_member_id: "text", source_run_id: "uuid", updated_at: "timestamp with time zone" },
    conversation_runs: { conversation_id: "uuid", created_at: "timestamp with time zone", kind: "text", owner_id: "text", run_id: "uuid", source_run_id: "uuid" },
    conversations: { anchor_run_id: "uuid", created_at: "timestamp with time zone", id: "uuid", origin: "text", owner_id: "text" },
  };
  const expectedColumns = Object.entries(expected).flatMap(([table, fields]) => Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right)).map(([column, type]) => ({ table, column, type })));
  if (JSON.stringify(columns.rows) !== JSON.stringify(expectedColumns)) return false;
  const dependencies = await tx.execute<{ allowed: boolean }>(sql`
    select (k.conrelid in ('public.conversation_runs'::regclass, 'public.conversation_private_branches'::regclass,
      'public.conversation_knowledge'::regclass, 'public.conversation_knowledge_selections'::regclass)
      and k.confrelid = 'public.conversations'::regclass and k.confdeltype = 'a'
      and k.conkey = array[(select attnum from pg_attribute where attrelid = k.conrelid and attname = 'conversation_id')]
      and k.confkey = array[(select attnum from pg_attribute where attrelid = k.confrelid and attname = 'id')]) as allowed
    from pg_constraint k where k.contype = 'f' and
      (k.conrelid in ('public.conversations'::regclass, 'public.conversation_runs'::regclass, 'public.conversation_private_branches'::regclass)
       or k.confrelid in ('public.conversations'::regclass, 'public.conversation_runs'::regclass, 'public.conversation_private_branches'::regclass))
  `);
  if (dependencies.rows.length !== 4 || dependencies.rows.some((row) => row.allowed !== true)) return false;
  const customTriggers = await tx.execute(sql`select 1 from pg_trigger where not tgisinternal
    and tgrelid in ('public.conversations'::regclass, 'public.conversation_runs'::regclass, 'public.conversation_private_branches'::regclass,
      'public.conversation_knowledge'::regclass, 'public.conversation_knowledge_selections'::regclass) limit 1`);
  return customTriggers.rows.length === 0;
}

async function inspect(tx: ConversationTransaction, conversationId: string): Promise<ConversationDeletionPreview | undefined> {
  const [conversation] = await tx.select({ id: conversations.id, anchorRunId: conversations.anchorRunId,
    origin: conversations.origin, createdAt: sql<string>`${conversations.createdAt}::text` }).from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!conversation) return undefined;
  const blockedReasons: ConversationDeletionBlock[] = [];
  if (!await supportsMetadataDeletion(tx)) blockedReasons.push("schema_changed");
  const [count] = await tx.select({ value: sql<string>`count(*)::text` }).from(conversationRuns)
    .where(and(eq(conversationRuns.conversationId, conversationId), eq(conversationRuns.ownerId, LOCAL_OWNER_ID)));
  const recordedRunCount = Number(count!.value);
  if (recordedRunCount > MAX_CONVERSATION_DELETION_MEMBERS) blockedReasons.push("too_many_members");
  const members = await tx.select({ runId: conversationRuns.runId, sourceRunId: conversationRuns.sourceRunId,
    kind: conversationRuns.kind, createdAt: sql<string>`${conversationRuns.createdAt}::text` }).from(conversationRuns)
    .where(and(eq(conversationRuns.conversationId, conversationId), eq(conversationRuns.ownerId, LOCAL_OWNER_ID)))
    .orderBy(asc(conversationRuns.runId)).limit(MAX_CONVERSATION_DELETION_MEMBERS + 1);
  const checks = await tx.execute<{ available: boolean; pending: boolean; foreign: boolean; referenced: boolean; private: boolean; knowledge: boolean }>(sql`
    select
      exists(select 1 from runs r join conversation_runs cr on cr.run_id = r.id
        where cr.conversation_id = ${conversationId}::uuid and cr.owner_id = ${LOCAL_OWNER_ID} and r.owner_id = ${LOCAL_OWNER_ID}) as available,
      exists(select 1 from runs r where r.owner_id = ${LOCAL_OWNER_ID}
        and not exists(select 1 from conversation_runs cr where cr.owner_id = ${LOCAL_OWNER_ID} and cr.run_id = r.id)) as pending,
      exists(select 1 from conversation_private_branches b where b.conversation_id = ${conversationId}::uuid) as private,
      (exists(select 1 from conversation_knowledge k where k.conversation_id = ${conversationId}::uuid)
       or exists(select 1 from conversation_knowledge_selections k where k.conversation_id = ${conversationId}::uuid)) as knowledge,
      (exists(select 1 from conversation_runs cr where cr.conversation_id = ${conversationId}::uuid and cr.owner_id <> ${LOCAL_OWNER_ID})
       or exists(select 1 from conversation_private_branches b where b.conversation_id = ${conversationId}::uuid and b.owner_id <> ${LOCAL_OWNER_ID})
       or exists(select 1 from conversation_knowledge k where k.conversation_id = ${conversationId}::uuid and k.owner_id <> ${LOCAL_OWNER_ID})
       or exists(select 1 from conversation_knowledge_selections k where k.conversation_id = ${conversationId}::uuid and k.owner_id <> ${LOCAL_OWNER_ID})
       or exists(select 1 from runs r join conversation_runs cr on cr.run_id = r.id
         where cr.conversation_id = ${conversationId}::uuid and cr.owner_id = ${LOCAL_OWNER_ID} and r.owner_id <> ${LOCAL_OWNER_ID})) as foreign,
      (exists(select 1 from conversation_private_branches b where b.owner_id = ${LOCAL_OWNER_ID} and b.conversation_id <> ${conversationId}::uuid and
         (b.source_run_id = ${conversation.anchorRunId}::uuid or b.source_run_id in (select run_id from conversation_runs where owner_id = ${LOCAL_OWNER_ID} and conversation_id = ${conversationId}::uuid)))
       or exists(select 1 from runs r where r.owner_id = ${LOCAL_OWNER_ID} and
         (r.id = ${conversation.anchorRunId}::uuid or r.branch_source_run_id = ${conversation.anchorRunId}::uuid or
          r.branch_source_run_id in (select run_id from conversation_runs where owner_id = ${LOCAL_OWNER_ID} and conversation_id = ${conversationId}::uuid)))
       or exists(select 1 from conversation_runs cr where cr.owner_id = ${LOCAL_OWNER_ID} and cr.conversation_id <> ${conversationId}::uuid and
         (cr.run_id = ${conversation.anchorRunId}::uuid or cr.source_run_id = ${conversation.anchorRunId}::uuid or
          cr.source_run_id in (select run_id from conversation_runs where owner_id = ${LOCAL_OWNER_ID} and conversation_id = ${conversationId}::uuid)))) as referenced
  `);
  const flags = checks.rows[0]!;
  if (flags.available) blockedReasons.push("available_runs");
  if (flags.private) blockedReasons.push("private_branches");
  if (flags.pending) blockedReasons.push("pending_index");
  if (flags.foreign) blockedReasons.push("owner_mismatch");
  if (flags.referenced || flags.knowledge) blockedReasons.push("retained_references");
  const eligible = blockedReasons.length === 0;
  const fingerprint = eligible ? createHash("sha256").update(JSON.stringify({
    version: "empty-conversation-deletion-v1", ownerId: LOCAL_OWNER_ID, conversation, members,
  })).digest("hex") : null;
  return { version: "empty-conversation-deletion-v1", conversationId, createdAt: new Date(conversation.createdAt).toISOString(),
    origin: conversation.origin as ConversationDeletionPreview["origin"], recordedRunCount,
    memberRunIds: recordedRunCount <= MAX_CONVERSATION_DELETION_MEMBERS ? members.map((row) => row.runId) : [],
    eligible, blockedReasons, fingerprint };
}

export async function previewConversationDeletion(conversationId: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '10s'`);
    return inspect(tx, conversationId);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function deleteEmptyConversation(conversationId: string, fingerprint: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '10s'`);
    await lockConversationMembership(tx);
    // Stabilize schema, membership and body/reference absence, including direct
    // database writers. Keep the existing owner-before-row/table lock order.
    await tx.execute(sql`lock table public.conversations, public.conversation_runs in share row exclusive mode`);
    await tx.execute(sql`lock table public.runs in share mode`);
    await tx.execute(sql`lock table public.conversation_private_branches in share mode`);
    await tx.execute(sql`lock table public.conversation_knowledge, public.conversation_knowledge_selections in share mode`);
    const preview = await inspect(tx, conversationId);
    if (!preview) return undefined;
    if (!preview.eligible) throw new ConversationDeletionBlockedError();
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || fingerprint !== preview.fingerprint) throw new ConversationDeletionStaleError();
    const removed = await tx.delete(conversationRuns).where(and(eq(conversationRuns.conversationId, conversationId),
      eq(conversationRuns.ownerId, LOCAL_OWNER_ID))).returning({ runId: conversationRuns.runId });
    if (removed.length !== preview.recordedRunCount) throw new ConversationDeletionStaleError();
    const deleted = await tx.delete(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, LOCAL_OWNER_ID)))
      .returning({ id: conversations.id });
    if (deleted.length !== 1) throw new ConversationDeletionStaleError();
    return { deleted: true as const, conversationId, deletedMembershipCount: removed.length };
  });
}
