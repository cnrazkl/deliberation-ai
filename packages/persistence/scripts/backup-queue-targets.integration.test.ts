import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";
import { closeBoss, getBoss, PRIVATE_DELIVERY_QUEUE, RUN_COUNCIL_QUEUE, RUN_DECISION_ASSESSMENT_QUEUE } from "../src/queue";
import { inspectRestoredQueueTargets } from "./backup-queue-targets";

test("reconciles real partitioned jobs against metadata without changing jobs or reading private bodies", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/da_it_[a-f0-9]{16}$/u.test(url.pathname)) throw new Error("Disposable database required.");
  await getBoss(); await closeBoss();
  const client = new Client({ connectionString: url.toString() }); await client.connect();
  try {
    await client.query("BEGIN");
    const baseline = await inspectRestoredQueueTargets(client);
    const linked = randomUUID(), different = randomUUID(), unrecorded = randomUUID(), linkedJob = randomUUID();
    for (const [id, queueId, status] of [[linked, linkedJob, "completed"], [different, randomUUID(), "running"], [unrecorded, null, "queued"]]) {
      await client.query(`INSERT INTO public.runs (id, owner_id, idempotency_key, request_hash, question, snapshot_id, queue_job_id, status)
        VALUES ($1::uuid, 'queue-target-fixture', $1::text, 'fixture', 'SENSITIVE SYNTHETIC QUESTION', $1::uuid, $2, $3)`, [id, queueId, status]);
    }
    const conversation = randomUUID(), branch = randomUUID();
    await client.query("INSERT INTO public.conversations (id, owner_id, anchor_run_id, origin) VALUES ($1, 'queue-target-fixture', $2, 'native')", [conversation, linked]);
    await client.query(`INSERT INTO public.conversation_private_branches
      (id, owner_id, conversation_id, source_run_id, source_member_id, request_id, request_hash, revision, message_count, body_ciphertext)
      VALUES ($1, 'queue-target-fixture', $2, $3, 'fixture', $1, 'fixture', 1, 0, 'UNREADABLE SENSITIVE BODY')`, [branch, conversation, linked]);
    const add = async (queue: string, data: unknown, id = randomUUID()) => client.query(
      "INSERT INTO pgboss.job (id, name, state, data, output) VALUES ($1, $2, 'created', $3::jsonb, $4::jsonb)",
      [id, queue, JSON.stringify(data), JSON.stringify({ text: "SENSITIVE SYNTHETIC OUTPUT" })]);
    await add(RUN_COUNCIL_QUEUE, { runId: linked.toUpperCase(), ignored: "SENSITIVE" }, linkedJob);
    await add(RUN_COUNCIL_QUEUE, { runId: different });
    await add(RUN_COUNCIL_QUEUE, { runId: unrecorded });
    await add(RUN_COUNCIL_QUEUE, { runId: randomUUID() });
    for (const data of [null, [], { runId: 3 }, { runId: "invalid uuid SENSITIVE" }, { runId: { value: linked } }]) await add(RUN_COUNCIL_QUEUE, data);
    await add(RUN_DECISION_ASSESSMENT_QUEUE, { assessmentId: randomUUID() });
    await add(PRIVATE_DELIVERY_QUEUE, { branchId: branch, operationId: randomUUID() });
    await add(PRIVATE_DELIVERY_QUEUE, { branchId: randomUUID(), operationId: randomUUID() });
    await add(PRIVATE_DELIVERY_QUEUE, { branchId: branch });
    const snapshot = async () => (await client.query(`SELECT id, name, state, start_after, started_on, completed_on,
      md5(data::text) AS data_hash, md5(output::text) AS output_hash FROM pgboss.job ORDER BY name, id`)).rows;
    const before = await snapshot();
    const result = await inspectRestoredQueueTargets(client);
    for (const [relation, added] of [["linked_job", 1], ["different_job", 1], ["unrecorded_job", 1], ["missing_target", 1], ["malformed_payload", 5]] as const) {
      expect(result.council.created.relations[relation]).toBe(baseline.council.created.relations[relation] + added);
    }
    expect(result.council.created.targetStatuses.completed).toBe((baseline.council.created.targetStatuses.completed ?? 0) + 1);
    expect(result.decision.created.relations.missing_target).toBe(baseline.decision.created.relations.missing_target + 1);
    expect(result.private.created.relations.branch_present_receipt_unchecked).toBe(baseline.private.created.relations.branch_present_receipt_unchecked + 1);
    expect(result.private.created.relations.missing_target).toBe(baseline.private.created.relations.missing_target + 1);
    expect(result.private.created.relations.malformed_payload).toBe(baseline.private.created.relations.malformed_payload + 1);
    expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|UNREADABLE|queue-target-fixture/u);
    expect(await snapshot()).toEqual(before);
    const validTotal = (entry: typeof result.council.created) => Object.entries(entry.relations)
      .filter(([relation]) => relation !== "malformed_payload").reduce((sum, [, count]) => sum + count, 0);
    await client.query("ALTER TABLE public.decision_assessments RENAME TO fixture_hidden_assessments");
    expect((await inspectRestoredQueueTargets(client)).decision.created.relations.schema_unavailable).toBe(validTotal(result.decision.created));
    await client.query("ALTER TABLE public.conversation_private_branches RENAME TO fixture_hidden_branches");
    expect((await inspectRestoredQueueTargets(client)).private.created.relations.schema_unavailable).toBe(validTotal(result.private.created));
    await client.query("ALTER TABLE public.runs RENAME TO fixture_hidden_runs");
    expect((await inspectRestoredQueueTargets(client)).council.created.relations.schema_unavailable).toBe(validTotal(result.council.created));
    await client.query("ALTER TABLE pgboss.job RENAME TO fixture_hidden_job");
    await expect(inspectRestoredQueueTargets(client)).rejects.toThrow(/^Restored queue target inventory could not be verified\.$/u);
  } finally {
    await client.query("ROLLBACK"); await client.end();
  }
});
