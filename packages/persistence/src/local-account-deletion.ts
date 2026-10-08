import { createHash } from "node:crypto";
import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import { localAccountDeletionSchema, type LocalAccountDeletionPreview } from "@deliberation-ai/contracts";
import { getPool } from "./database";
import { LocalAuthError, readLocalSession, throttleLocalAccountDeletion } from "./local-auth";
import { ownerLeaseKey } from "./owner-lifecycle";
import { verifyLocalPassword } from "./local-password";
import { decodePrivateBranchBody } from "./private-branches";
import { readProviderObservations } from "./provider-observations";
import * as s from "./schema";

// Deliberate complete closure. Unknown schema/relationships fail closed rather than
// silently retaining content or deleting another account through a new cascade.
const tables: PgTable[] = [s.localUsers, s.localSessions, s.localLoginAttempts, s.conversations,
  s.conversationRuns, s.conversationPrivateBranches, s.privateBranchDeletions, s.runDeletions,
  s.runs, s.preflightDrafts, s.mcpConnections, s.mcpToolResults, s.localSchedules, s.modelRuns,
  s.claims, s.claimOccurrences, s.memoryEntries, s.evidenceSources, s.researchCaptures,
  s.providerConnections, s.decisionConnections, s.decisionAssessments, s.decisionOperations,
  s.councilTemplates, s.providerBillingRecords, s.providerBillingChanges, s.providerBillingClaims,
  s.providerBillingReallocations, s.billingStatementVersions, s.providerPriceSnapshots,
  s.providerOperations, s.workerHeartbeats, s.knowledgeCollections, s.knowledgeGrants,
  s.conversationKnowledge, s.conversationKnowledgeSelections, s.knowledgePreparations,
  s.knowledgeSources, s.evidencePublications, s.knowledgeSourceVersions, s.runEvents];
const configs = tables.map(getTableConfig);
const byName = new Map(configs.map(c => [c.name, c]));
const auth = new Set(["local_users", "local_sessions", "local_login_attempts", "worker_heartbeats"]);
const content = configs.filter(c => !auth.has(c.name));
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const ownedRuns = "SELECT id FROM runs WHERE owner_id=$1";
const derived: Record<string, string> = {
  model_runs: `t.run_id IN (${ownedRuns})`, claims: `t.run_id IN (${ownedRuns})`,
  run_events: `t.run_id IN (${ownedRuns})`, provider_operations: `t.run_id IN (${ownedRuns})`,
  claim_occurrences: `t.claim_id IN (SELECT id FROM claims WHERE run_id IN (${ownedRuns}))`,
  decision_operations: "t.assessment_id IN (SELECT id FROM decision_assessments WHERE owner_id=$1)",
};
function predicate(name: string, alias = "t") {
  const config = byName.get(name)!;
  const value = config.columns.some(c => c.name === "owner_id") ? "t.owner_id=$1" : derived[name];
  if (!value) throw new LocalAuthError("Hesap veri kapsamı doğrulanamadı.", 409);
  return value.replaceAll("t.", `${alias}.`);
}
const jobPredicate = `(t.data->>'runId' IN (${ownedRuns}) OR
  t.data->>'assessmentId' IN (SELECT id::text FROM decision_assessments WHERE owner_id=$1) OR
  t.data->>'branchId' IN (SELECT id::text FROM conversation_private_branches WHERE owner_id=$1))`;
// runId is JSON text, so cast owned run UUIDs to text in the queue predicate.
const jobs = jobPredicate.replace(ownedRuns, "SELECT id::text FROM runs WHERE owner_id=$1 UNION SELECT id::text FROM run_deletions WHERE owner_id=$1")
  .replace("SELECT id::text FROM conversation_private_branches WHERE owner_id=$1", "SELECT id::text FROM conversation_private_branches WHERE owner_id=$1 UNION SELECT id::text FROM private_branch_deletions WHERE owner_id=$1");

async function schemaCheck(client: PoolClient) {
  const names = configs.map(c => c.name).sort();
  const actual = (await client.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(actual)) throw new LocalAuthError("Veri yapısı değişti; hesap silme incelemesi gerekiyor.", 409);
  const expectedColumns = configs.flatMap(c => c.columns.map(col => `${c.name}.${col.name}`)).sort();
  const actualColumns = (await client.query<{ name: string }>("SELECT table_name||'.'||column_name AS name FROM information_schema.columns WHERE table_schema='public' ORDER BY 1")).rows.map(r => r.name).sort();
  if (JSON.stringify(expectedColumns) !== JSON.stringify(actualColumns)) throw new LocalAuthError("Veri yapısı değişti; hesap silme incelemesi gerekiyor.", 409);
  const actions = { "no action": "a", restrict: "r", cascade: "c", "set null": "n", "set default": "d" } as const;
  const expected = configs.flatMap(c => c.foreignKeys.map(k => {
    const ref = k.reference();
    return `${c.name}:${ref.columns.map(col => col.name).join(",")}:${getTableName(ref.foreignTable)}:${ref.foreignColumns.map(col => col.name).join(",")}:${actions[k.onDelete ?? "no action"]}`;
  })).sort();
  const keys = (await client.query<{ signature: string }>(`SELECT c.relname||':'||
    array_to_string(ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.num ORDER BY u.ord),',')||':'||
    f.relname||':'||array_to_string(ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=u.num ORDER BY u.ord),',')||':'||k.confdeltype::text AS signature
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class f ON f.oid=k.confrelid
    WHERE k.contype='f' AND (c.relnamespace='public'::regnamespace OR f.relnamespace='public'::regnamespace) ORDER BY 1`)).rows.map(r => r.signature).sort();
  if (JSON.stringify(expected) !== JSON.stringify(keys)) throw new LocalAuthError("Veri ilişkileri değişti; hesap silme incelemesi gerekiyor.", 409);
  // Approved immutable triggers run only on insert/update, never deletion.
  if ((await client.query("SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal AND (t.tgtype & 8)<>0")).rowCount)
    throw new LocalAuthError("Silme tetikleyicisi bulundu; hesap silme incelemesi gerekiyor.", 409);
}
async function inspect(client: PoolClient, user: NonNullable<Awaited<ReturnType<typeof readLocalSession>>>["user"]) {
  const owner = user.ownerId;
  await schemaCheck(client);
  // Lock the reviewed complete closure, including queue partitions, for the short
  // inspection/apply transaction. Lease fencing separately covers in-flight network work.
  await client.query(`LOCK TABLE ${configs.map(c => `public.${quote(c.name)}`).sort().join(",")}, pgboss.job IN SHARE ROW EXCLUSIVE MODE`);
  await schemaCheck(client);
  const account = (await client.query<{ digest: string }>("SELECT md5(to_jsonb(t)::text) AS digest FROM local_users t WHERE id=$1 AND owner_id=$2 AND role='user'", [user.id, owner])).rows[0];
  if (!account) throw new LocalAuthError("Hesap değişti. Yeniden inceleyin.", 409);
  if ((await client.query("SELECT 1 FROM local_sessions t JOIN local_users u ON u.id=t.user_id WHERE t.scope_user_id=$1 AND t.user_id<>$1 AND u.role<>'root' LIMIT 1", [user.id])).rowCount)
    throw new LocalAuthError("Başka hesaba bağlı oturum bulundu; silme engellendi.", 409);
  const counts: Record<string, number> = {}, digests: Record<string, string> = {};
  let bytes = 0, recordCount = 0;
  for (const config of content) {
    const table = quote(config.name), where = predicate(config.name);
    const row = (await client.query<{ count: string; bytes: string }>(`SELECT count(*) AS count, coalesce(sum(octet_length(to_jsonb(t)::text)),0) AS bytes FROM ${table} t WHERE ${where}`, [owner])).rows[0]!;
    counts[config.name] = Number(row.count); bytes += Number(row.bytes); recordCount += Number(row.count);
    if (recordCount > 100_000 || bytes > 64 * 1024 * 1024) throw new LocalAuthError("Hesap çok büyük; yerel yönetici incelemesi gerekiyor.", 409);
    digests[config.name] = (await client.query<{ digest: string }>(`SELECT md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS digest FROM (SELECT md5(to_jsonb(t)::text) AS h FROM ${table} t WHERE ${where}) x`, [owner])).rows[0]!.digest;
  }
  for (const child of content) for (const key of child.foreignKeys) {
    const ref = key.reference(), parentName = getTableName(ref.foreignTable);
    if (!content.some(c => c.name === parentName)) continue;
    const join = ref.columns.map((col, i) => `c.${quote(col.name)}=p.${quote(ref.foreignColumns[i]!.name)}`).join(" AND ");
    if ((await client.query(`SELECT 1 FROM ${quote(child.name)} c JOIN ${quote(parentName)} p ON ${join} WHERE ${predicate(parentName, "p")} AND NOT (${predicate(child.name, "c")}) LIMIT 1`, [owner])).rowCount)
      throw new LocalAuthError("Başka hesaba bağlı kayıt bulundu; silme engellendi.", 409);
  }
  const blockers: string[] = [];
  if ((await client.query("SELECT 1 FROM runs WHERE owner_id=$1 AND status IN ('queued','running') LIMIT 1", [owner])).rowCount) blockers.push("Devam eden veya sırada bekleyen sohbet var. Önce iptal edip tamamlanmasını bekleyin.");
  if ((await client.query("SELECT 1 FROM decision_assessments WHERE owner_id=$1 AND status IN ('queued','running') LIMIT 1", [owner])).rowCount) blockers.push("Devam eden karar değerlendirmesi var.");
  if ((await client.query(`SELECT 1 FROM pgboss.job t WHERE ${jobs} AND state='active' LIMIT 1`, [owner])).rowCount) blockers.push("Çalışan arka plan işi var.");
  const privateRows = (await client.query<Parameters<typeof decodePrivateBranchBody>[0]>(`SELECT id,conversation_id AS "conversationId",source_run_id AS "sourceRunId",source_member_id AS "sourceMemberId",parent_branch_id AS "parentBranchId",revision,message_count AS "messageCount",body_ciphertext AS "bodyCiphertext" FROM conversation_private_branches WHERE owner_id=$1`, [owner])).rows;
  if (privateRows.some(row => (decodePrivateBranchBody(row).deliveries ?? []).some(r => r.originBranchId === row.id && ["prepared","submitted"].includes(r.status)))) blockers.push("Devam eden özel mesaj gönderimi var.");
  const connectionRows = (await client.query<typeof s.providerConnections.$inferSelect>(`SELECT id,revision,provider,endpoint_preset AS "endpointPreset",catalog_snapshot_ciphertext AS "catalogSnapshotCiphertext" FROM provider_connections WHERE owner_id=$1`, [owner])).rows;
  if (connectionRows.some(row => readProviderObservations(row).generationChecks.some(r => ["submitted","outcome_unknown"].includes(r.status) && !r.acknowledgedAt))) blockers.push("Sonucu belirsiz bağlantı testi var; önce bağlantı testini inceleyin.");
  const queueSize = (await client.query<{ count: string; bytes: string }>(`SELECT count(*) AS count,coalesce(sum(octet_length(to_jsonb(t)::text)),0) AS bytes FROM pgboss.job t WHERE ${jobs}`, [owner])).rows[0]!;
  if (recordCount + Number(queueSize.count) > 100_000 || bytes + Number(queueSize.bytes) > 64 * 1024 * 1024)
    throw new LocalAuthError("Hesap çok büyük; yerel yönetici incelemesi gerekiyor.", 409);
  const queue = (await client.query<{ count: string; digest: string }>(`SELECT count(*) AS count,md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS digest FROM (SELECT md5(to_jsonb(t)::text) AS h FROM pgboss.job t WHERE ${jobs}) x`, [owner])).rows[0]!;
  const fingerprint = hash(JSON.stringify({ user, accountDigest: account.digest, counts, digests, queue }));
  return { user, eligible: blockers.length === 0, fingerprint, recordCount,
    connectionCount: counts.provider_connections! + counts.mcp_connections! + counts.decision_connections!, runCount: counts.runs!, blockers } satisfies LocalAccountDeletionPreview;
}
async function target(token: string, userId?: string) {
  const session = await readLocalSession(token);
  if (!session) throw new LocalAuthError("Oturum açmanız gerekiyor.", 401);
  if (userId && session.user.role !== "root") throw new LocalAuthError("Root yetkisi gerekiyor.", 403);
  const id = userId ?? session.user.id;
  const [user] = (await getPool().query<typeof s.localUsers.$inferSelect>('SELECT id,owner_id AS "ownerId",username,display_name AS "displayName",role,password_hash AS "passwordHash",created_at AS "createdAt" FROM local_users WHERE id=$1', [id])).rows;
  if (!user) throw new LocalAuthError("Kullanıcı bulunamadı.", 404);
  if (user.role === "root") throw new LocalAuthError("Root hesabı silinemez.", 403);
  return { session, user, summary: { id: user.id, ownerId: user.ownerId, username: user.username, displayName: user.displayName, role: "user" as const, createdAt: user.createdAt.toISOString() } };
}
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='3s'"); await client.query("SET LOCAL statement_timeout='15s'");
    const result = await work(client); await client.query("COMMIT"); return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof LocalAuthError) throw error;
    throw new LocalAuthError("Hesap şu anda silinemiyor. İşlemlerin tamamlanmasını bekleyip yeniden inceleyin.", 409);
  } finally { client.release(); }
}
export async function previewLocalAccountDeletion(token: string, userId?: string) {
  const item = await target(token, userId);
  return transaction(client => inspect(client, item.summary));
}
export async function deleteLocalAccount(token: string, value: unknown, userId?: string) {
  const parsed = localAccountDeletionSchema.safeParse(value);
  if (!parsed.success) throw new LocalAuthError("Silme onayı geçersiz.");
  const item = await target(token, userId);
  await throttleLocalAccountDeletion(item.session.user.id);
  const actor = (await getPool().query<{ passwordHash: string }>('SELECT password_hash AS "passwordHash" FROM local_users WHERE id=$1', [item.session.user.id])).rows[0];
  if (!actor || !await verifyLocalPassword(parsed.data.currentPassword, actor.passwordHash)) throw new LocalAuthError("Mevcut parola geçersiz.", 401);
  if (parsed.data.username !== item.user.username) throw new LocalAuthError("Silinecek kullanıcı adını doğru yazın.");
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [ownerLeaseKey(item.user.ownerId)]);
    const preview = await inspect(client, item.summary);
    const current = (await client.query<{ password_hash: string }>("SELECT password_hash FROM local_users WHERE id=$1", [item.session.user.id])).rows[0];
    const live = await readLocalSession(token);
    if (!live || !current || current.password_hash !== actor.passwordHash || live.user.id !== item.session.user.id)
      throw new LocalAuthError("Hesap veya oturum değişti. Yeniden giriş yapın.", 409);
    const [targetRow] = (await client.query<{ username: string; password_hash: string }>("SELECT username,password_hash FROM local_users WHERE id=$1", [item.user.id])).rows;
    if (!preview.eligible || preview.fingerprint !== parsed.data.fingerprint || targetRow?.username !== item.user.username || targetRow.password_hash !== item.user.passwordHash)
      throw new LocalAuthError("Silme kapsamı değişti veya aktif iş var. Yeniden inceleyin.", 409);
    await client.query(`DELETE FROM pgboss.job t WHERE ${jobs}`, [item.user.ownerId]);
    // Children precede parents; constraints remain enabled throughout the transaction.
    const pending = new Set(content.map(c => c.name));
    while (pending.size) {
      const leaves = [...pending].filter(name => !content.some(c => pending.has(c.name) && c.foreignKeys.some(k => getTableName(k.reference().foreignTable) === name)));
      if (!leaves.length) throw new LocalAuthError("Veri ilişkileri silmeye uygun değil.", 409);
      for (const name of leaves) { await client.query(`DELETE FROM ${quote(name)} t WHERE ${predicate(name)}`, [item.user.ownerId]); pending.delete(name); }
    }
    await client.query("UPDATE local_sessions SET scope_user_id=user_id WHERE scope_user_id=$1 AND user_id IN (SELECT id FROM local_users WHERE role='root')", [item.user.id]);
    const attempts = [`login:${item.user.username}`, `password:${item.user.id}`, `delete:${item.user.id}`].map(id => hash(`local-auth:${id}`));
    await client.query("DELETE FROM local_login_attempts WHERE identity_hash=ANY($1::text[])", [attempts]);
    await client.query("DELETE FROM local_users WHERE id=$1 AND role='user'", [item.user.id]);
    return { deleted: true };
  });
}
