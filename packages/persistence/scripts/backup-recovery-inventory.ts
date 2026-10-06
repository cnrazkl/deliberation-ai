import type { Client, QueryResult } from "pg";
import type { PrivateBranchBody } from "@deliberation-ai/contracts";
import { decodePrivateBranchBody, MAX_PRIVATE_BRANCH_BYTES } from "../src/private-branches";

export interface PrivateRecoveryInventory {
  branches: number;
  ownDeliveryStatuses: Record<string, number>;
  copiedDeliveryStatuses: Record<string, number>;
}
export interface AdditionalRecoveryInventory {
  decisionAssessmentStatuses: Record<string, number> | null;
  decisionOperationStatuses: Record<string, number> | null;
  privateBranches: PrivateRecoveryInventory | null;
}

// Copied deliveries are historical snapshots, not additional dispatches. Keep
// their statuses visible without merging potentially older outcomes into origins.
export function addPrivateRecoveryBranch(inventory: PrivateRecoveryInventory, id: string, body: Pick<PrivateBranchBody, "deliveries">): void {
  inventory.branches += 1;
  for (const delivery of body.deliveries ?? []) {
    const counts = delivery.originBranchId === id ? inventory.ownDeliveryStatuses : inventory.copiedDeliveryStatuses;
    counts[delivery.status] = (counts[delivery.status] ?? 0) + 1;
  }
}

async function decisionCounts(client: Client, table: "decision_assessments" | "decision_operations") {
  const result = await client.query<{ status: string; total: string }>(
    `SELECT status, count(*)::text AS total FROM public.${table} GROUP BY status`,
  );
  const statuses = table === "decision_assessments"
    ? ["queued", "running", "completed", "failed", "outcome_unknown", "cancelled"]
    : ["prepared", "submitted", "succeeded", "failed", "outcome_unknown", "discarded", "retry_authorized"];
  if (result.rows.some((row) => !statuses.includes(row.status) || !Number.isSafeInteger(Number(row.total)) || Number(row.total) < 0)) throw new Error();
  return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.total)]));
}

// Only called on a restored archive, never a live recovery or dispatch path.
export async function inspectAdditionalRecovery(client: Client): Promise<AdditionalRecoveryInventory> {
  try {
    const schema = (await client.query<{ assessments: boolean; operations: boolean; branches: boolean }>(`SELECT
      to_regclass('public.decision_assessments') IS NOT NULL AS assessments,
      to_regclass('public.decision_operations') IS NOT NULL AS operations,
      to_regclass('public.conversation_private_branches') IS NOT NULL AS branches`)).rows[0]!;
    if (schema.assessments !== schema.operations) throw new Error();
    const result: AdditionalRecoveryInventory = {
      decisionAssessmentStatuses: schema.assessments ? await decisionCounts(client, "decision_assessments") : null,
      decisionOperationStatuses: schema.operations ? await decisionCounts(client, "decision_operations") : null,
      privateBranches: schema.branches ? { branches: 0, ownDeliveryStatuses: {}, copiedDeliveryStatuses: {} } : null,
    };
    if (!result.privateBranches) return result;
    const maxCiphertextBytes = Math.ceil(MAX_PRIVATE_BRANCH_BYTES * 4 / 3) + 128;
    const oversized = await client.query(`SELECT 1 FROM public.conversation_private_branches
      WHERE octet_length(body_ciphertext) > $1 LIMIT 1`, [maxCiphertextBytes]);
    if (oversized.rows.length) throw new Error();
    let cursor: string | null = null;
    while (true) {
      const page: QueryResult<Parameters<typeof decodePrivateBranchBody>[0]> = await client.query(`SELECT
        id, conversation_id AS "conversationId", source_run_id AS "sourceRunId", source_member_id AS "sourceMemberId",
        parent_branch_id AS "parentBranchId", revision, message_count AS "messageCount", body_ciphertext AS "bodyCiphertext"
        FROM public.conversation_private_branches WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT 16`, [cursor]);
      for (const row of page.rows) addPrivateRecoveryBranch(result.privateBranches, row.id, decodePrivateBranchBody(row));
      if (page.rows.length < 16) break;
      cursor = page.rows.at(-1)!.id;
    }
    return result;
  } catch {
    // Authenticated bodies/parser/database errors may contain sensitive data.
    throw new Error("Restored recovery operation inventory could not be verified.");
  }
}
