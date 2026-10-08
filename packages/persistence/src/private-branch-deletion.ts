import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { privateBranchDeletionAuditSchema, type PrivateBranchDeletionAudit } from "@deliberation-ai/contracts";
import { getDatabase } from "./database";
import { decryptJson, encryptJson } from "./crypto";
import { getOwnerId } from "./owner";
import { conversationPrivateBranches as branches, privateBranchDeletions as deletions } from "./schema";
import { decodePrivateBranchBody, privateDeliveryPending, readPrivateBranch } from "./private-branches";
import { lockConversationMembership, ConversationIntegrityError, ConversationSizeError, type ConversationTransaction } from "./conversation-membership";

const MAX_ROWS = 1_000; const MAX_SCAN_BYTES = 32 * 1024 * 1024; const MAX_AUDIT_BYTES = 65_536;
export type PrivateBranchDeletionBlock = "copied_branches" | "pending_delivery" | "schema_changed" | "inspection_limit" | "audit_capacity" | "owner_mismatch";
export type PrivateBranchDeletionPreview = { version: "private-branch-deletion-v1"; branchId: string; conversationId: string;
  messageCount: number; receiptCount: number; ownReceiptCount: number; copiedBranchIds: string[];
  eligible: boolean; blockedReasons: PrivateBranchDeletionBlock[]; fingerprint: string | null };
export class PrivateBranchDeletionBlockedError extends Error {}
export class PrivateBranchDeletionStaleError extends Error {}
const owned = (id: string) => and(eq(deletions.id, id), eq(deletions.ownerId, getOwnerId()));

export function decodePrivateBranchDeletion(row: { id: string; conversationId: string; requestId: string; auditCiphertext: string; deletedAt: Date }) {
  if (Buffer.byteLength(row.auditCiphertext) > Math.ceil(MAX_AUDIT_BYTES * 4 / 3) + 128) throw new ConversationSizeError();
  const audit = privateBranchDeletionAuditSchema.parse(decryptJson(row.auditCiphertext, `private-branch-deletion:${row.id}:audit`));
  if (audit.branchId !== row.id || audit.conversationId !== row.conversationId || audit.creationRequestId !== row.requestId || audit.deletedAt !== row.deletedAt.toISOString() ||
    new Set(audit.receipts.map((item) => item.operationId)).size !== audit.receipts.length) throw new ConversationIntegrityError();
  return audit;
}
async function auditInSnapshot(tx: ConversationTransaction, id: string) {
  const [size] = await tx.select({ bytes: sql<number>`octet_length(${deletions.auditCiphertext})` }).from(deletions).where(owned(id)).limit(1);
  if (!size) return undefined;
  if (size.bytes > Math.ceil(MAX_AUDIT_BYTES * 4 / 3) + 128) throw new ConversationSizeError();
  const [row] = await tx.select().from(deletions).where(owned(id)).limit(1);
  return row ? decodePrivateBranchDeletion(row) : undefined;
}
export function loadPrivateBranchDeletion(id: string) {
  return getDatabase().transaction((tx) => auditInSnapshot(tx, id), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function exportPrivateBranchDeletions(tx: ConversationTransaction, conversationId: string) {
  const [size] = await tx.select({ count: sql<string>`count(*)::text`, bytes: sql<string>`coalesce(sum(octet_length(${deletions.auditCiphertext})), 0)::text` })
    .from(deletions).where(and(eq(deletions.ownerId, getOwnerId()), eq(deletions.conversationId, conversationId)));
  if (Number(size!.count) > MAX_ROWS || Number(size!.bytes) > MAX_SCAN_BYTES) throw new ConversationSizeError();
  const rows = await tx.select().from(deletions).where(and(eq(deletions.ownerId, getOwnerId()), eq(deletions.conversationId, conversationId))).orderBy(asc(deletions.id));
  return rows.map(decodePrivateBranchDeletion);
}
async function schemaSupported(tx: ConversationTransaction) {
  const columns = await tx.execute<{ table: string; column: string; type: string }>(sql`
    select c.relname as "table", a.attname as "column", format_type(a.atttypid, a.atttypmod) as "type"
    from pg_attribute a join pg_class c on c.oid = a.attrelid where a.attrelid in
      ('public.conversation_private_branches'::regclass, 'public.private_branch_deletions'::regclass)
      and a.attnum > 0 and not a.attisdropped order by c.relname, a.attname`);
  const expected = {
    conversation_private_branches: { body_ciphertext: "text", conversation_id: "uuid", created_at: "timestamp with time zone", id: "uuid",
      message_count: "integer", owner_id: "text", parent_branch_id: "uuid", request_hash: "text", request_id: "uuid", revision: "integer",
      source_member_id: "text", source_run_id: "uuid", updated_at: "timestamp with time zone" },
    private_branch_deletions: { audit_ciphertext: "text", conversation_id: "uuid", deleted_at: "timestamp with time zone", id: "uuid", owner_id: "text", request_id: "uuid" },
  };
  const fields = Object.entries(expected).flatMap(([table, values]) => Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([column, type]) => ({ table, column, type })));
  if (JSON.stringify(columns.rows) !== JSON.stringify(fields)) return false;
  const dependencies = await tx.execute<{ allowed: boolean }>(sql`
    select (k.conrelid = 'public.conversation_private_branches'::regclass and k.confrelid = 'public.conversations'::regclass and k.confdeltype = 'a'
      and k.conkey = array[(select attnum from pg_attribute where attrelid = k.conrelid and attname = 'conversation_id')]
      and k.confkey = array[(select attnum from pg_attribute where attrelid = k.confrelid and attname = 'id')]) as allowed
    from pg_constraint k where k.contype = 'f' and (k.conrelid in ('public.conversation_private_branches'::regclass, 'public.private_branch_deletions'::regclass)
      or k.confrelid in ('public.conversation_private_branches'::regclass, 'public.private_branch_deletions'::regclass))`);
  if (dependencies.rows.length !== 1 || dependencies.rows.some((item) => item.allowed !== true)) return false;
  const triggers = await tx.execute(sql`select 1 from pg_trigger where not tgisinternal and
    tgrelid in ('public.conversation_private_branches'::regclass, 'public.private_branch_deletions'::regclass) limit 1`);
  return triggers.rows.length === 0;
}
async function inspect(tx: ConversationTransaction, id: string) {
  const current = await readPrivateBranch(tx, id); if (!current) return undefined;
  const blockedReasons: PrivateBranchDeletionBlock[] = [];
  if (!await schemaSupported(tx)) blockedReasons.push("schema_changed");
  if (privateDeliveryPending(current.value.body)) blockedReasons.push("pending_delivery");
  const [foreign] = await tx.select({ id: branches.id }).from(branches).where(sql`${branches.ownerId} <> ${getOwnerId()}`).limit(1);
  if (foreign) blockedReasons.push("owner_mismatch");
  // Direct references include foreign rows; never delete someone's copy or expose its ID.
  const direct = await tx.select({ id: branches.id, ownerId: branches.ownerId }).from(branches).where(eq(branches.parentBranchId, id)).limit(MAX_ROWS + 1);
  const copied = new Set(direct.filter((row) => row.ownerId === getOwnerId()).map((row) => row.id));
  if (direct.length) blockedReasons.push("copied_branches");
  const [size] = await tx.select({ count: sql<string>`count(*)::text`, bytes: sql<string>`coalesce(sum(octet_length(${branches.bodyCiphertext})), 0)::text` })
    .from(branches).where(eq(branches.ownerId, getOwnerId()));
  if (Number(size!.count) > MAX_ROWS || Number(size!.bytes) > MAX_SCAN_BYTES || direct.length > MAX_ROWS) blockedReasons.push("inspection_limit");
  else {
    // Authenticate every bounded owned copy, including detached/cross-conversation
    // provenance references. Unreadable bodies close the boundary.
    const rows = await tx.select().from(branches).where(eq(branches.ownerId, getOwnerId())).orderBy(asc(branches.id));
    for (const row of rows) {
      if (row.id === id) continue;
      const body = decodePrivateBranchBody(row);
      if (body.messages.some((item) => item.originBranchId === id) || body.deliveries?.some((item) => item.originBranchId === id)) copied.add(row.id);
    }
    if (copied.size && !blockedReasons.includes("copied_branches")) blockedReasons.push("copied_branches");
  }
  const [count] = await tx.select({ value: sql<string>`count(*)::text` }).from(deletions)
    .where(and(eq(deletions.ownerId, getOwnerId()), eq(deletions.conversationId, current.row.conversationId)));
  if (Number(count!.value) >= MAX_ROWS) blockedReasons.push("audit_capacity");
  const eligible = blockedReasons.length === 0;
  const receipts = current.value.body.deliveries ?? [];
  const preview: PrivateBranchDeletionPreview = { version: "private-branch-deletion-v1", branchId: id, conversationId: current.row.conversationId,
    messageCount: current.row.messageCount, receiptCount: receipts.length, ownReceiptCount: receipts.filter((item) => item.originBranchId === id).length,
    copiedBranchIds: [...copied].sort(), eligible, blockedReasons, fingerprint: eligible ? createHash("sha256").update(JSON.stringify({
      version: "private-branch-deletion-v1", owner: getOwnerId(), row: current.row,
    })).digest("hex") : null };
  return { preview, current };
}
export function previewPrivateBranchDeletion(id: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '10s'`);
    return (await inspect(tx, id))?.preview;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export function deletePrivateBranch(id: string, fingerprint: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`); await tx.execute(sql`set local statement_timeout = '10s'`);
    await lockConversationMembership(tx);
    // Never wait on the worker lease after taking its owner lock: fail closed.
    const lease = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('private-delivery-v1'), hashtext(${id})) as acquired`);
    if (!lease.rows[0]?.acquired) throw new PrivateBranchDeletionBlockedError();
    await tx.execute(sql`lock table public.conversation_private_branches, public.private_branch_deletions in share row exclusive mode`);
    const previous = await auditInSnapshot(tx, id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new PrivateBranchDeletionStaleError();
      return previous;
    }
    const value = await inspect(tx, id); if (!value) return undefined;
    if (!value.preview.eligible) throw new PrivateBranchDeletionBlockedError();
    if (value.preview.fingerprint !== fingerprint) throw new PrivateBranchDeletionStaleError();
    const { row, value: branch } = value.current;
    const audit: PrivateBranchDeletionAudit = privateBranchDeletionAuditSchema.parse({ version: "private-branch-deletion-audit-v1", branchId: id,
      creationRequestId: row.requestId,
      conversationId: row.conversationId, sourceRunId: row.sourceRunId, parentBranchId: row.parentBranchId, deletedAt: new Date().toISOString(), fingerprint,
      messageCount: row.messageCount, receipts: (branch.body.deliveries ?? []).map((item) => ({ operationId: item.id, originBranchId: item.originBranchId,
        connectionId: item.connectionId, status: item.status, createdAt: item.createdAt, submittedAt: item.submittedAt, finishedAt: item.finishedAt,
        usage: item.usage ?? (item.result ? { model: item.result.model, remoteResponseId: item.result.remoteResponseId, inputTokens: item.result.inputTokens,
          outputTokens: item.result.outputTokens, tokenDetails: item.result.tokenDetails } : null) })) });
    if (Buffer.byteLength(JSON.stringify(audit)) > MAX_AUDIT_BYTES) throw new ConversationSizeError();
    await tx.insert(deletions).values({ id, ownerId: getOwnerId(), conversationId: row.conversationId, requestId: row.requestId,
      deletedAt: new Date(audit.deletedAt), auditCiphertext: encryptJson(audit, `private-branch-deletion:${id}:audit`) });
    const removed = await tx.delete(branches).where(and(eq(branches.id, id), eq(branches.ownerId, getOwnerId()))).returning({ id: branches.id });
    if (removed.length !== 1) throw new PrivateBranchDeletionStaleError();
    return audit;
  });
}
