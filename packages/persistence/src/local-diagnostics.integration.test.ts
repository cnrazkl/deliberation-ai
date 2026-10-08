import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { getPool, closeDatabase } from "./database";
import { openWorkerHeartbeat, readLocalDiagnostics } from "./local-diagnostics";
import { LOCAL_OWNER_ID } from "./owner";
import { listProviderOperationsNeedingAction, resolveProviderOperation, ProviderOperationResolutionError } from "./provider-operations";

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

test("terminal submitted receipts remain visible and need an explicit operator decision; active and foreign work is excluded", async () => {
  const pool = getPool(), terminal = randomUUID(), active = randomUUID(), foreign = randomUUID();
  const terminalOperation = randomUUID(), activeOperation = randomUUID(), foreignOperation = randomUUID();
  try {
    const before = (await readLocalDiagnostics()).unresolvedProviderAttempts;
    for (const [id, status, owner] of [[terminal, "partially_completed", LOCAL_OWNER_ID], [active, "running", LOCAL_OWNER_ID], [foreign, "failed", "foreign-fixture"]])
      await pool.query("INSERT INTO runs(id,owner_id,idempotency_key,request_hash,question,status,snapshot_id) VALUES($1::uuid,$2,$1::text,'offline','Offline orphan receipt fixture',$3,$1::uuid)", [id, owner, status]);
    for (const [id, runId] of [[terminalOperation, terminal], [activeOperation, active], [foreignOperation, foreign]])
      await pool.query("INSERT INTO provider_operations(id,run_id,member_id,provider,model,status,request_fingerprint,reserved_output_tokens) VALUES($1,$2,'fixture','offline','offline','submitted','offline',128)", [id, runId]);
    expect((await readLocalDiagnostics()).unresolvedProviderAttempts).toBe(before + 1);
    const rows = await listProviderOperationsNeedingAction();
    expect(rows.some((row) => row.id === terminalOperation && row.status === "submitted")).toBe(true);
    expect(rows.some((row) => new Set<string>([activeOperation, foreignOperation]).has(row.id))).toBe(false);
    expect((await pool.query("SELECT status FROM provider_operations WHERE id=$1", [terminalOperation])).rows[0]?.status).toBe("submitted");
    await expect(resolveProviderOperation(activeOperation, "discard")).rejects.toBeInstanceOf(ProviderOperationResolutionError);
    expect(await resolveProviderOperation(foreignOperation, "discard")).toBeUndefined();
    expect((await resolveProviderOperation(terminalOperation, "discard"))?.operation.status).toBe("discarded");
    expect((await pool.query("SELECT reserved_output_tokens FROM provider_operations WHERE id=$1", [terminalOperation])).rows[0]?.reserved_output_tokens).toBe(128);
    expect((await readLocalDiagnostics()).unresolvedProviderAttempts).toBe(before);
  } finally { await pool.query("DELETE FROM runs WHERE id=ANY($1::uuid[])", [[terminal, active, foreign]]); await closeDatabase(); }
});
