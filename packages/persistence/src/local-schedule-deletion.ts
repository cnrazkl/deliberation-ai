import { and, asc, eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { localScheduleDeletionReceiptSchema, type LocalScheduleDeletionReceipt } from "@deliberation-ai/contracts";
import { getDatabase } from "./database";
import { decryptJson, decryptText, encryptJson, encryptText } from "./crypto";
import { getOwnerId } from "./owner";
import { localSchedules, runs } from "./schema";
import { lockConversationMembership, ConversationIntegrityError, type ConversationTransaction } from "./conversation-membership";
import { scheduleSnapshotHash } from "./schedule-occurrences";

export class LocalScheduleDeletionBlockedError extends Error {}
export class LocalScheduleDeletionStaleError extends Error {}
export type LocalScheduleDeletionPreview = { version: "local-schedule-deletion-v1"; scheduleId: string; status: string;
  retainedRunCount: number; retainedLastRunId: string | null; eligible: boolean; blockedReasons: string[]; fingerprint: string | null; alreadyDeleted?: boolean };
const owned = (id: string) => and(eq(localSchedules.id, id), eq(localSchedules.ownerId, getOwnerId()));
type ReceiptRow = Pick<typeof localSchedules.$inferSelect, "id" | "creationRequestId" | "deletedAt" | "deletionReceiptCiphertext" |
  "nameCiphertext" | "questionCiphertext" | "membersCiphertext" | "executionLimitsCiphertext" | "status">;
export function decodeLocalScheduleDeletion(row: ReceiptRow): LocalScheduleDeletionReceipt | undefined {
  if (!row.deletedAt && !row.deletionReceiptCiphertext) return undefined;
  if (!row.deletedAt || !row.deletionReceiptCiphertext || Buffer.byteLength(row.deletionReceiptCiphertext) > 8_192) throw new ConversationIntegrityError();
  const receipt = localScheduleDeletionReceiptSchema.parse(decryptJson(row.deletionReceiptCiphertext, `local-schedule:${row.id}:deletion-receipt`));
  if (receipt.scheduleId !== row.id || receipt.creationRequestId !== row.creationRequestId || receipt.deletedAt !== row.deletedAt.toISOString() || row.status !== "paused" ||
    decryptText(row.nameCiphertext, `local-schedule:${row.id}:name`) !== "" || decryptText(row.questionCiphertext, `local-schedule:${row.id}:question`) !== "" ||
    JSON.stringify(decryptJson(row.membersCiphertext, `local-schedule:${row.id}:members`)) !== "[]" || row.executionLimitsCiphertext !== null) throw new ConversationIntegrityError();
  return receipt;
}
async function schemaSupported(tx: ConversationTransaction) {
  const expected = getTableConfig(localSchedules).columns.map((column) => ({ column: column.name, type: column.getSQLType(), notNull: column.notNull })).sort((a,b) => a.column.localeCompare(b.column));
  const actual = await tx.execute<{ column: string; type: string; notNull: boolean }>(sql`select attname as column, format_type(atttypid,atttypmod) as type, attnotnull as "notNull"
    from pg_attribute where attrelid='public.local_schedules'::regclass and attnum>0 and not attisdropped order by attname`);
  if (JSON.stringify(actual.rows) !== JSON.stringify(expected)) return false;
  const deps = await tx.execute<{ allowed: boolean }>(sql`select (conrelid='public.local_schedules'::regclass and confrelid='public.runs'::regclass and confdeltype='n'
    and conkey=array[(select attnum from pg_attribute where attrelid=conrelid and attname='last_run_id')]
    and confkey=array[(select attnum from pg_attribute where attrelid=confrelid and attname='id')]) as allowed
    from pg_constraint where contype='f' and (conrelid='public.local_schedules'::regclass or confrelid='public.local_schedules'::regclass)`);
  if (deps.rows.length !== 1 || deps.rows.some((row) => row.allowed !== true)) return false;
  const triggers = await tx.execute(sql`select 1 from pg_trigger where not tgisinternal and tgrelid='public.local_schedules'::regclass limit 1`);
  const unique = await tx.execute<{ valid: boolean }>(sql`select exists(select 1 from pg_index i where indrelid='public.local_schedules'::regclass and indisunique and indisvalid
    and indisready and indpred is null and indexprs is null and indnkeyatts=2 and indkey::text=(select string_agg(attnum::text,' ' order by case attname when 'owner_id' then 0 else 1 end)
      from pg_attribute where attrelid=i.indrelid and attname in ('owner_id','creation_request_id'))) as valid`);
  return triggers.rows.length === 0 && unique.rows[0]?.valid === true;
}
async function inspect(tx: ConversationTransaction, id: string) {
  const [size] = await tx.select({ bytes: sql<number>`octet_length(row_to_json(${localSchedules})::text)` }).from(localSchedules).where(owned(id)).limit(1);
  if (!size) return undefined; if (size.bytes > 1_048_576) throw new LocalScheduleDeletionBlockedError();
  const [current] = await tx.select({ row: localSchedules, exact: sql<unknown>`to_jsonb(${localSchedules})` }).from(localSchedules).where(owned(id)).limit(1);
  if (!current) return undefined;
  const previous = decodeLocalScheduleDeletion(current.row); if (previous) return { previous };
  const blockedReasons: string[] = [];
  if (!await schemaSupported(tx)) blockedReasons.push("schema_changed");
  if (current.row.status !== "paused") blockedReasons.push("active_schedule");
  if (current.row.lastRunId) {
    const [foreign] = await tx.select({ owner: runs.ownerId }).from(runs).where(eq(runs.id, current.row.lastRunId)).limit(1);
    if (foreign && foreign.owner !== getOwnerId()) blockedReasons.push("owner_mismatch");
  }
  const retained = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.ownerId, getOwnerId()), sql`${runs.idempotencyKey} like ${`schedule:${id}:%`}`)).orderBy(asc(runs.id)).limit(1_001);
  if (retained.length > 1_000) blockedReasons.push("inspection_limit");
  const eligible = blockedReasons.length === 0;
  const preview: LocalScheduleDeletionPreview = { version: "local-schedule-deletion-v1", scheduleId: id, status: current.row.status,
    retainedRunCount: retained.length, retainedLastRunId: current.row.lastRunId, eligible, blockedReasons,
    fingerprint: eligible ? scheduleSnapshotHash({ owner: getOwnerId(), row: current.exact, retained }) : null };
  return { current, preview };
}
export function previewLocalScheduleDeletion(id: string) {
  return getDatabase().transaction(async (tx) => { await tx.execute(sql`set local statement_timeout='10s'`);
    const value = await inspect(tx,id);
    if (value?.previous) return { version: "local-schedule-deletion-v1" as const, scheduleId: id, status: "paused", retainedRunCount: 0,
      retainedLastRunId: value.previous.retainedLastRunId, eligible: false, blockedReasons: [], fingerprint: value.previous.fingerprint, alreadyDeleted: true };
    return value?.preview;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export function deleteLocalScheduleContent(id: string, fingerprint: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout='5s'`); await tx.execute(sql`set local statement_timeout='10s'`);
    await lockConversationMembership(tx); await tx.execute(sql`lock table local_schedules in share row exclusive mode`);
    const value = await inspect(tx,id); if (!value) return undefined;
    if (value.previous) { if (value.previous.fingerprint !== fingerprint) throw new LocalScheduleDeletionStaleError(); return value.previous; }
    if (!value.preview?.eligible) throw new LocalScheduleDeletionBlockedError();
    if (value.preview.fingerprint !== fingerprint) throw new LocalScheduleDeletionStaleError();
    const receipt = localScheduleDeletionReceiptSchema.parse({ version: "local-schedule-deletion-v1", scheduleId: id,
      creationRequestId: value.current!.row.creationRequestId, fingerprint, deletedAt: new Date().toISOString(), retainedLastRunId: value.current!.row.lastRunId });
    const changed = await tx.update(localSchedules).set({ nameCiphertext: encryptText("",`local-schedule:${id}:name`), questionCiphertext: encryptText("",`local-schedule:${id}:question`),
      membersCiphertext: encryptJson([],`local-schedule:${id}:members`), executionLimitsCiphertext: null, deletedAt: new Date(receipt.deletedAt),
      deletionReceiptCiphertext: encryptJson(receipt,`local-schedule:${id}:deletion-receipt`), updatedAt: new Date(receipt.deletedAt) }).where(owned(id)).returning({ id: localSchedules.id });
    if (changed.length !== 1) throw new LocalScheduleDeletionStaleError();
    return receipt;
  });
}
