import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { preflightDraftDeletionReceiptSchema, type PreflightDraftDeletionReceipt } from "@deliberation-ai/contracts";
import { getDatabase } from "./database";
import { lockConversationMembership, ConversationIntegrityError, type ConversationTransaction } from "./conversation-membership";
import { getOwnerId } from "./owner";
import { preflightDrafts } from "./schema";

export class PreflightDraftDeletionBlockedError extends Error {}
export class PreflightDraftDeletionStaleError extends Error {}
export type PreflightDraftDeletionPreview = {
  version: "preflight-draft-deletion-v1"; draftId: string; status: string;
  retainedRunId: string | null; hasQuestion: boolean; hasRequest: boolean;
  eligible: boolean; blockedReasons: string[]; fingerprint: string | null;
  alreadyDeleted?: boolean;
};
const owned = (id: string) => and(eq(preflightDrafts.id, id), eq(preflightDrafts.ownerId, getOwnerId()));

// A tombstone uses the existing JSON metadata column, never either content field.
// Its strict, content-free shape replaces the frozen clarification questions.
export function readPreflightDraftDeletion(row: { id: string; status: string; questions: unknown; questionCiphertext: string | null; requestCiphertext: string | null }): PreflightDraftDeletionReceipt | undefined {
  if (!row.questions || typeof row.questions !== "object" || !("version" in row.questions)) return undefined;
  const receipt = preflightDraftDeletionReceiptSchema.parse(row.questions);
  if (receipt.draftId !== row.id || row.status !== "cancelled" || row.questionCiphertext !== null || row.requestCiphertext !== null) throw new ConversationIntegrityError();
  return receipt;
}
export async function isPreflightIntentClosed(tx: ConversationTransaction, key: string) {
  const [row] = await tx.select({ status: preflightDrafts.status }).from(preflightDrafts)
    .where(and(eq(preflightDrafts.ownerId, getOwnerId()), eq(preflightDrafts.idempotencyKey, key))).limit(1);
  return row?.status === "cancelled";
}
async function schemaSupported(tx: ConversationTransaction) {
  const fields = await tx.execute<{ column: string; type: string }>(sql`
    select a.attname as column, format_type(a.atttypid,a.atttypmod) as type from pg_attribute a
    where a.attrelid='public.preflight_drafts'::regclass and a.attnum>0 and not a.attisdropped order by a.attname`);
  const expected = { created_at: "timestamp with time zone", id: "uuid", idempotency_key: "text", owner_id: "text",
    question_ciphertext: "text", questions: "jsonb", request_ciphertext: "text", request_hash: "text", run_id: "uuid", status: "text", updated_at: "timestamp with time zone" };
  if (JSON.stringify(fields.rows) !== JSON.stringify(Object.entries(expected).map(([column, type]) => ({ column, type })))) return false;
  const dependencies = await tx.execute<{ allowed: boolean }>(sql`
    select (k.conrelid='public.preflight_drafts'::regclass and k.confrelid='public.runs'::regclass and k.confdeltype='n'
      and k.conkey=array[(select attnum from pg_attribute where attrelid=k.conrelid and attname='run_id')]
      and k.confkey=array[(select attnum from pg_attribute where attrelid=k.confrelid and attname='id')]) as allowed
    from pg_constraint k where k.contype='f' and (k.conrelid='public.preflight_drafts'::regclass or k.confrelid='public.preflight_drafts'::regclass)`);
  if (dependencies.rows.length !== 1 || dependencies.rows.some((row) => row.allowed !== true)) return false;
  const unique = await tx.execute<{ valid: boolean }>(sql`select exists(
    select 1 from pg_index i where i.indrelid='public.preflight_drafts'::regclass and i.indisunique and i.indisvalid
      and i.indisready and i.indpred is null and i.indexprs is null and i.indnkeyatts=2
      and i.indkey::text=(select string_agg(attnum::text,' ' order by case attname when 'owner_id' then 0 else 1 end)
        from pg_attribute where attrelid=i.indrelid and attname in ('owner_id','idempotency_key'))
  ) as valid`);
  if (!unique.rows[0]?.valid) return false;
  const triggers = await tx.execute(sql`select 1 from pg_trigger where not tgisinternal and tgrelid='public.preflight_drafts'::regclass limit 1`);
  return triggers.rows.length === 0;
}
async function inspect(tx: ConversationTransaction, id: string) {
  const [size] = await tx.select({ bytes: sql<number>`octet_length(row_to_json(${preflightDrafts})::text)` }).from(preflightDrafts).where(owned(id)).limit(1);
  if (!size) return undefined;
  if (size.bytes > 24 * 1024 * 1024) throw new PreflightDraftDeletionBlockedError();
  const [row] = await tx.select().from(preflightDrafts).where(owned(id)).limit(1);
  if (!row) return undefined;
  const previous = readPreflightDraftDeletion(row);
  if (previous) return { row, previous };
  const blockedReasons: string[] = [];
  if (!await schemaSupported(tx)) blockedReasons.push("schema_changed");
  if (!["awaiting_input", "started", "cancelled"].includes(row.status)) blockedReasons.push("invalid_state");
  if (row.runId) {
    const check = await tx.execute<{ foreign: boolean }>(sql`select exists(select 1 from runs where id=${row.runId}::uuid and owner_id<>${getOwnerId()}) as foreign`);
    if (check.rows[0]?.foreign) blockedReasons.push("owner_mismatch");
  }
  const exact = await tx.execute<{ value: unknown }>(sql`select to_jsonb(d) as value from preflight_drafts d where id=${id}::uuid and owner_id=${getOwnerId()}`);
  const eligible = blockedReasons.length === 0;
  const fingerprint = eligible ? createHash("sha256").update(JSON.stringify({ version: "preflight-draft-deletion-v1", owner: getOwnerId(), row: exact.rows[0]!.value })).digest("hex") : null;
  const preview: PreflightDraftDeletionPreview = { version: "preflight-draft-deletion-v1", draftId: id, status: row.status,
    retainedRunId: row.runId, hasQuestion: row.questionCiphertext !== null, hasRequest: row.requestCiphertext !== null,
    eligible, blockedReasons, fingerprint };
  return { row, preview };
}
export function previewPreflightDraftDeletion(id: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout='10s'`);
    const value = await inspect(tx, id);
    if (value?.previous) return { version: "preflight-draft-deletion-v1" as const, draftId: id, status: "cancelled",
      retainedRunId: value.previous.retainedRunId, hasQuestion: false, hasRequest: false,
      eligible: false, blockedReasons: [], fingerprint: value.previous.fingerprint, alreadyDeleted: true };
    return value?.preview;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export function deletePreflightDraftContent(id: string, fingerprint: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout='5s'`); await tx.execute(sql`set local statement_timeout='10s'`);
    await lockConversationMembership(tx);
    await tx.execute(sql`lock table preflight_drafts in share row exclusive mode`);
    const value = await inspect(tx, id); if (!value) return undefined;
    if (value.previous) {
      if (value.previous.fingerprint !== fingerprint) throw new PreflightDraftDeletionStaleError();
      return value.previous;
    }
    if (!value.preview?.eligible) throw new PreflightDraftDeletionBlockedError();
    if (value.preview.fingerprint !== fingerprint) throw new PreflightDraftDeletionStaleError();
    const receipt = preflightDraftDeletionReceiptSchema.parse({ version: "preflight-draft-deletion-v1", draftId: id,
      fingerprint, deletedAt: new Date().toISOString(), previousStatus: value.row.status, retainedRunId: value.row.runId });
    const changed = await tx.update(preflightDrafts).set({ status: "cancelled", questionCiphertext: null, requestCiphertext: null,
      questions: receipt, updatedAt: new Date(receipt.deletedAt) }).where(owned(id)).returning({ id: preflightDrafts.id });
    if (changed.length !== 1) throw new PreflightDraftDeletionStaleError();
    return receipt;
  });
}
