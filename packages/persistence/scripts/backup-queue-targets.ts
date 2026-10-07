import type { Client } from "pg";
import { PRIVATE_DELIVERY_QUEUE, RUN_COUNCIL_QUEUE, RUN_DECISION_ASSESSMENT_QUEUE } from "../src/queue";

const categories = ["council", "decision", "private"] as const;
const states = ["created", "retry", "active", "completed", "cancelled", "failed"] as const;
const relations = ["malformed_payload", "schema_unavailable", "missing_target", "linked_job", "different_job", "unrecorded_job", "branch_present_receipt_unchecked"] as const;
type Category = typeof categories[number];
const targetStatuses: Record<Category, readonly string[]> = {
  council: ["queued", "running", "completed", "partially_completed", "failed", "cancelled"],
  decision: ["queued", "running", "completed", "failed", "outcome_unknown", "cancelled"],
  private: [],
};
export interface QueueTargetRow { category: string; state: string; relation: string; target_status: string; total: string }
export type QueueTargetCounts = Record<Category, Record<typeof states[number], {
  relations: Record<typeof relations[number], number>;
  targetStatuses: Record<string, number>;
}>>;

export function projectQueueTargets(rows: readonly QueueTargetRow[]): QueueTargetCounts {
  const result = Object.fromEntries(categories.map((category) => [category, Object.fromEntries(states.map((state) => [state, {
    relations: Object.fromEntries(relations.map((relation) => [relation, 0])), targetStatuses: {},
  }]))])) as QueueTargetCounts;
  const seen = new Set<string>();
  for (const row of rows) {
    const count = Number(row.total), category = row.category as Category;
    const key = `${category}:${row.state}:${row.relation}:${row.target_status}`;
    const present = ["linked_job", "different_job", "unrecorded_job"].includes(row.relation);
    if (!categories.includes(category) || !states.includes(row.state as typeof states[number])
      || !relations.includes(row.relation as typeof relations[number]) || seen.has(key)
      || !Number.isSafeInteger(count) || count < 0
      || (present ? category === "private" || !targetStatuses[category].includes(row.target_status) : row.target_status !== "unavailable")
      || (row.relation === "branch_present_receipt_unchecked" && category !== "private")) {
      throw new Error("Restored queue target inventory is invalid.");
    }
    seen.add(key);
    const entry = result[category][row.state as typeof states[number]];
    entry.relations[row.relation as typeof relations[number]] += count;
    if (present) entry.targetStatuses[row.target_status] = (entry.targetStatuses[row.target_status] ?? 0) + count;
    if (Object.values(entry.relations).some((value) => !Number.isSafeInteger(value))
      || !Number.isSafeInteger(Object.values(entry.relations).reduce((sum, value) => sum + value, 0))) {
      throw new Error("Restored queue target inventory is invalid.");
    }
  }
  return result;
}

// These are fixed internal identifiers, never archive values or operator input.
const targets = [
  { category: "council", queue: RUN_COUNCIL_QUEUE, table: "runs", key: "runId" },
  { category: "decision", queue: RUN_DECISION_ASSESSMENT_QUEUE, table: "decision_assessments", key: "assessmentId" },
  { category: "private", queue: PRIVATE_DELIVERY_QUEUE, table: "conversation_private_branches", key: "branchId" },
] as const;
const uuidPattern = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";

export async function inspectRestoredQueueTargets(client: Client): Promise<QueueTargetCounts> {
  try {
    const rows: QueueTargetRow[] = [];
    for (const target of targets) {
      const schema = await client.query<{ present: boolean }>("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${target.table}`]);
      if (schema.rows.length !== 1 || typeof schema.rows[0]?.present !== "boolean") throw new Error();
      const available = schema.rows[0].present;
      // SQL validates scalar type and canonical UUID shape before casting. Extra
      // payload keys are ignored, matching worker target selection; none escape SQL.
      const valid = `jsonb_typeof(j.data) = 'object' AND jsonb_typeof(j.data->'${target.key}') = 'string'
        AND (j.data->>'${target.key}') ~* $2` + (target.category === "private"
        ? " AND jsonb_typeof(j.data->'operationId') = 'string' AND (j.data->>'operationId') ~* $2" : "");
      const relation = !available ? "'schema_unavailable'" : target.category === "private"
        ? "CASE WHEN t.id IS NULL THEN 'missing_target' ELSE 'branch_present_receipt_unchecked' END"
        : "CASE WHEN t.id IS NULL THEN 'missing_target' WHEN t.queue_job_id IS NULL THEN 'unrecorded_job' WHEN t.queue_job_id = j.id::text THEN 'linked_job' ELSE 'different_job' END";
      const status = available && target.category !== "private" ? "coalesce(t.status::text, 'unavailable')" : "'unavailable'";
      const join = available ? `LEFT JOIN public.${target.table} t ON t.id = CASE WHEN ${valid} THEN (j.data->>'${target.key}')::uuid END` : "";
      const result = await client.query<Omit<QueueTargetRow, "category">>(`SELECT j.state::text AS state,
        CASE WHEN (${valid}) IS NOT TRUE THEN 'malformed_payload' ELSE ${relation} END AS relation,
        ${status} AS target_status, count(*)::text AS total
        FROM pgboss.job j ${join} WHERE j.name = $1 GROUP BY 1, 2, 3`, [target.queue, uuidPattern]);
      rows.push(...result.rows.map((row) => ({ ...row, category: target.category })));
    }
    return projectQueueTargets(rows);
  } catch {
    // Database/parser diagnostics can include job payloads or private metadata.
    throw new Error("Restored queue target inventory could not be verified.");
  }
}
