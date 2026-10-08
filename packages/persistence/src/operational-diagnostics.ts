import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getPool } from "./database";
import { getOwnerId } from "./owner";
import { decodePrivateBranchBody, type PrivateBranchView } from "./private-branches";
import { readProviderObservations } from "./provider-observations";
import type { providerConnections } from "./schema";

export async function backupHealth(root = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "DeliberationAI/backups") : null) {
  if (!root) return { state: "unavailable" as const, count: 0, bytes: 0, latestAt: null as string | null };
  try {
    const names = (await readdir(root)).filter((name) => /^deliberation-\d{8}T\d{6}Z-[a-f0-9]{12}\.manifest\.json$/u.test(name));
    if (names.length > 1000) throw new Error();
    let bytes = 0, count = 0, latestAt: string | null = null;
    for (const name of names) {
      const path = join(root, name), info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error();
      const value = JSON.parse(await readFile(path, "utf8")) as { format?: string; createdAt?: string; archiveFile?: string; bytes?: number; sha256?: string };
      if (value.format !== "deliberation-postgres-backup-v1" || !value.createdAt || !Number.isFinite(Date.parse(value.createdAt)) || Date.parse(value.createdAt) > Date.now() + 60_000
        || !value.archiveFile || !/^deliberation-\d{8}T\d{6}Z-[a-f0-9]{12}\.dump$/u.test(value.archiveFile) || !Number.isSafeInteger(value.bytes) || value.bytes! < 1 || !/^[a-f0-9]{64}$/u.test(value.sha256 ?? "")) throw new Error();
      const archive = await lstat(join(root, value.archiveFile)); if (!archive.isFile() || archive.isSymbolicLink() || archive.size !== value.bytes) throw new Error();
      count++; bytes += archive.size;
      if (!Number.isSafeInteger(bytes)) throw new Error();
      if (!latestAt || Date.parse(value.createdAt) > Date.parse(latestAt)) latestAt = value.createdAt;
    }
    return { state: "metadata_only" as const, count, bytes, latestAt };
  } catch (error) {
    return { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" as const : "unavailable" as const, count: 0, bytes: 0, latestAt: null };
  }
}

export async function readOperationalDiagnostics() {
  const started = performance.now(), pool = getPool();
  const totals = (await pool.query<{ decision_pending: number; decision_unknown: number; queue_exists: boolean }>(`SELECT
    (SELECT count(*)::int FROM decision_assessments WHERE owner_id=$1 AND status IN ('queued','running')) AS decision_pending,
    (SELECT count(*)::int FROM decision_operations o JOIN decision_assessments a ON a.id=o.assessment_id WHERE a.owner_id=$1 AND o.status IN ('submitted','outcome_unknown')) AS decision_unknown,
    to_regclass('pgboss.job') IS NOT NULL AS queue_exists`, [getOwnerId()])).rows[0]!;
  const queue = totals.queue_exists ? { state: "ready" as const, ...(await pool.query<{ pending: number; active: number; oldestDueSeconds: number | null }>(`SELECT
    count(*) FILTER(WHERE state IN ('created','retry','active'))::int AS pending,
    count(*) FILTER(WHERE state='active')::int AS active,
    extract(epoch FROM now()-min(start_after) FILTER(WHERE state IN ('created','retry') AND start_after<=now()))::int AS "oldestDueSeconds"
    FROM pgboss.job`)).rows[0]! } : { state: "unavailable" as const, pending: null, active: null, oldestDueSeconds: null };
  const rows = (await pool.query<Parameters<typeof decodePrivateBranchBody>[0]>(`SELECT id,conversation_id AS "conversationId",source_run_id AS "sourceRunId",source_member_id AS "sourceMemberId",parent_branch_id AS "parentBranchId",revision,message_count AS "messageCount",body_ciphertext AS "bodyCiphertext" FROM conversation_private_branches WHERE owner_id=$1 LIMIT 257`, [getOwnerId()])).rows;
  if (rows.length > 256 || rows.reduce((size, row) => size + Buffer.byteLength(row.bodyCiphertext), 0) > 32 * 1024 * 1024) throw new Error("Operational inspection limit reached.");
  let privatePending = 0, privateUnknown = 0, privateCopied = 0, probePending = 0, probeUnknown = 0;
  for (const row of rows) {
    const body: PrivateBranchView["body"] = decodePrivateBranchBody(row);
    for (const receipt of body.deliveries ?? []) {
      if (receipt.originBranchId !== row.id) { privateCopied++; continue; }
      if (["prepared", "submitted", "outcome_unknown"].includes(receipt.status)) privatePending++;
      if (receipt.status === "outcome_unknown") privateUnknown++;
    }
  }
  const connections = (await pool.query<typeof providerConnections.$inferSelect>(`SELECT id,revision,provider,endpoint_preset AS "endpointPreset",catalog_snapshot_ciphertext AS "catalogSnapshotCiphertext" FROM provider_connections WHERE owner_id=$1 LIMIT 257`, [getOwnerId()])).rows;
  if (connections.length > 256) throw new Error("Operational inspection limit reached.");
  for (const row of connections) for (const check of readProviderObservations(row).generationChecks) if (["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt) {
    probePending++; if (check.status === "outcome_unknown") probeUnknown++;
  }
  return { recoveryHold: process.env.DELIBERATION_RECOVERY_HOLD === "true", runtimeIdentity: process.env.DELIBERATION_RUNTIME_IDENTITY ?? null,
    decisionEnabled: process.env.ENABLE_DECISION_EVALUATOR === "true", privatePending, privateUnknown, privateCopied, probePending, probeUnknown,
    decisionPending: totals.decision_pending, decisionUnknown: totals.decision_unknown,
    unsettled: privatePending + probePending + totals.decision_pending + totals.decision_unknown,
    queue,
    backup: await backupHealth(), queryMs: Math.round(performance.now() - started) };
}
