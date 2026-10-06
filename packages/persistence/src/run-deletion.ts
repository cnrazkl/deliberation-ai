import { createHash } from "node:crypto";
import { and, asc, eq, getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { runDeletionAuditSchema, type RunDeletionAudit } from "@deliberation-ai/contracts";
import { getDatabase } from "./database";
import { decryptJson, encryptJson } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import * as s from "./schema";
import { lockConversationMembership, ConversationIntegrityError, ConversationSizeError, type ConversationTransaction } from "./conversation-membership";
import { decodePrivateBranchBody } from "./private-branches";
import { projectRunBranch } from "./run-branches";
import { mapStoredRun } from "./run-repository";
import { readTokenDetails } from "./provider-usage";
import { RUN_COUNCIL_QUEUE } from "./queue";

const MAX_ROWS = 1_000; const MAX_BYTES = 64 * 1024 * 1024; const MAX_AUDIT_BYTES = 512 * 1024;
const terminal = new Set(["completed", "partially_completed", "failed", "cancelled"]);
const pending = new Set(["prepared", "submitted", "outcome_unknown", "retry_authorized"]);
// Explicit reviewed closure: new cascade tables must be added deliberately.
const contentTables = [s.runs, s.modelRuns, s.claims, s.claimOccurrences, s.memoryEntries, s.evidenceSources,
  s.researchCaptures, s.decisionAssessments, s.decisionOperations, s.providerOperations, s.runEvents];
const protectedTables = [...contentTables, s.preflightDrafts, s.localSchedules, s.conversationRuns, s.conversations,
  s.conversationPrivateBranches, s.runDeletions, s.providerBillingRecords];
const tableNames = protectedTables.map(getTableName);
const contentNames = contentTables.map(getTableName);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type RunDeletionBlock = "active_run" | "pending_operations" | "decision_boundary" | "copied_content" |
  "owner_mismatch" | "pending_index" | "schema_changed" | "inspection_limit" | "audit_capacity" | "invalid_queue_job";
export type RunDeletionPreview = { version: "run-body-deletion-v1"; runId: string; conversationId: string | null;
  eligible: boolean; fingerprint: string | null; blockedReasons: RunDeletionBlock[]; copiedRunIds: string[]; privateBranchIds: string[];
  contentCounts: Record<string, number>; receiptCount: number; retainedPreflightCount: number; retainedScheduleCount: number; retainedBillingCount: number };
export class RunDeletionBlockedError extends Error {}
export class RunDeletionStaleError extends Error {}
export async function isRunIntentDeleted(tx: ConversationTransaction, key: string) {
  const [row] = await tx.select({ id: s.runDeletions.id }).from(s.runDeletions)
    .where(and(eq(s.runDeletions.ownerId, LOCAL_OWNER_ID), eq(s.runDeletions.intentKeyHash, hash(key)))).limit(1);
  return Boolean(row);
}
export function decodeRunDeletion(row: typeof s.runDeletions.$inferSelect) {
  if (Buffer.byteLength(row.auditCiphertext) > MAX_AUDIT_BYTES * 2) throw new ConversationSizeError();
  const audit = runDeletionAuditSchema.parse(decryptJson(row.auditCiphertext, `run-deletion:${row.id}:audit`));
  if (audit.runId !== row.id || audit.conversationId !== row.conversationId || audit.creationIntentHash !== row.intentKeyHash ||
    audit.deletedAt !== row.deletedAt.toISOString() || new Set(audit.receipts.map((item) => item.operationId)).size !== audit.receipts.length) throw new ConversationIntegrityError();
  return audit;
}
async function readAudit(tx: ConversationTransaction, id: string) {
  const predicate = and(eq(s.runDeletions.id, id), eq(s.runDeletions.ownerId, LOCAL_OWNER_ID));
  const [size] = await tx.select({ bytes: sql<number>`octet_length(${s.runDeletions.auditCiphertext})` }).from(s.runDeletions).where(predicate).limit(1);
  if (!size) return undefined;
  if (size.bytes > MAX_AUDIT_BYTES * 2) throw new ConversationSizeError();
  const [row] = await tx.select().from(s.runDeletions).where(predicate).limit(1);
  return row ? decodeRunDeletion(row) : undefined;
}
export function loadRunDeletion(id: string) {
  return getDatabase().transaction((tx) => readAudit(tx, id), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function exportRunDeletions(tx: ConversationTransaction, conversationId: string) {
  const predicate = and(eq(s.runDeletions.ownerId, LOCAL_OWNER_ID), eq(s.runDeletions.conversationId, conversationId));
  const [size] = await tx.select({ count: sql<string>`count(*)::text`, bytes: sql<string>`coalesce(sum(octet_length(${s.runDeletions.auditCiphertext})),0)::text` })
    .from(s.runDeletions).where(predicate);
  if (Number(size!.count) > MAX_ROWS || Number(size!.bytes) > 32 * 1024 * 1024) throw new ConversationSizeError();
  return (await tx.select().from(s.runDeletions).where(predicate).orderBy(asc(s.runDeletions.id))).map(decodeRunDeletion);
}
async function schemaSupported(tx: ConversationTransaction) {
  const configs = protectedTables.map(getTableConfig);
  const expectedColumns = configs.flatMap((config) => config.columns.map((col) => ({ table: config.name, column: col.name,
    type: col.getSQLType().replace(/^varchar/, "character varying").replace(/^numeric\((\d+), (\d+)\)$/, "numeric($1,$2)"), notNull: col.notNull })))
    .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
  const actual = await tx.execute<{ table: string; column: string; type: string; notNull: boolean }>(sql`
    select c.relname as "table", a.attname as "column", format_type(a.atttypid,a.atttypmod) as "type", a.attnotnull as "notNull"
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (${sql.join(tableNames.map((name) => sql`${name}`), sql`,`)})
    and a.attnum>0 and not a.attisdropped order by c.relname,a.attname`);
  if (JSON.stringify(actual.rows) !== JSON.stringify(expectedColumns)) return false;
  const actions = { "no action": "a", restrict: "r", cascade: "c", "set null": "n", "set default": "d" } as const;
  const expected = configs.flatMap((config) => config.foreignKeys.map((key) => {
    const ref = key.reference(); return { table: config.name, target: getTableName(ref.foreignTable), columns: ref.columns.map((col) => col.name),
      targets: ref.foreignColumns.map((col) => col.name), action: actions[key.onDelete ?? "no action"] };
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const keys = await tx.execute<{ table: string; target: string; columns: string[]; targets: string[]; action: string }>(sql`
    select c.relname as "table", f.relname as target,
      array(select a.attname::text from unnest(k.conkey) with ordinality u(num,ord) join pg_attribute a on a.attrelid=k.conrelid and a.attnum=u.num order by u.ord) as columns,
      array(select a.attname::text from unnest(k.confkey) with ordinality u(num,ord) join pg_attribute a on a.attrelid=k.confrelid and a.attnum=u.num order by u.ord) as targets,
      k.confdeltype::text as action from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_class f on f.oid=k.confrelid
      where k.contype='f' and (k.conrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname in (${sql.join(tableNames.map((name) => sql`${name}`), sql`,`)}))
      or k.confrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname in (${sql.join(contentNames.map((name) => sql`${name}`), sql`,`)})))`);
  const actualKeys = keys.rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (JSON.stringify(actualKeys) !== JSON.stringify(expected)) return false;
  // Existing immutable snapshots have two reviewed update-only triggers;
  // all other custom triggers, especially deletion side effects, fail closed.
  const triggers = await tx.execute<{ table: string; name: string; type: number; body: string; language: string; enabled: string }>(sql`
    select c.relname as "table", t.tgname as name, t.tgtype::int as type, p.prosrc as body, l.lanname as language, t.tgenabled::text as enabled
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid join pg_language l on l.oid=p.prolang
    where not t.tgisinternal and t.tgrelid in
    (select oid from pg_class where relnamespace='public'::regnamespace and relname in (${sql.join(tableNames.map((name) => sql`${name}`), sql`,`)}))`);
  const bodies: Record<string, string> = {
    evidence_sources: `BEGIN IF NEW.excerpt_ciphertext IS DISTINCT FROM OLD.excerpt_ciphertext
      OR NEW.captured_at IS DISTINCT FROM OLD.captured_at OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR NEW.candidate_provenance_ciphertext IS DISTINCT FROM OLD.candidate_provenance_ciphertext
      OR (OLD.candidate_provenance_ciphertext IS NOT NULL AND (
        NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
        OR NEW.claim_id IS DISTINCT FROM OLD.claim_id OR NEW.report_claim_id IS DISTINCT FROM OLD.report_claim_id
        OR NEW.title_ciphertext IS DISTINCT FROM OLD.title_ciphertext OR NEW.url_ciphertext IS DISTINCT FROM OLD.url_ciphertext
        OR NEW.note_ciphertext IS DISTINCT FROM OLD.note_ciphertext OR NEW.relation IS DISTINCT FROM OLD.relation)) THEN
      RAISE EXCEPTION 'Evidence source snapshot fields are immutable'; END IF; RETURN NEW; END;`,
    research_captures: `BEGIN IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
      OR NEW.claim_id IS DISTINCT FROM OLD.claim_id OR NEW.report_claim_id IS DISTINCT FROM OLD.report_claim_id
      OR NEW.requested_url_ciphertext IS DISTINCT FROM OLD.requested_url_ciphertext OR NEW.final_url_ciphertext IS DISTINCT FROM OLD.final_url_ciphertext
      OR NEW.title_ciphertext IS DISTINCT FROM OLD.title_ciphertext OR NEW.content_ciphertext IS DISTINCT FROM OLD.content_ciphertext
      OR NEW.content_type IS DISTINCT FROM OLD.content_type OR NEW.byte_length IS DISTINCT FROM OLD.byte_length
      OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR NEW.redirect_count IS DISTINCT FROM OLD.redirect_count
      OR NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN RAISE EXCEPTION 'research capture snapshot fields are immutable'; END IF; RETURN NEW; END;`,
  };
  const names: Record<string, string> = { evidence_sources: "evidence_source_snapshot_immutable", research_captures: "research_capture_snapshot_immutable" };
  const normalize = (body: string) => body.replace(/\s+/g, " ").trim();
  return triggers.rows.length === 2 && triggers.rows.every((trigger) => trigger.name === names[trigger.table] && trigger.type === 19 &&
    trigger.language === "plpgsql" && trigger.enabled === "O" && normalize(trigger.body) === normalize(bodies[trigger.table] ?? ""));
}
function references(value: unknown, id: string): boolean {
  // Frozen history and original compaction archives embed earlier JSON as text.
  // Traverse those layers too, even after their immediate source body was pruned.
  const remaining: unknown[] = [value]; let inspected = 0;
  while (remaining.length) {
    if (++inspected > 1_000_000) throw new ConversationSizeError();
    const current = remaining.pop();
    if (typeof current === "string") {
      if (current.toLowerCase() === id) return true;
      if (/^\s*[\[{]/.test(current)) {
        try { remaining.push(JSON.parse(current)); } catch { /* Ordinary prose is not a structured provenance link. */ }
      }
    } else if (Array.isArray(current)) remaining.push(...current);
    else if (current && typeof current === "object") remaining.push(...Object.values(current));
  }
  return false;
}
async function inspect(tx: ConversationTransaction, id: string) {
  const [targetSize] = await tx.select({ bytes: sql<number>`octet_length(row_to_json(${s.runs})::text)` }).from(s.runs)
    .where(and(eq(s.runs.id, id), eq(s.runs.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (targetSize && targetSize.bytes > MAX_BYTES) throw new ConversationSizeError();
  const [row] = await tx.select().from(s.runs).where(and(eq(s.runs.id, id), eq(s.runs.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!row) return undefined;
  const reasons: RunDeletionBlock[] = [];
  if (!await schemaSupported(tx)) reasons.push("schema_changed");
  if (!terminal.has(row.status)) reasons.push("active_run");
  const [membership] = await tx.select().from(s.conversationRuns).innerJoin(s.conversations, eq(s.conversations.id, s.conversationRuns.conversationId))
    .where(and(eq(s.conversationRuns.runId, id), eq(s.conversationRuns.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!membership || row.branchIndexVersion !== 1) reasons.push("pending_index");
  else {
    projectRunBranch(row);
    if (membership.conversations.ownerId !== LOCAL_OWNER_ID || membership.conversation_runs.sourceRunId !== row.branchSourceRunId ||
      membership.conversation_runs.kind !== row.branchKind) reasons.push("owner_mismatch");
  }
  if (row.queueJobId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.queueJobId)) reasons.push("invalid_queue_job");
  const [limits] = await tx.execute<{ count: string; bytes: string }>(sql`
    select ((select count(*) from runs where owner_id=${LOCAL_OWNER_ID})+(select count(*) from conversation_private_branches where owner_id=${LOCAL_OWNER_ID}))::text as count,
      ((select coalesce(sum(octet_length(row_to_json(r)::text)),0) from runs r where owner_id=${LOCAL_OWNER_ID})+
       (select coalesce(sum(octet_length(body_ciphertext)),0) from conversation_private_branches where owner_id=${LOCAL_OWNER_ID}))::text as bytes`).then((value) => value.rows);
  const copies = new Set<string>(); const privateCopies = new Set<string>();
  if (Number(limits!.count) > MAX_ROWS || Number(limits!.bytes) > MAX_BYTES) reasons.push("inspection_limit");
  else {
    const peers = await tx.select().from(s.runs).where(eq(s.runs.ownerId, LOCAL_OWNER_ID)).orderBy(asc(s.runs.id));
    for (const peer of peers) {
      if (peer.id === id) continue;
      if (peer.branchIndexVersion !== 1) { reasons.push("pending_index"); continue; }
      projectRunBranch(peer);
      const value = mapStoredRun(peer);
      const extra = [peer.memoryContextCiphertext && decryptJson(peer.memoryContextCiphertext, `run:${peer.id}:memory-context`),
        peer.toolContextCiphertext && decryptJson(peer.toolContextCiphertext, `run:${peer.id}:tool-context`),
        peer.followUpCiphertext && decryptJson(peer.followUpCiphertext, `run:${peer.id}:follow-up`)];
      if (peer.branchSourceRunId === id || references(value, id) || references(extra, id)) copies.add(peer.id);
    }
    const privateRows = await tx.select().from(s.conversationPrivateBranches).where(eq(s.conversationPrivateBranches.ownerId, LOCAL_OWNER_ID));
    for (const peer of privateRows) if (peer.sourceRunId === id || references(decodePrivateBranchBody(peer), id)) privateCopies.add(peer.id);
  }
  if (copies.size || privateCopies.size) reasons.push("copied_content");
  const [publication] = await tx.select({ id: s.evidencePublications.id }).from(s.evidencePublications)
    .where(eq(s.evidencePublications.runId, id)).limit(1);
  // Independent approved copies/handoff packets need their own copy-aware erasure.
  if (publication) reasons.push("copied_content");
  // Catalog guard covers unknown cascading dependencies. Cross-run references in
  // known tables and foreign-owned rows must not be swept up by a valid FK graph.
  const foreign = await tx.execute(sql`select 1 where
    exists(select 1 from runs where owner_id<>${LOCAL_OWNER_ID} and branch_source_run_id=${id}::uuid) or
    exists(select 1 from conversation_private_branches where owner_id<>${LOCAL_OWNER_ID} and source_run_id=${id}::uuid) or
    exists(select 1 from conversation_runs where run_id=${id}::uuid and owner_id<>${LOCAL_OWNER_ID}) or
    exists(select 1 from memory_entries where source_run_id=${id}::uuid and owner_id<>${LOCAL_OWNER_ID}) or
    exists(select 1 from preflight_drafts where run_id=${id}::uuid and owner_id<>${LOCAL_OWNER_ID}) or
    exists(select 1 from local_schedules where last_run_id=${id}::uuid and owner_id<>${LOCAL_OWNER_ID}) or
    exists(select 1 from evidence_sources e join claims c on c.id=e.claim_id where (e.run_id=${id}::uuid or c.run_id=${id}::uuid) and (e.owner_id<>${LOCAL_OWNER_ID} or e.run_id<>c.run_id)) or
    exists(select 1 from research_captures r join claims c on c.id=r.claim_id left join evidence_sources e on e.id=r.evidence_source_id
      where (r.run_id=${id}::uuid or c.run_id=${id}::uuid or e.run_id=${id}::uuid) and (r.owner_id<>${LOCAL_OWNER_ID} or r.run_id<>c.run_id or (e.id is not null and r.run_id<>e.run_id))) or
    exists(select 1 from decision_assessments d join claims c on c.id=d.claim_id join evidence_sources e on e.id=d.source_id
      where (d.run_id=${id}::uuid or c.run_id=${id}::uuid or e.run_id=${id}::uuid) and (d.owner_id<>${LOCAL_OWNER_ID} or d.run_id<>c.run_id or d.run_id<>e.run_id)) or
    exists(select 1 from claim_occurrences o join claims c on c.id=o.claim_id join model_runs m on m.id=o.model_run_id
      where (c.run_id=${id}::uuid or m.run_id=${id}::uuid) and c.run_id<>m.run_id)`);
  if (foreign.rows.length) reasons.push("owner_mismatch");
  const assessments = await tx.select({ id: s.decisionAssessments.id, status: s.decisionAssessments.status }).from(s.decisionAssessments).where(eq(s.decisionAssessments.runId, id)).limit(1);
  // Decision execution has no equivalent session fence. Keep all such aggregates
  // outside this version instead of claiming a terminal row proves no active call.
  if (assessments.length) reasons.push("decision_boundary");
  const snapshot: Record<string, unknown[]> = {};
  let totalBytes = 0; let totalRows = 0;
  for (const table of contentTables) {
    const name = getTableName(table);
    const condition = name === "runs" ? sql`id=${id}::uuid` : name === "memory_entries" ? sql`source_run_id=${id}::uuid`
      : name === "claim_occurrences" ? sql`claim_id in (select id from claims where run_id=${id}::uuid) or model_run_id in (select id from model_runs where run_id=${id}::uuid)`
        : name === "decision_operations" ? sql`assessment_id in (select id from decision_assessments where run_id=${id}::uuid)` : sql`run_id=${id}::uuid`;
    const size = await tx.execute<{ count: string; bytes: string }>(sql`select count(*)::text as count, coalesce(sum(octet_length(row_to_json(t)::text)),0)::text as bytes from ${table} t where ${condition}`);
    totalRows += Number(size.rows[0]!.count); totalBytes += Number(size.rows[0]!.bytes);
    if (totalRows > 10_000 || totalBytes > MAX_BYTES) { reasons.push("inspection_limit"); break; }
    const data = await tx.execute<{ value: unknown }>(sql`select to_jsonb(t) as value from ${table} t where ${condition} order by to_jsonb(t)::text`);
    snapshot[name] = data.rows.map((item) => item.value);
  }
  const operations = reasons.includes("inspection_limit") ? [] : await tx.select().from(s.providerOperations).where(eq(s.providerOperations.runId, id)).orderBy(asc(s.providerOperations.id)).limit(501);
  if (operations.length > 500) reasons.push("inspection_limit");
  if (operations.some((item) => pending.has(item.status))) reasons.push("pending_operations");
  const preflight = await tx.select({ id: s.preflightDrafts.id }).from(s.preflightDrafts).where(eq(s.preflightDrafts.runId, id)).orderBy(asc(s.preflightDrafts.id)).limit(MAX_ROWS + 1);
  const schedules = await tx.select({ id: s.localSchedules.id }).from(s.localSchedules).where(eq(s.localSchedules.lastRunId, id)).orderBy(asc(s.localSchedules.id)).limit(MAX_ROWS + 1);
  const billing = await tx.select({ id: s.providerBillingRecords.id }).from(s.providerBillingRecords).where(eq(s.providerBillingRecords.runId, id)).orderBy(asc(s.providerBillingRecords.id)).limit(MAX_ROWS + 1);
  if (preflight.length > MAX_ROWS || schedules.length > MAX_ROWS || billing.length > MAX_ROWS) reasons.push("inspection_limit");
  const [auditCount] = await tx.select({ count: sql<string>`count(*)::text` }).from(s.runDeletions).where(eq(s.runDeletions.ownerId, LOCAL_OWNER_ID));
  if (Number(auditCount!.count) >= MAX_ROWS) reasons.push("audit_capacity");
  const blockedReasons = [...new Set(reasons)]; const eligible = !blockedReasons.length;
  const fingerprint = eligible ? hash(JSON.stringify({ version: "run-body-deletion-v1", owner: LOCAL_OWNER_ID, snapshot, membership, preflight, schedules, billing })) : null;
  const preview: RunDeletionPreview = { version: "run-body-deletion-v1", runId: id, conversationId: membership?.conversations.id ?? null,
    eligible, fingerprint, blockedReasons, copiedRunIds: [...copies].sort(), privateBranchIds: [...privateCopies].sort(),
    contentCounts: Object.fromEntries(Object.entries(snapshot).map(([name, values]) => [name, values.length])), receiptCount: operations.length,
    retainedPreflightCount: preflight.length, retainedScheduleCount: schedules.length, retainedBillingCount: billing.length };
  return { preview, row, operations };
}
export function previewRunDeletion(id: string) {
  return getDatabase().transaction(async (tx) => { await tx.execute(sql`set local statement_timeout='10s'`); return (await inspect(tx, id))?.preview;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export function deleteRunBody(id: string, fingerprint: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout='5s'`); await tx.execute(sql`set local statement_timeout='10s'`);
    await lockConversationMembership(tx);
    const key = createHash("sha256").update(`deliberation-ai-run:${id}`).digest().readBigInt64BE(0).toString();
    const lease = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(${key}::bigint) as acquired`);
    if (!lease.rows[0]?.acquired) throw new RunDeletionBlockedError();
    await tx.execute(sql`lock table ${sql.join(protectedTables.map((table) => sql`${table}`), sql`,`)} in share row exclusive mode`);
    const previous = await readAudit(tx, id);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new RunDeletionStaleError(); return previous; }
    const value = await inspect(tx, id); if (!value) return undefined;
    if (!value.preview.eligible) throw new RunDeletionBlockedError();
    if (value.preview.fingerprint !== fingerprint) throw new RunDeletionStaleError();
    const audit: RunDeletionAudit = runDeletionAuditSchema.parse({ version: "run-deletion-audit-v1", runId: id, conversationId: value.preview.conversationId,
      creationIntentHash: hash(value.row.idempotencyKey), fingerprint, deletedAt: new Date().toISOString(), status: value.row.status,
      receipts: value.operations.map((item) => ({ operationId: item.id, memberId: item.memberId, provider: item.provider, model: item.model,
        round: item.round, attempt: item.attempt, status: item.status, startedAt: item.startedAt.toISOString(), finishedAt: item.finishedAt?.toISOString() ?? null,
        inputTokens: item.inputTokens, outputTokens: item.outputTokens, priceSnapshotId: item.priceSnapshotId,
        tokenDetails: item.resultMetadataCiphertext ? readTokenDetails(decryptJson(item.resultMetadataCiphertext, `provider-operation:${item.id}:metadata`)) : null })) });
    if (Buffer.byteLength(JSON.stringify(audit)) > MAX_AUDIT_BYTES) throw new ConversationSizeError();
    await tx.insert(s.runDeletions).values({ id, ownerId: LOCAL_OWNER_ID, conversationId: audit.conversationId, intentKeyHash: audit.creationIntentHash,
      deletedAt: new Date(audit.deletedAt), auditCiphertext: encryptJson(audit, `run-deletion:${id}:audit`) });
    if (value.row.queueJobId) await tx.execute(sql`delete from pgboss.job where name=${RUN_COUNCIL_QUEUE} and id=${value.row.queueJobId}::uuid`);
    const removed = await tx.delete(s.runs).where(and(eq(s.runs.id, id), eq(s.runs.ownerId, LOCAL_OWNER_ID))).returning({ id: s.runs.id });
    if (removed.length !== 1) throw new RunDeletionStaleError();
    return audit;
  });
}
