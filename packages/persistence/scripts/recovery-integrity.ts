import { createHash } from "node:crypto";
import type { Client } from "pg";
import { inspectAdditionalRecovery } from "./backup-recovery-inventory";
import { decodePrivateBranchDeletion } from "../src/private-branch-deletion";
import { readProviderObservations } from "../src/provider-observations";
import { PRIVATE_DELIVERY_QUEUE } from "../src/queue";
import type { providerConnections } from "../src/schema";
import { decodePrivateBranchBody } from "../src/private-branches";

export type RecoverySnapshot = { version: "local-recovery-snapshot-v1"; tables: Record<string, { rows: number; sha256: string }>; fingerprint: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const pending = ["prepared", "submitted", "outcome_unknown", "retry_authorized"];

// Whole retained records, including ciphertext and deletion/grant/receipt state.
// Only worker leases are excluded. No row values escape this function.
export async function snapshotRecoveryDatabase(client: Client): Promise<RecoverySnapshot> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL TimeZone='UTC'");
    await client.query("SET LOCAL DateStyle='ISO, YMD'");
    const names = await client.query<{ schema: string; name: string }>(`SELECT n.nspname AS schema,c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle','pgboss')
      AND c.relkind IN ('r','p') AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid)
      AND NOT (n.nspname='public' AND c.relname='worker_heartbeats') ORDER BY 1,2`);
    if (!names.rows.length || names.rows.length > 128) throw new Error();
    const tables: RecoverySnapshot["tables"] = {}; let bytes = 0;
    for (const { schema, name } of names.rows) {
      if (!/^[a-z_][a-z0-9_]*$/u.test(schema) || !/^[a-z_][a-z0-9_]*$/u.test(name)) throw new Error();
      const hash = createHash("sha256"); let rows = 0;
      const relation = `${schema}.${name}`;
      const columns = await client.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,
        pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [relation]);
      hash.update(JSON.stringify(columns.rows));
      // PostgreSQL's pretty deparser canonicalizes harmless nested AND groups
      // flattened by dump/restore, without dropping constraint semantics.
      const metadata = await client.query(`SELECT 'constraint' AS kind,conname AS name,pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE conrelid=$1::regclass
        UNION ALL SELECT 'index',c.relname,pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=$1::regclass
        UNION ALL SELECT 'trigger',tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal
        UNION ALL SELECT 'policy',polname,to_jsonb(p.*)::text FROM (SELECT polname,polcmd,polpermissive,pg_get_expr(polqual,polrelid) AS qual,pg_get_expr(polwithcheck,polrelid) AS check_expr FROM pg_policy WHERE polrelid=$1::regclass) p
        UNION ALL SELECT 'relation',relname,json_build_object('rls',relrowsecurity,'forceRls',relforcerowsecurity,'partition',pg_get_partkeydef(oid))::text FROM pg_class WHERE oid=$1::regclass ORDER BY 1,2,3`, [relation]);
      hash.update(JSON.stringify(metadata.rows.sort((a, b) => { const left = JSON.stringify(a), right = JSON.stringify(b); return left < right ? -1 : left > right ? 1 : 0; })));
      await client.query(`DECLARE recovery_rows NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS value FROM "${schema}"."${name}" t ORDER BY to_jsonb(t)::text`);
      try {
        for (;;) {
          const page = await client.query<{ value: string }>("FETCH 128 FROM recovery_rows");
          for (const row of page.rows) {
            bytes += Buffer.byteLength(row.value); rows++;
            if (rows > 100_000 || bytes > 256 * 1024 * 1024) throw new Error();
            hash.update(row.value).update("\n");
          }
          if (page.rows.length < 128) break;
        }
      } finally { await client.query("CLOSE recovery_rows"); }
      tables[`${schema}.${name}`] = { rows, sha256: hash.digest("hex") };
    }
    await client.query("COMMIT");
    return { version: "local-recovery-snapshot-v1", tables, fingerprint: digest(JSON.stringify(tables)) };
  } catch { await client.query("ROLLBACK"); throw new Error("Recovery snapshot could not be verified."); }
}

export function changedRecoveryTables(source: RecoverySnapshot, restored: RecoverySnapshot, applicationOnly = false): string[] {
  return [...new Set([...Object.keys(source.tables), ...Object.keys(restored.tables)])].sort()
    .filter((name) => !applicationOnly || !name.startsWith("pgboss."))
    .filter((name) => JSON.stringify(source.tables[name]) !== JSON.stringify(restored.tables[name]));
}
export function requireMatchingRecovery(source: RecoverySnapshot, restored: RecoverySnapshot, applicationOnly = false): void {
  if (changedRecoveryTables(source, restored, applicationOnly).length) throw new Error("Recovery data changed; reconciliation is required before switching.");
}

export async function inspectRecoveryWork(client: Client) {
  const additional = await inspectAdditionalRecovery(client);
  const count = async (sql: string, args: unknown[] = []) => Number((await client.query<{ count: string }>(sql, args)).rows[0]!.count);
  const result = {
    councilPending: await count("SELECT count(*)::text FROM runs WHERE status IN ('queued','running')"),
    councilUnsettled: await count(`SELECT count(*)::text FROM provider_operations o JOIN runs r ON r.id=o.run_id WHERE o.status=ANY($1::text[])
      AND NOT (o.status IN ('prepared','retry_authorized') AND o.submitted_at IS NULL AND r.status IN ('completed','partially_completed','failed','cancelled'))`, [pending]),
    councilHistoricalUnsubmitted: await count(`SELECT count(*)::text FROM provider_operations o JOIN runs r ON r.id=o.run_id
      WHERE o.status IN ('prepared','retry_authorized') AND o.submitted_at IS NULL AND r.status IN ('completed','partially_completed','failed','cancelled')`),
    decisionPending: Object.entries(additional.decisionAssessmentStatuses ?? {}).filter(([status]) => ["queued", "running", "outcome_unknown"].includes(status)).reduce((n, [, total]) => n + total, 0),
    decisionUnsettled: Object.entries(additional.decisionOperationStatuses ?? {}).filter(([status]) => pending.includes(status)).reduce((n, [, total]) => n + total, 0),
    privatePending: Object.entries(additional.privateBranches?.ownDeliveryStatuses ?? {}).filter(([status]) => pending.includes(status)).reduce((n, [, total]) => n + total, 0),
    privateUnknown: additional.privateBranches?.ownDeliveryStatuses.outcome_unknown ?? 0,
    privateCopies: Object.values(additional.privateBranches?.copiedDeliveryStatuses ?? {}).reduce((n, total) => n + total, 0),
    privateDeletionReceipts: 0, privateJobsWithDeletedReceipt: 0, privateJobsWithLiveReceipt: 0, privateJobsTargetingCopy: 0, privateJobsWithoutReceipt: 0, privateCopyOriginMissing: 0,
    probePending: 0, probeUnknown: 0,
    activeSchedules: await count("SELECT count(*)::text FROM local_schedules WHERE status='active'"),
  };
  const audits = await client.query<Parameters<typeof decodePrivateBranchDeletion>[0]>(`SELECT id,conversation_id AS "conversationId",request_id AS "requestId",audit_ciphertext AS "auditCiphertext",deleted_at AS "deletedAt" FROM private_branch_deletions LIMIT 1001`);
  if (audits.rows.length > 1000) throw new Error("Recovery receipt inspection limit reached.");
  const deleted = new Set<string>();
  for (const row of audits.rows) for (const receipt of decodePrivateBranchDeletion(row).receipts) {
    result.privateDeletionReceipts++;
    if (receipt.originBranchId === row.id) deleted.add(`${row.id}:${receipt.operationId}`);
  }
  const branches = (await client.query<Parameters<typeof decodePrivateBranchBody>[0]>(`SELECT id,conversation_id AS "conversationId",source_run_id AS "sourceRunId",source_member_id AS "sourceMemberId",parent_branch_id AS "parentBranchId",revision,message_count AS "messageCount",body_ciphertext AS "bodyCiphertext" FROM conversation_private_branches LIMIT 1001`)).rows;
  if (branches.length > 1000 || branches.reduce((sum, row) => sum + Buffer.byteLength(row.bodyCiphertext), 0) > 32 * 1024 * 1024) throw new Error("Recovery private inspection limit reached.");
  const own = new Set<string>(), copied = new Set<string>(), copyOrigins: string[] = [];
  for (const row of branches) for (const receipt of decodePrivateBranchBody(row).deliveries ?? []) {
    if (receipt.originBranchId === row.id) own.add(`${row.id}:${receipt.id}`);
    else { copied.add(`${row.id}:${receipt.id}`); copyOrigins.push(`${receipt.originBranchId}:${receipt.id}`); }
  }
  result.privateCopyOriginMissing = copyOrigins.filter((origin) => !own.has(origin) && !deleted.has(origin)).length;
  const jobs = await client.query<{ branch: string | null; operation: string | null }>("SELECT data->>'branchId' AS branch,data->>'operationId' AS operation FROM pgboss.job WHERE name=$1 LIMIT 10001", [PRIVATE_DELIVERY_QUEUE]);
  if (jobs.rows.length > 10000) throw new Error("Recovery queue inspection limit reached.");
  for (const job of jobs.rows) {
    const key = `${job.branch}:${job.operation}`;
    if (own.has(key)) result.privateJobsWithLiveReceipt++;
    else if (deleted.has(key)) result.privateJobsWithDeletedReceipt++;
    else if (copied.has(key)) result.privateJobsTargetingCopy++;
    else result.privateJobsWithoutReceipt++;
  }
  const connections = await client.query<typeof providerConnections.$inferSelect>(`SELECT id,revision,provider,endpoint_preset AS "endpointPreset",catalog_snapshot_ciphertext AS "catalogSnapshotCiphertext" FROM provider_connections LIMIT 1001`);
  if (connections.rows.length > 1000) throw new Error("Recovery connection inspection limit reached.");
  for (const row of connections.rows) for (const check of readProviderObservations(row).generationChecks) {
    if (["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt) {
      result.probePending++; if (check.status === "outcome_unknown") result.probeUnknown++;
    }
  }
  return result;
}
export type RecoveryWork = Awaited<ReturnType<typeof inspectRecoveryWork>>;
export function requireQuiescentRecovery(work: RecoveryWork): void {
  if (work.councilPending || work.councilUnsettled || work.decisionPending || work.decisionUnsettled || work.privatePending || work.probePending || work.activeSchedules) {
    throw new Error("Recovery requires stopped work, reviewed uncertain outcomes and paused schedules.");
  }
}

// Explicitly park restored queue work only. Original archive/rows remain available;
// application receipts stay unchanged and no pending operation is represented as success.
export async function parkRestoredQueue(client: Client, acknowledge: boolean): Promise<number> {
  if (!acknowledge) throw new Error("Explicit queue parking acknowledgement required.");
  requireQuiescentRecovery(await inspectRecoveryWork(client));
  await client.query("BEGIN");
  try {
    await client.query("LOCK TABLE pgboss.job IN SHARE ROW EXCLUSIVE MODE");
    const result = await client.query("UPDATE pgboss.job SET state='cancelled' WHERE state IN ('created','retry','active')");
    await client.query("COMMIT"); return result.rowCount ?? 0;
  } catch { await client.query("ROLLBACK"); throw new Error("Restored queue parking failed."); }
}
