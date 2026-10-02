import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { getPool, closeDatabase } from "./database";
import { openWorkerHeartbeat, readLocalDiagnostics } from "./local-diagnostics";

test("reports a worker heartbeat and an owner-scoped read-only backlog", async () => {
  const id = randomUUID();
  let heartbeat: Awaited<ReturnType<typeof openWorkerHeartbeat>> | undefined;
  try {
    heartbeat = await openWorkerHeartbeat(id);
    const result = await readLocalDiagnostics();
    expect(result.database).toBe("ready");
    expect(result.workerStatus).toBe("ready");
    expect(result.readyWorkers).toBeGreaterThanOrEqual(1);
    expect(result.queuedRuns).toBeGreaterThanOrEqual(0);
    expect(result.unresolvedProviderAttempts).toBeGreaterThanOrEqual(0);

    await heartbeat.close();
    const recorded = await getPool().query<{ stopped_at: Date | null }>(
      "SELECT stopped_at FROM public.worker_heartbeats WHERE id = $1::uuid",
      [id],
    );
    expect(recorded.rows[0]?.stopped_at).toBeInstanceOf(Date);

    // A restored archive can carry a recent heartbeat, but the old worker
    // session is absent from this database and must not count as ready.
    await getPool().query(
      "UPDATE public.worker_heartbeats SET stopped_at = NULL, heartbeat_at = now() WHERE id = $1::uuid",
      [id],
    );
    expect((await readLocalDiagnostics()).readyWorkers).toBe(result.readyWorkers - 1);
  } finally {
    await heartbeat?.close();
    await getPool().query("DELETE FROM public.worker_heartbeats WHERE id = $1::uuid", [id]);
    await closeDatabase();
  }
});
