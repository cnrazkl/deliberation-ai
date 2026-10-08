import { getPool } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { readOperationalDiagnostics } from "./operational-diagnostics";

const HEARTBEAT_FRESH_SECONDS = 45;

export type WorkerStatus = "ready" | "stale" | "stopped" | "never_seen";

export function classifyWorkerStatus(
  readyWorkers: number,
  latestHeartbeatAt: Date | null,
  latestStoppedAt: Date | null,
): WorkerStatus {
  if (readyWorkers > 0) return "ready";
  if (!latestHeartbeatAt) return "never_seen";
  return latestStoppedAt ? "stopped" : "stale";
}

export interface WorkerHeartbeatLease {
  beat(): Promise<void>;
  close(): Promise<void>;
}

export async function openWorkerHeartbeat(instanceId: string): Promise<WorkerHeartbeatLease> {
  const client = await getPool().connect();
  const beat = async (): Promise<void> => {
    await client.query(
      `INSERT INTO public.worker_heartbeats (id, started_at, heartbeat_at)
       VALUES ($1::uuid, now(), now())
       ON CONFLICT (id) DO UPDATE SET heartbeat_at = now(), stopped_at = NULL`,
      [instanceId],
    );
  };
  try {
    // Keep this session open for the worker lifetime. A restored old heartbeat
    // cannot look live without a matching session in this database instance.
    await client.query("SELECT set_config('application_name', $1, false)", [`deliberation-ai-worker:${instanceId}`]);
    await beat();
  } catch (error) {
    client.release(true);
    throw error;
  }
  let closed = false;
  return {
    beat,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await client.query("UPDATE public.worker_heartbeats SET stopped_at = now() WHERE id = $1::uuid", [instanceId]);
      } finally {
        // Destroy rather than return this specially named session to the pool.
        client.release(true);
      }
    },
  };
}

export interface LocalDiagnostics {
  checkedAt: string;
  database: "ready";
  workerStatus: WorkerStatus;
  readyWorkers: number;
  latestHeartbeatAt: string | null;
  queuedRuns: number;
  runningRuns: number;
  unresolvedProviderAttempts: number;
  activeSchedules: number;
  operational: Awaited<ReturnType<typeof readOperationalDiagnostics>>;
}

export async function readLocalDiagnostics(): Promise<LocalDiagnostics> {
  const result = await getPool().query<{
    checked_at: Date;
    ready_workers: number;
    latest_heartbeat_at: Date | null;
    latest_stopped_at: Date | null;
    queued_runs: number;
    running_runs: number;
    unresolved_provider_attempts: number;
    active_schedules: number;
  }>(
    `SELECT now() AS checked_at,
      (SELECT count(*)::int FROM public.worker_heartbeats w
       WHERE w.stopped_at IS NULL AND w.heartbeat_at > now() - interval '${HEARTBEAT_FRESH_SECONDS} seconds'
       AND EXISTS (SELECT 1 FROM pg_stat_activity a
         WHERE a.datname = current_database()
           AND a.application_name = 'deliberation-ai-worker:' || w.id::text)) AS ready_workers,
      (SELECT heartbeat_at FROM public.worker_heartbeats ORDER BY heartbeat_at DESC LIMIT 1) AS latest_heartbeat_at,
      (SELECT stopped_at FROM public.worker_heartbeats ORDER BY heartbeat_at DESC LIMIT 1) AS latest_stopped_at,
      (SELECT count(*)::int FROM public.runs WHERE owner_id = $1 AND status = 'queued') AS queued_runs,
      (SELECT count(*)::int FROM public.runs WHERE owner_id = $1 AND status = 'running') AS running_runs,
      (SELECT count(*)::int FROM public.provider_operations po
       JOIN public.runs r ON r.id = po.run_id
       WHERE r.owner_id = $1 AND (po.status = 'outcome_unknown' OR
         (po.status = 'submitted' AND r.status IN ('completed','partially_completed','failed','cancelled')))) AS unresolved_provider_attempts,
      (SELECT count(*)::int FROM public.local_schedules WHERE owner_id = $1 AND status = 'active') AS active_schedules`,
    [LOCAL_OWNER_ID],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Local diagnostics could not be read.");
  return {
    checkedAt: row.checked_at.toISOString(),
    database: "ready",
    workerStatus: classifyWorkerStatus(row.ready_workers, row.latest_heartbeat_at, row.latest_stopped_at),
    readyWorkers: row.ready_workers,
    latestHeartbeatAt: row.latest_heartbeat_at?.toISOString() ?? null,
    queuedRuns: row.queued_runs,
    runningRuns: row.running_runs,
    unresolvedProviderAttempts: row.unresolved_provider_attempts,
    activeSchedules: row.active_schedules,
    operational: await readOperationalDiagnostics(),
  };
}
