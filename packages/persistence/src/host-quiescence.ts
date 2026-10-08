import { getPool } from "./database";
import { decodePrivateBranchBody } from "./private-branches";
import { readProviderObservations } from "./provider-observations";
import type { providerConnections } from "./schema";

// Host administration only. No user-supplied owner or HTTP route uses this read.
// Terminal unknown council receipts remain unresolved; maintenance never authorizes a resend.
export async function readHostQuiescence() {
  const pool = getPool();
  const totals = (await pool.query<{ activeRuns: number; activeDecisions: number; activeSchedules: number; activeJobs: number }>(`SELECT
    (SELECT count(*)::int FROM runs WHERE status IN ('queued','running')) AS "activeRuns",
    (SELECT count(*)::int FROM decision_assessments WHERE status IN ('queued','running')) AS "activeDecisions",
    (SELECT count(*)::int FROM local_schedules WHERE status='active' AND deleted_at IS NULL) AS "activeSchedules",
    (SELECT count(*)::int FROM pgboss.job WHERE state='active') AS "activeJobs"`)).rows[0]!;
  const privateRows = (await pool.query<Parameters<typeof decodePrivateBranchBody>[0]>(`SELECT id,conversation_id AS "conversationId",source_run_id AS "sourceRunId",source_member_id AS "sourceMemberId",parent_branch_id AS "parentBranchId",revision,message_count AS "messageCount",body_ciphertext AS "bodyCiphertext" FROM conversation_private_branches LIMIT 4097`)).rows;
  const connections = (await pool.query<typeof providerConnections.$inferSelect>(`SELECT id,revision,provider,endpoint_preset AS "endpointPreset",catalog_snapshot_ciphertext AS "catalogSnapshotCiphertext" FROM provider_connections LIMIT 4097`)).rows;
  if (privateRows.length > 4096 || connections.length > 4096 || privateRows.reduce((n, r) => n + Buffer.byteLength(r.bodyCiphertext), 0) > 32 * 1024 * 1024)
    throw new Error("Host quiescence inspection capacity exceeded.");
  let activePrivate = 0, pendingProbes = 0;
  for (const row of privateRows) for (const receipt of decodePrivateBranchBody(row).deliveries ?? [])
    if (receipt.originBranchId === row.id && ["prepared", "submitted"].includes(receipt.status)) activePrivate++;
  for (const row of connections) for (const check of readProviderObservations(row).generationChecks)
    if (["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt) pendingProbes++;
  return { ...totals, activePrivate, pendingProbes };
}
export function hostIsQuiescent(value: Awaited<ReturnType<typeof readHostQuiescence>>): boolean {
  return Object.values(value).every(n => Number.isInteger(n) && n === 0);
}
