import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";
import { encryptJson, encryptText } from "../src/crypto";
import { auditRestoredEncryption } from "./backup-encryption-audit";
import { buildCompactedContinuation, freezeContinuation, prepareContinuationCompaction } from "@deliberation-ai/application";

test("audits a populated private compaction archive with its authenticated context", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const id = randomUUID();
  const sourceId = randomUUID();
  const packet = prepareContinuationCompaction({ sourceRunId: sourceId, sourceRiskProfile: "standard", content: JSON.stringify({
    sourceRunId: sourceId, question: "Which original details were omitted?", status: "completed", promptVersion: "council-v1", promptFingerprint: "a".repeat(64), report: { rawText: "Synthetic private minority" }, continuationContext: null,
  }) });
  const { context, archive } = buildCompactedContinuation(packet, { version: "manual-continuation-compaction-v1", summary: "Reviewed synthetic summary with an explicit alternative.", reviewed: true });
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO public.runs
      (id, owner_id, idempotency_key, request_hash, question, snapshot_id, continuation_context_ciphertext, continuation_archive_ciphertext)
      VALUES ($1, $2, $5, 'offline-compact-archive', '[encrypted]', $1, $3, $4)`,
    [id, `backup-audit-${id}`, encryptJson(context, `run:${id}:continuation-context`), encryptJson(archive, `run:${id}:continuation-archive`), id]);
    expect((await auditRestoredEncryption(client)).decryptedValues).toBeGreaterThan(0);
    await client.query("UPDATE public.runs SET continuation_archive_ciphertext = $1 WHERE id = $2", [encryptJson(archive, "incorrect-context"), id]);
    await expect(auditRestoredEncryption(client)).rejects.toThrow("runs.continuation_archive_ciphertext");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("audits populated continuation snapshots and rejects a substituted encryption context", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const id = randomUUID();
  const context = freezeContinuation({ sourceRunId: randomUUID(), sourceRiskProfile: "standard", content: "Complete offline historical report" });
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO public.runs
      (id, owner_id, idempotency_key, request_hash, question, snapshot_id, continuation_context_ciphertext)
      VALUES ($1, $2, $4, 'offline-continuation-fixture', '[encrypted]', $1, $3)`,
    [id, `backup-audit-${id}`, encryptJson(context, `run:${id}:continuation-context`), id]);
    expect((await auditRestoredEncryption(client)).decryptedValues).toBeGreaterThan(0);
    await client.query("UPDATE public.runs SET continuation_context_ciphertext = $1 WHERE id = $2", [encryptJson(context, "wrong-context"), id]);
    await expect(auditRestoredEncryption(client)).rejects.toThrow("runs.continuation_context_ciphertext");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("audits every encrypted row and rejects a later unreadable connection without persisting fixture data", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const id = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO public.provider_connections
       (id, owner_id, provider, label, default_model, secret_ciphertext)
       VALUES ($1, $2, 'openai-compatible', $3, 'fixture-model', $4)`,
      [id, `backup-audit-${id}`, `backup-audit-${id}`, encryptText("", `provider-connection:${id}:secret`)],
    );
    const healthy = await auditRestoredEncryption(client);
    expect(healthy.decryptedValues).toBeGreaterThan(0);
    expect(healthy.populatedTables).toBeGreaterThan(0);

    await client.query("UPDATE public.provider_connections SET secret_ciphertext = $1 WHERE id = $2", ["invalid-envelope", id]);
    await expect(auditRestoredEncryption(client)).rejects.toThrow(/provider_connections\.secret_ciphertext/u);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("audits populated run and schedule execution limits with their authenticated contexts", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const id = randomUUID();
  const limits = { version: "dispatch-limits-v1", maxProviderCalls: 2, maxOutputTokensPerCall: 128, maxReservedOutputTokens: 256 };
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO public.runs
      (id, owner_id, idempotency_key, request_hash, question, snapshot_id, execution_limits_ciphertext)
      VALUES ($1, $2, $4, 'offline-backup-fixture', '[encrypted]', $1, $3)`,
    [id, `backup-audit-${id}`, encryptJson(limits, `run:${id}:execution-limits`), id]);
    await client.query(`INSERT INTO public.local_schedules
      (id, owner_id, name_ciphertext, question_ciphertext, members_ciphertext, provider_mode, cadence, next_run_at, execution_limits_ciphertext)
      VALUES ($1, $2, $3, $4, $5, 'fake', 'daily', now(), $6)`,
    [id, `backup-audit-${id}`, encryptText("Offline fixture", `local-schedule:${id}:name`),
      encryptText("Offline question", `local-schedule:${id}:question`), encryptJson([], `local-schedule:${id}:members`),
      encryptJson(limits, `local-schedule:${id}:execution-limits`)]);
    const baseline = await auditRestoredEncryption(client);
    for (const table of ["runs", "local_schedules"] as const) {
      await client.query(`UPDATE public.${table} SET execution_limits_ciphertext = $1 WHERE id = $2`,
        [encryptJson(limits, "incorrect-context"), id]);
      await expect(auditRestoredEncryption(client)).rejects.toThrow(`${table}.execution_limits_ciphertext`);
      const prefix = table === "runs" ? "run" : "local-schedule";
      await client.query(`UPDATE public.${table} SET execution_limits_ciphertext = $1 WHERE id = $2`,
        [encryptJson(limits, `${prefix}:${id}:execution-limits`), id]);
    }
    expect(await auditRestoredEncryption(client)).toEqual(baseline);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
