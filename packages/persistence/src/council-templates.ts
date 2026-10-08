import { createHash, randomUUID } from "node:crypto";
import { councilMembersSchema, saveCouncilTemplateSchema, councilTemplateDeletionReceiptSchema,
  type CouncilMemberConfig, type SaveCouncilTemplateRequest, type CouncilTemplateDeletionReceipt } from "@deliberation-ai/contracts";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { decryptJson, encryptJson } from "./crypto";
import { getDatabase } from "./database";
import { getOwnerId } from "./owner";
import { councilTemplates } from "./schema";
import { ConversationIntegrityError, type ConversationTransaction } from "./conversation-membership";

export class CouncilTemplateConflictError extends Error {}
export class CouncilTemplateDeletionBlockedError extends Error {}
export class CouncilTemplateDeletionStaleError extends Error {}
type Row = typeof councilTemplates.$inferSelect;
const owned = (id: string) => and(eq(councilTemplates.ownerId, getOwnerId()), eq(councilTemplates.id, id));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const contentHash = (value: Pick<SaveCouncilTemplateRequest, "name" | "description" | "members">) => hash({ name: value.name, description: value.description, members: value.members });

async function lockWrites(tx: ConversationTransaction) {
  await tx.execute(sql`set local lock_timeout='5s'`);
  await tx.execute(sql`set local statement_timeout='10s'`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${getOwnerId()}), hashtext('council-template-writes-v1'))`);
  await tx.execute(sql`lock table council_templates in share row exclusive mode`);
}
export type CouncilTemplate = { id: string; name: string; description: string; members: CouncilMemberConfig[];
  memberCount: number; createdAt: string; updatedAt: string };
export function decodeCouncilTemplateDeletion(row: Pick<Row, "id" | "deletedAt" | "deletionReceiptCiphertext" | "creationRequestId" | "creationRequestHash" | "memberCount" | "name" | "description" | "membersCiphertext">): CouncilTemplateDeletionReceipt | undefined {
  if (!row.deletedAt && !row.deletionReceiptCiphertext) return undefined;
  if (!row.deletedAt || !row.deletionReceiptCiphertext || Buffer.byteLength(row.deletionReceiptCiphertext) > 8_192) throw new ConversationIntegrityError();
  const receipt = councilTemplateDeletionReceiptSchema.parse(decryptJson(row.deletionReceiptCiphertext, `council-template:${row.id}:deletion-receipt`));
  if (receipt.templateId !== row.id || receipt.creationRequestId !== row.creationRequestId || receipt.creationRequestHash !== row.creationRequestHash ||
      Boolean(row.creationRequestId) !== Boolean(row.creationRequestHash) ||
      receipt.deletedAt !== row.deletedAt.toISOString() || receipt.memberCount !== row.memberCount || row.name !== "" || row.description !== "" ||
      JSON.stringify(decryptJson(row.membersCiphertext, `council-template:${row.id}:members`)) !== "[]") throw new ConversationIntegrityError();
  return receipt;
}
function mapTemplate(row: Row): CouncilTemplate {
  if (decodeCouncilTemplateDeletion(row)) throw new CouncilTemplateConflictError();
  if (Boolean(row.creationRequestId) !== Boolean(row.creationRequestHash)) throw new ConversationIntegrityError();
  if (row.creationRequestHash && !/^[a-f0-9]{64}$/.test(row.creationRequestHash)) throw new ConversationIntegrityError();
  const members = councilMembersSchema.parse(decryptJson(row.membersCiphertext, `council-template:${row.id}:members`));
  if (members.length !== row.memberCount) throw new ConversationIntegrityError();
  return { id: row.id, name: row.name, description: row.description, members, memberCount: row.memberCount,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export async function listCouncilTemplates(): Promise<CouncilTemplate[]> {
  return (await getDatabase().select().from(councilTemplates)
    .where(and(eq(councilTemplates.ownerId, getOwnerId()), isNull(councilTemplates.deletedAt), isNull(councilTemplates.deletionReceiptCiphertext)))
    .orderBy(asc(councilTemplates.name))).map(mapTemplate);
}
export async function saveCouncilTemplate(input: SaveCouncilTemplateRequest): Promise<CouncilTemplate> {
  const request = saveCouncilTemplateSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    await lockWrites(tx);
    const [existing] = await tx.select().from(councilTemplates).where(request.id ? owned(request.id) :
      and(eq(councilTemplates.ownerId, getOwnerId()), eq(councilTemplates.creationRequestId, request.requestId!))).limit(1);
    if (existing) {
      const saved = mapTemplate(existing);
      if (!request.id) {
        if (existing.creationRequestHash !== contentHash(request) || contentHash(saved) !== contentHash(request)) throw new CouncilTemplateConflictError();
        return saved;
      }
    } else if (request.id) throw new CouncilTemplateConflictError();
    const [sameName] = await tx.select({ id: councilTemplates.id }).from(councilTemplates)
      .where(and(eq(councilTemplates.ownerId, getOwnerId()), eq(councilTemplates.name, request.name), isNull(councilTemplates.deletedAt))).limit(1);
    if (sameName && sameName.id !== existing?.id) throw new CouncilTemplateConflictError();
    const id = existing?.id ?? randomUUID();
    const values = { ownerId: getOwnerId(), name: request.name, description: request.description,
      membersCiphertext: encryptJson(request.members, `council-template:${id}:members`), memberCount: request.members.length, updatedAt: new Date() };
    const [saved] = existing ? await tx.update(councilTemplates).set(values).where(owned(id)).returning() :
      await tx.insert(councilTemplates).values({ id, ...values, creationRequestId: request.requestId!, creationRequestHash: contentHash(request) }).returning();
    if (!saved) throw new CouncilTemplateConflictError();
    return mapTemplate(saved);
  });
}

export type CouncilTemplateDeletionPreview = { version: "council-template-deletion-v1"; templateId: string; name: string;
  memberCount: number; eligible: boolean; blockedReasons: string[]; fingerprint: string | null; alreadyDeleted?: boolean };
async function schemaSupported(tx: ConversationTransaction): Promise<boolean> {
  const expected = getTableConfig(councilTemplates).columns.map((column) => ({ column: column.name, type: column.getSQLType(), notNull: column.notNull }))
    .sort((a, b) => a.column.localeCompare(b.column));
  const actual = await tx.execute<{ column: string; type: string; notNull: boolean }>(sql`select attname as column, format_type(atttypid,atttypmod) as type,
    attnotnull as "notNull" from pg_attribute where attrelid='public.council_templates'::regclass and attnum>0 and not attisdropped order by attname`);
  if (JSON.stringify(actual.rows) !== JSON.stringify(expected)) return false;
  const dependencies = await tx.execute(sql`select 1 from pg_constraint where contype='f' and
    (conrelid='public.council_templates'::regclass or confrelid='public.council_templates'::regclass) limit 1`);
  const triggers = await tx.execute(sql`select 1 from pg_trigger where not tgisinternal and tgrelid='public.council_templates'::regclass limit 1`);
  const checks = await tx.execute<{ name: string; valid: boolean; definition: string }>(sql`select conname as name, convalidated as valid, pg_get_constraintdef(oid) as definition from pg_constraint
    where conrelid='public.council_templates'::regclass and contype='c'`);
  const indexes = await tx.execute<{ name: string; keys: string; predicate: string | null; valid: boolean }>(sql`select c.relname as name,
    (select string_agg(a.attname,',' order by k.ordinality) from unnest(i.indkey) with ordinality k(attnum,ordinality)
     join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum) as keys,
    pg_get_expr(i.indpred,i.indrelid) as predicate, (i.indisvalid and i.indisready and i.indexprs is null and i.indnatts=i.indnkeyatts) as valid
    from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid='public.council_templates'::regclass and i.indisunique order by c.relname`);
  return !dependencies.rows.length && !triggers.rows.length && checks.rows.length === 1 && checks.rows[0]?.valid === true &&
    checks.rows[0]?.name === "council_templates_member_count_range" && checks.rows[0].definition.toLowerCase().replace(/[\s()\"]/g, "") === "checkmember_count>=2andmember_count<=6" && indexes.rows.length === 3 && indexes.rows.every((index) => index.valid && (
      index.name === "council_templates_pkey" && index.keys === "id" && index.predicate === null ||
      index.name === "council_templates_owner_request_uq" && index.keys === "owner_id,creation_request_id" && index.predicate === null ||
      index.name === "council_templates_owner_name_uq" && index.keys === "owner_id,name" && index.predicate === "(deleted_at IS NULL)"));
}
async function inspect(tx: ConversationTransaction, id: string) {
  const [size] = await tx.select({ bytes: sql<number>`octet_length(row_to_json(${councilTemplates})::text)` }).from(councilTemplates).where(owned(id)).limit(1);
  if (!size) return undefined;
  if (size.bytes > 1_048_576) throw new CouncilTemplateDeletionBlockedError();
  const [current] = await tx.select({ row: councilTemplates, exact: sql<unknown>`to_jsonb(${councilTemplates})` }).from(councilTemplates).where(owned(id)).limit(1);
  if (!current) return undefined;
  const previous = decodeCouncilTemplateDeletion(current.row);
  if (previous) return { previous };
  const template = mapTemplate(current.row);
  const blockedReasons = await schemaSupported(tx) ? [] : ["schema_changed"];
  const preview: CouncilTemplateDeletionPreview = { version: "council-template-deletion-v1", templateId: id, name: template.name, memberCount: template.memberCount,
    eligible: !blockedReasons.length, blockedReasons, fingerprint: blockedReasons.length ? null : hash({ owner: getOwnerId(), row: current.exact }) };
  return { current, preview };
}
export function previewCouncilTemplateDeletion(id: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout='10s'`);
    const value = await inspect(tx, id);
    if (value?.previous) return { version: "council-template-deletion-v1" as const, templateId: id, name: "", memberCount: value.previous.memberCount,
      eligible: false, blockedReasons: [], fingerprint: value.previous.fingerprint, alreadyDeleted: true };
    return value?.preview;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export function deleteCouncilTemplateContent(id: string, fingerprint: string) {
  return getDatabase().transaction(async (tx) => {
    await lockWrites(tx);
    const value = await inspect(tx, id);
    if (!value) return undefined;
    if (value.previous) {
      if (value.previous.fingerprint !== fingerprint) throw new CouncilTemplateDeletionStaleError();
      return value.previous;
    }
    if (!value.preview?.eligible) throw new CouncilTemplateDeletionBlockedError();
    if (value.preview.fingerprint !== fingerprint) throw new CouncilTemplateDeletionStaleError();
    const receipt = councilTemplateDeletionReceiptSchema.parse({ version: "council-template-deletion-v1", templateId: id,
      creationRequestId: value.current!.row.creationRequestId, creationRequestHash: value.current!.row.creationRequestHash,
      fingerprint, deletedAt: new Date().toISOString(), memberCount: value.current!.row.memberCount });
    const changed = await tx.update(councilTemplates).set({ name: "", description: "", membersCiphertext: encryptJson([], `council-template:${id}:members`),
      deletedAt: new Date(receipt.deletedAt), deletionReceiptCiphertext: encryptJson(receipt, `council-template:${id}:deletion-receipt`), updatedAt: new Date(receipt.deletedAt) })
      .where(owned(id)).returning({ id: councilTemplates.id });
    if (changed.length !== 1) throw new CouncilTemplateDeletionStaleError();
    return receipt;
  });
}
