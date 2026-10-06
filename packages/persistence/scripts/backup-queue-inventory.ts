import type { Client } from "pg";
import { PRIVATE_DELIVERY_QUEUE, RUN_COUNCIL_QUEUE, RUN_DECISION_ASSESSMENT_QUEUE } from "../src/queue";

const categories = ["council", "decision", "private", "other"] as const;
const states = ["created", "retry", "active", "completed", "cancelled", "failed"] as const;
type QueueCategory = typeof categories[number];
type QueueState = typeof states[number];
export interface QueueInventoryRow { category: string; state: string; total: string; future: string }
export type QueueCounts = Record<QueueCategory, {
  states: Record<QueueState, number>;
  futureStartAfter: number;
}>;
export interface RestoredQueueInventory { checkedAt: string; queues: QueueCounts }

export function projectQueueInventory(rows: readonly QueueInventoryRow[]): QueueCounts {
  const result = Object.fromEntries(categories.map((category) => [category, {
    states: Object.fromEntries(states.map((state) => [state, 0])), futureStartAfter: 0,
  }])) as QueueCounts;
  const seen = new Set<string>();
  for (const row of rows) {
    const total = Number(row.total), future = Number(row.future);
    const key = `${row.category}:${row.state}`;
    if (!categories.includes(row.category as QueueCategory) || !states.includes(row.state as QueueState) || seen.has(key)
      || !Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(future) || future < 0 || future > total
      || (future > 0 && row.state !== "created" && row.state !== "retry")) {
      throw new Error("Restored queue inventory is invalid.");
    }
    seen.add(key);
    const counts = result[row.category as QueueCategory];
    counts.states[row.state as QueueState] = total;
    counts.futureStartAfter += future;
    if (!Number.isSafeInteger(counts.futureStartAfter)) throw new Error("Restored queue inventory is invalid.");
  }
  return result;
}

// No PgBoss startup/API calls or job payloads: inspect the restored table only.
export async function inspectRestoredQueue(client: Client): Promise<RestoredQueueInventory> {
  const checkedAt = new Date().toISOString();
  try {
    const result = await client.query<QueueInventoryRow>(`SELECT
      CASE name WHEN $1 THEN 'council' WHEN $2 THEN 'decision' WHEN $3 THEN 'private' ELSE 'other' END AS category,
      state::text, count(*)::text AS total,
      count(*) FILTER (WHERE state IN ('created', 'retry') AND start_after > $4::timestamptz)::text AS future
      FROM pgboss.job GROUP BY 1, 2`, [RUN_COUNCIL_QUEUE, RUN_DECISION_ASSESSMENT_QUEUE, PRIVATE_DELIVERY_QUEUE, checkedAt]);
    return { checkedAt, queues: projectQueueInventory(result.rows) };
  } catch {
    // Do not forward database values, queue names, IDs or parser error details.
    throw new Error("Restored queue inventory could not be verified.");
  }
}
