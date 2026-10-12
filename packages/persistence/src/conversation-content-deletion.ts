import { createHash } from "node:crypto";
import { unresolvedProviderOperations } from "@deliberation-ai/domain";
import { and, asc, eq, inArray, sql, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getDatabase } from "./database";
import { getOwnerId } from "./owner";
import * as s from "./schema";
import { lockConversationMembership, type ConversationTransaction } from "./conversation-membership";
import { ConversationDeletionBlockedError, ConversationDeletionStaleError, supportsMetadataDeletion } from "./conversation-deletion";
import { applyRunDeletion, inspectRunDeletion, lockRunDeletion, lockRunDeletionTables, type RunDeletionBlock } from "./run-deletion";
import { applyPrivateBranchDeletion, inspectPrivateBranchDeletion, lockPrivateBranchDeletion, type PrivateBranchDeletionBlock } from "./private-branch-deletion";

const MAX_TARGETS = 100;
const knowledgeTables = [s.conversationKnowledge, s.conversationKnowledgeSelections, s.knowledgePreparations];
async function supportsKnowledgeDeletion(tx: ConversationTransaction) {
  const configs = knowledgeTables.map(getTableConfig), names = configs.map(config => config.name);
  const expectedColumns = configs.flatMap(config => config.columns.map(col => ({ table: config.name, column: col.name, type: col.getSQLType(), notNull: col.notNull })))
    .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
  const columns = await tx.execute(sql`select c.relname as "table", a.attname as "column", format_type(a.atttypid,a.atttypmod) as type, a.attnotnull as "notNull"
    from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relname in (${sql.join(names.map(name => sql`${name}`), sql`,`)})
    and a.attnum>0 and not a.attisdropped order by c.relname,a.attname`);
  if (JSON.stringify(columns.rows) !== JSON.stringify(expectedColumns)) return false;
  const expectedKeys = configs.flatMap(config => config.foreignKeys.map(key => {
    const ref = key.reference(); return { table: config.name, target: getTableName(ref.foreignTable), columns: ref.columns.map(col => col.name),
      targets: ref.foreignColumns.map(col => col.name), action: "a" };
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const keys = await tx.execute(sql`select c.relname as "table", f.relname as target,
    array(select a.attname::text from unnest(k.conkey) with ordinality u(num,ord) join pg_attribute a on a.attrelid=k.conrelid and a.attnum=u.num order by u.ord) as columns,
    array(select a.attname::text from unnest(k.confkey) with ordinality u(num,ord) join pg_attribute a on a.attrelid=k.confrelid and a.attnum=u.num order by u.ord) as targets,
    k.confdeltype::text as action from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_class f on f.oid=k.confrelid
    where k.contype='f' and (k.conrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname in (${sql.join(names.map(name => sql`${name}`), sql`,`)}))
    or k.confrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname in (${sql.join(names.map(name => sql`${name}`), sql`,`)})))`);
  if (JSON.stringify(keys.rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) !== JSON.stringify(expectedKeys)) return false;
  const triggers = await tx.execute<{ table: string; name: string; type: number; body: string; language: string; enabled: string }>(sql`
    select c.relname as "table", t.tgname as name, t.tgtype::int as type, p.prosrc as body, l.lanname as language, t.tgenabled::text as enabled
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid join pg_language l on l.oid=p.prolang
    where not t.tgisinternal and c.relnamespace='public'::regnamespace and c.relname in (${sql.join(names.map(name => sql`${name}`), sql`,`)})`);
  const normalize = (body: string) => body.replace(/\s+/g, " ").trim();
  return triggers.rows.length === 1 && triggers.rows.every(trigger => trigger.table === "knowledge_preparations" &&
    trigger.name === "knowledge_preparations_immutable" && trigger.type === 19 && trigger.language === "plpgsql" && trigger.enabled === "O" &&
    normalize(trigger.body) === normalize("BEGIN RAISE EXCEPTION 'Knowledge preparations are immutable'; END;"));
}
export type ConversationContentDeletionBlock = RunDeletionBlock | PrivateBranchDeletionBlock | "retained_references" | "too_many_members";
export type ConversationContentDeletionPreview = {
  version: "conversation-content-deletion-v1"; conversationId: string; eligible: boolean; fingerprint: string | null;
  runIds: string[]; privateBranchIds: string[]; membershipCount: number; knowledgeRecordCount: number;
  contentCounts: Record<string, number>; receiptCount: number; retainedInputCount: number; retainedBillingCount: number;
  dependencies: { kind: "run" | "private" | "conversation" | "publication"; id: string }[];
  blockedReasons: ConversationContentDeletionBlock[];
  pendingOperations: { id: string; runId: string; memberId: string; model: string; status: string; errorCode: string | null; canDiscard: boolean }[];
  activeRuns: { id: string; status: string }[];
};

async function inspect(tx: ConversationTransaction, id: string) {
  const owner = getOwnerId();
  const [conversation] = await tx.select({ id: s.conversations.id, ownerId: s.conversations.ownerId, anchorRunId: s.conversations.anchorRunId,
    origin: s.conversations.origin, createdAt: sql<string>`${s.conversations.createdAt}::text` }).from(s.conversations)
    .where(and(eq(s.conversations.id, id), eq(s.conversations.ownerId, owner))).limit(1);
  if (!conversation) return undefined;
  const reasons = new Set<ConversationContentDeletionBlock>();
  if (!await supportsMetadataDeletion(tx) || !await supportsKnowledgeDeletion(tx)) reasons.add("schema_changed");
  const members = await tx.select({ runId: s.conversationRuns.runId, ownerId: s.conversationRuns.ownerId, conversationId: s.conversationRuns.conversationId,
    sourceRunId: s.conversationRuns.sourceRunId, kind: s.conversationRuns.kind, createdAt: sql<string>`${s.conversationRuns.createdAt}::text` }).from(s.conversationRuns)
    .where(eq(s.conversationRuns.conversationId, id)).orderBy(asc(s.conversationRuns.runId)).limit(MAX_TARGETS + 1);
  const branches = await tx.select({ id: s.conversationPrivateBranches.id, ownerId: s.conversationPrivateBranches.ownerId,
    createdAt: sql<string>`${s.conversationPrivateBranches.createdAt}::text`, updatedAt: sql<string>`${s.conversationPrivateBranches.updatedAt}::text` })
    .from(s.conversationPrivateBranches).where(eq(s.conversationPrivateBranches.conversationId, id)).orderBy(asc(s.conversationPrivateBranches.id)).limit(MAX_TARGETS + 1);
  if (members.length + branches.length > MAX_TARGETS) reasons.add("too_many_members");
  if ([...members, ...branches].some((row) => row.ownerId !== owner)) reasons.add("owner_mismatch");
  if (reasons.has("too_many_members") || reasons.has("owner_mismatch")) return { preview: emptyPreview(), runValues: [], branchValues: [] };
  const runIds = members.map((row) => row.runId), branchIds = branches.map((row) => row.id);
  const scope = { runIds: new Set(runIds), privateBranchIds: new Set(branchIds), retainCopies: true };
  const references = new Set([conversation.anchorRunId, ...runIds]);
  const links = await tx.select({ id: s.conversationRuns.conversationId }).from(s.conversationRuns)
    .innerJoin(s.conversations, eq(s.conversations.id, s.conversationRuns.conversationId)).where(and(
    sql`(${s.conversationRuns.ownerId} <> ${owner} or ${s.conversations.ownerId} <> ${owner})`,
    sql`${s.conversationRuns.conversationId} <> ${id}::uuid`,
    sql`(${inArray(s.conversationRuns.runId, [...references])} or ${inArray(s.conversationRuns.sourceRunId, [...references])})`)).limit(1);
  if (links.length) reasons.add("owner_mismatch");
  // Foreign rows are never returned as dependencies or accepted as targets.
  const foreign = await tx.execute(sql`select 1 where
    exists(select 1 from runs where ${inArray(s.runs.id, runIds)} and owner_id<>${owner}) or
    exists(select 1 from conversation_runs where conversation_id=${id}::uuid and owner_id<>${owner}) or
    exists(select 1 from conversation_knowledge where conversation_id=${id}::uuid and owner_id<>${owner}) or
    exists(select 1 from conversation_knowledge_selections where conversation_id=${id}::uuid and owner_id<>${owner}) or
    exists(select 1 from knowledge_preparations where conversation_id=${id}::uuid and owner_id<>${owner})`);
  if (foreign.rows.length) reasons.add("owner_mismatch");
  const ownedLinks = await tx.select({ id: s.conversationRuns.conversationId }).from(s.conversationRuns)
    .innerJoin(s.conversations, eq(s.conversations.id, s.conversationRuns.conversationId)).where(and(eq(s.conversationRuns.ownerId, owner), eq(s.conversations.ownerId, owner),
    sql`${s.conversationRuns.conversationId} <> ${id}::uuid`,
    sql`(${inArray(s.conversationRuns.runId, [...references])} or ${inArray(s.conversationRuns.sourceRunId, [...references])})`)).limit(MAX_TARGETS + 1);
  const dependencies: ConversationContentDeletionPreview["dependencies"] = [...new Set(ownedLinks.map(row => row.id))].map(value => ({ kind: "conversation", id: value }));
  const sourceBranches = await tx.select({ id: s.conversationPrivateBranches.id, ownerId: s.conversationPrivateBranches.ownerId }).from(s.conversationPrivateBranches)
    .where(and(sql`${s.conversationPrivateBranches.conversationId} <> ${id}::uuid`, inArray(s.conversationPrivateBranches.sourceRunId, [...references]))).limit(MAX_TARGETS + 1);
  if (sourceBranches.some(row => row.ownerId !== owner)) reasons.add("owner_mismatch");
  dependencies.push(...sourceBranches.filter(row => row.ownerId === owner).map(row => ({ kind: "private" as const, id: row.id })));
  if (ownedLinks.length > MAX_TARGETS || sourceBranches.length > MAX_TARGETS) reasons.add("inspection_limit");
  const runValues: NonNullable<Awaited<ReturnType<typeof inspectRunDeletion>>>[] = [];
  const branchValues: NonNullable<Awaited<ReturnType<typeof inspectPrivateBranchDeletion>>>[] = [];
  const contentCounts: Record<string, number> = {};
  let receiptCount = 0, retainedInputCount = 0, retainedBillingCount = 0, inspectedBytes = 0;
  for (const runId of runIds) {
    const value = await inspectRunDeletion(tx, runId, scope);
    if (!value) continue; // Previously erased bodies still have memberships.
    runValues.push(value);
    for (const reason of value.preview.blockedReasons) reasons.add(reason);
    for (const [name, count] of Object.entries(value.preview.contentCounts)) contentCounts[name] = (contentCounts[name] ?? 0) + count;
    receiptCount += value.preview.receiptCount;
    retainedInputCount += value.preview.retainedPreflightCount + value.preview.retainedScheduleCount;
    retainedBillingCount += value.preview.retainedBillingCount;
    inspectedBytes += value.inspectedBytes;
    dependencies.push(...value.preview.copiedRunIds.map(value => ({ kind: "run" as const, id: value })),
      ...value.preview.privateBranchIds.map(value => ({ kind: "private" as const, id: value })));
    const publications = await tx.select({ id: s.evidencePublications.id }).from(s.evidencePublications)
      .where(and(eq(s.evidencePublications.runId, runId), eq(s.evidencePublications.ownerId, owner))).limit(MAX_TARGETS + 1);
    dependencies.push(...publications.map(row => ({ kind: "publication" as const, id: row.id })));
    if (inspectedBytes > 64 * 1024 * 1024 || Object.values(contentCounts).reduce((sum, count) => sum + count, 0) > 10_000) {
      reasons.add("inspection_limit"); break;
    }
  }
  for (const branchId of branchIds) {
    const value = await inspectPrivateBranchDeletion(tx, branchId, { deletingBranchIds: scope.privateBranchIds, retainCopies: true });
    if (!value) { reasons.add("owner_mismatch"); continue; }
    branchValues.push(value);
    for (const reason of value.preview.blockedReasons) reasons.add(reason);
    receiptCount += value.preview.ownReceiptCount;
    dependencies.push(...value.preview.copiedBranchIds.map(value => ({ kind: "private" as const, id: value })));
  }
  const [auditCounts] = (await tx.execute<{ runs: number; branches: number }>(sql`select
    (select count(*)::int from run_deletions where owner_id=${owner}) as runs,
    (select count(*)::int from private_branch_deletions where owner_id=${owner} and conversation_id=${id}::uuid) as branches`)).rows;
  if (auditCounts!.runs + runValues.length > 1_000 || auditCounts!.branches + branchValues.length > 1_000) reasons.add("audit_capacity");
  // These are conversation-local bindings/packets, never library source bodies.
  const knowledge: { table: string; digests: string[] }[] = [];
  let knowledgeRecordCount = 0, knowledgeBytes = 0;
  for (const table of knowledgeTables) {
    const [size] = (await tx.execute<{ count: string; bytes: string }>(sql`select count(*)::text as count,
      coalesce(sum(octet_length(to_jsonb(t)::text)),0)::text as bytes from ${table} t where conversation_id=${id}::uuid and owner_id=${owner}`)).rows;
    knowledgeRecordCount += Number(size!.count); knowledgeBytes += Number(size!.bytes);
    if (knowledgeRecordCount > 1_000 || knowledgeBytes > 32 * 1024 * 1024) { reasons.add("inspection_limit"); break; }
    const digests = await tx.execute<{ digest: string }>(sql`select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as digest
      from ${table} t where conversation_id=${id}::uuid and owner_id=${owner} order by to_jsonb(t)::text`);
    knowledge.push({ table: getTableName(table), digests: digests.rows.map(row => row.digest) });
  }
  const retainedDependencies = [...new Map(dependencies.map(item => [`${item.kind}:${item.id}`, item])).values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  if (retainedDependencies.length > MAX_TARGETS) reasons.add("inspection_limit");
  const eligible = reasons.size === 0;
  const fingerprint = eligible ? createHash("sha256").update(JSON.stringify({ version: "conversation-content-deletion-v1", owner, conversation, members,
    runs: runValues.map(value => value.preview.fingerprint), branches: branchValues.map(value => ({ fingerprint: value.preview.fingerprint,
      timestamps: branches.find(row => row.id === value.current.row.id) })), knowledge, dependencies: retainedDependencies })).digest("hex") : null;
  const preview: ConversationContentDeletionPreview = { version: "conversation-content-deletion-v1", conversationId: id, eligible, fingerprint,
    runIds: runValues.map(value => value.row.id), privateBranchIds: branchIds, membershipCount: members.length, knowledgeRecordCount,
    contentCounts, receiptCount, retainedInputCount, retainedBillingCount,
    dependencies: retainedDependencies.slice(0, MAX_TARGETS), blockedReasons: [...reasons],
    pendingOperations: runValues.flatMap(value => unresolvedProviderOperations(value.operations).map(operation => ({
      id: operation.id, runId: operation.runId, memberId: operation.memberId, model: operation.model, status: operation.status, errorCode: operation.errorCode,
      canDiscard: ["completed", "partially_completed", "failed", "cancelled"].includes(value.row.status) && ["outcome_unknown", "submitted", "retry_authorized"].includes(operation.status),
    }))).slice(0, MAX_TARGETS), activeRuns: runValues.filter(value => ["queued", "running"].includes(value.row.status)).map(value => ({ id: value.row.id, status: value.row.status })) };
  return { preview, runValues, branchValues };

  function emptyPreview(): ConversationContentDeletionPreview {
    return { version: "conversation-content-deletion-v1", conversationId: id, eligible: false, fingerprint: null, runIds: [], privateBranchIds: [],
      membershipCount: members.length, knowledgeRecordCount: 0, contentCounts: {}, receiptCount: 0, retainedInputCount: 0, retainedBillingCount: 0,
      dependencies: [], blockedReasons: [...reasons], pendingOperations: [], activeRuns: [] };
  }
}

export function previewConversationContentDeletion(id: string) {
  return getDatabase().transaction(async tx => {
    await tx.execute(sql`set local statement_timeout='10s'`);
    return (await inspect(tx, id))?.preview;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export function deleteConversationContent(id: string, fingerprint: string) {
  return getDatabase().transaction(async tx => {
    await tx.execute(sql`set local lock_timeout='5s'`); await tx.execute(sql`set local statement_timeout='10s'`);
    await lockConversationMembership(tx);
    // Same table order as standalone run deletion, avoiding cross-owner inversions.
    await lockRunDeletionTables(tx);
    // Freeze membership before deriving the exact owned lease/target set. Try-lock
    // execution leases, never wait on a worker that needs this owner's lock.
    await tx.execute(sql`lock table public.conversations, public.conversation_runs, public.conversation_private_branches in share row exclusive mode`);
    const ids = await tx.select({ id: s.conversationRuns.runId }).from(s.conversationRuns).where(and(eq(s.conversationRuns.conversationId, id), eq(s.conversationRuns.ownerId, getOwnerId()))).orderBy(asc(s.conversationRuns.runId)).limit(MAX_TARGETS + 1);
    const branches = await tx.select({ id: s.conversationPrivateBranches.id }).from(s.conversationPrivateBranches).where(and(eq(s.conversationPrivateBranches.conversationId, id), eq(s.conversationPrivateBranches.ownerId, getOwnerId()))).orderBy(asc(s.conversationPrivateBranches.id)).limit(MAX_TARGETS + 1);
    if (ids.length + branches.length > MAX_TARGETS) throw new ConversationDeletionBlockedError();
    for (const value of ids) await lockRunDeletion(tx, value.id);
    for (const value of branches) await lockPrivateBranchDeletion(tx, value.id);
    await tx.execute(sql`lock table public.runs, public.conversation_private_branches, public.run_deletions, public.private_branch_deletions,
      public.conversation_knowledge, public.conversation_knowledge_selections, public.knowledge_preparations in share row exclusive mode`);
    await tx.execute(sql`lock table public.evidence_publications in share mode`);
    const value = await inspect(tx, id);
    if (!value) return undefined;
    if (!value.preview.eligible) throw new ConversationDeletionBlockedError();
    if (value.preview.fingerprint !== fingerprint) throw new ConversationDeletionStaleError();
    for (const branch of value.branchValues) await applyPrivateBranchDeletion(tx, branch, branch.preview.fingerprint!);
    for (const run of value.runValues) await applyRunDeletion(tx, run, run.preview.fingerprint!);
    for (const table of [s.conversationKnowledgeSelections, s.conversationKnowledge, s.knowledgePreparations]) {
      await tx.delete(table).where(and(eq(table.conversationId, id), eq(table.ownerId, getOwnerId())));
    }
    await tx.delete(s.conversationRuns).where(and(eq(s.conversationRuns.conversationId, id), eq(s.conversationRuns.ownerId, getOwnerId())));
    await tx.delete(s.conversations).where(and(eq(s.conversations.id, id), eq(s.conversations.ownerId, getOwnerId())));
    return { deleted: true as const, conversationId: id, deletedRunIds: value.preview.runIds, deletedPrivateBranchIds: value.preview.privateBranchIds };
  });
}
