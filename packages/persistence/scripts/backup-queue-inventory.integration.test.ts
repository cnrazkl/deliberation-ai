import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";
import { closeBoss, getBoss, PRIVATE_DELIVERY_QUEUE, RUN_COUNCIL_QUEUE, RUN_DECISION_ASSESSMENT_QUEUE } from "../src/queue";
import { inspectRestoredQueue } from "./backup-queue-inventory";

test("counts partitioned queue states without consuming jobs or exposing payloads and refuses a missing schema", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/da_it_[a-f0-9]{16}$/u.test(url.pathname)) throw new Error("Disposable database required.");
  // Provision the real installed queue schema before inspection, without a worker.
  const boss = await getBoss();
  const otherQueue = `sensitive-fixture-${randomUUID()}`;
  try { await boss.createQueue(otherQueue); } finally { await closeBoss(); }
  const client = new Client({ connectionString: url.toString() }); await client.connect();
  try {
    await client.query("BEGIN");
    const baseline = (await inspectRestoredQueue(client)).queues;
    for (const state of ["created", "retry", "active", "completed", "cancelled", "failed"]) {
      await client.query(`INSERT INTO pgboss.job (name, state, data, output, start_after)
        VALUES ($1, $2, $3::jsonb, $4::jsonb, now() - interval '1 day')`,
      [RUN_COUNCIL_QUEUE, state, JSON.stringify({ question: "SENSITIVE SYNTHETIC INPUT" }), JSON.stringify({ text: "SENSITIVE SYNTHETIC OUTPUT" })]);
    }
    for (const [queue, state] of [[PRIVATE_DELIVERY_QUEUE, "created"], [RUN_DECISION_ASSESSMENT_QUEUE, "retry"], [otherQueue, "created"]]) {
      await client.query("INSERT INTO pgboss.job (name, state, start_after) VALUES ($1, $2, now() + interval '1 year')", [queue, state]);
    }
    const snapshot = async () => (await client.query(`SELECT id, name, state, start_after,
      md5(data::text) AS data_hash, md5(output::text) AS output_hash FROM pgboss.job ORDER BY name, id`)).rows;
    const before = await snapshot();
    const inventory = await inspectRestoredQueue(client);
    for (const state of ["created", "retry", "active", "completed", "cancelled", "failed"] as const) {
      expect(inventory.queues.council.states[state]).toBe(baseline.council.states[state] + 1);
    }
    expect(inventory.queues.private.states.created).toBe(baseline.private.states.created + 1);
    expect(inventory.queues.private.futureStartAfter).toBe(baseline.private.futureStartAfter + 1);
    expect(inventory.queues.decision.futureStartAfter).toBe(baseline.decision.futureStartAfter + 1);
    expect(inventory.queues.other.futureStartAfter).toBe(baseline.other.futureStartAfter + 1);
    expect(JSON.stringify(inventory)).not.toMatch(/SENSITIVE|sensitive-fixture/u);
    expect(await snapshot()).toEqual(before);
    await client.query("ALTER TABLE pgboss.job RENAME TO fixture_hidden_job");
    await expect(inspectRestoredQueue(client)).rejects.toThrow(/^Restored queue inventory could not be verified\.$/u);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
