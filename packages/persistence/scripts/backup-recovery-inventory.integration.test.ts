import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { defaultFakeCouncilMembers, type PrivateBranchBody } from "@deliberation-ai/contracts";
import { expect, test } from "vitest";
import { encryptJson } from "../src/crypto";
import { MAX_PRIVATE_BRANCH_BYTES } from "../src/private-branches";
import { inspectAdditionalRecovery } from "./backup-recovery-inventory";

test("scans authenticated private bodies across pages without writes and rejects unreadable/oversized records", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/da_it_[a-f0-9]{16}$/u.test(url.pathname)) throw new Error("Disposable database required.");
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const conversationId = randomUUID(), sourceRunId = randomUUID(), originId = randomUUID();
  const ownMessage = randomUUID(), now = new Date().toISOString();
  const body: PrivateBranchBody = {
    version: "private-branch-drafts-v1", forkedFrom: null,
    seed: { version: "selected-member-private-seed-v1", conversationId, sourceRunId, sourceStateVersion: 1,
      sourceRiskProfile: "standard", sourcePromptVersion: "fixture", sourcePromptFingerprint: null,
      member: defaultFakeCouncilMembers[0]!, question: "SENSITIVE SYNTHETIC QUESTION", rawText: "SYNTHETIC RAW", reusedFromRunId: null },
    messages: [{ id: ownMessage, kind: "owner-draft", text: "Synthetic draft", createdAt: now, originBranchId: originId, acceptedRevision: 2 }],
    deliveries: [{ id: randomUUID(), messageId: ownMessage, originBranchId: originId, status: "outcome_unknown",
      fingerprint: "a".repeat(64), connectionId: randomUUID(), connectionFingerprint: "b".repeat(64),
      request: { version: "private-text-v1", model: "fixture", maxOutputTokens: 128,
        messages: Array.from({ length: 4 }, () => ({ role: "user", content: "SENSITIVE SYNTHETIC REQUEST" })) },
      createdAt: now, submittedAt: now, finishedAt: null, errorCode: null, result: null }],
  };
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO public.conversations (id, owner_id, anchor_run_id, origin) VALUES ($1, 'recovery-fixture', $2, 'native')", [conversationId, sourceRunId]);
    for (let index = 0; index < 18; index += 1) {
      const id = index === 0 ? originId : randomUUID();
      const value: PrivateBranchBody = index === 0 ? body : { ...body,
        forkedFrom: { branchId: originId, revision: 2, messageCount: 1 } };
      await client.query(`INSERT INTO public.conversation_private_branches
        (id, owner_id, conversation_id, source_run_id, source_member_id, parent_branch_id, request_id, request_hash, revision, message_count, body_ciphertext)
        VALUES ($1, 'recovery-fixture', $2, $3, $4, $5, $6, 'fixture', $7, 1, $8)`,
      [id, conversationId, sourceRunId, body.seed.member.id, index === 0 ? null : originId, randomUUID(), index === 0 ? 2 : 1, encryptJson(value, `private-branch:${id}:body`)]);
    }
    const before = (await client.query("SELECT id, body_ciphertext FROM public.conversation_private_branches ORDER BY id")).rows;
    const inventory = await inspectAdditionalRecovery(client);
    expect(inventory.privateBranches).toEqual({ branches: 18, ownDeliveryStatuses: { outcome_unknown: 1 }, copiedDeliveryStatuses: { outcome_unknown: 17 } });
    expect(inventory.decisionAssessmentStatuses).toEqual({});
    expect(inventory.decisionOperationStatuses).toEqual({});
    expect(JSON.stringify(inventory)).not.toContain("SENSITIVE");
    expect((await client.query("SELECT id, body_ciphertext FROM public.conversation_private_branches ORDER BY id")).rows).toEqual(before);

    await client.query("UPDATE public.conversation_private_branches SET body_ciphertext = $1 WHERE id = $2", [encryptJson(body, "incorrect-context"), originId]);
    await expect(inspectAdditionalRecovery(client)).rejects.toThrow(/^Restored recovery operation inventory could not be verified\.$/u);
    await client.query("UPDATE public.conversation_private_branches SET body_ciphertext = $1 WHERE id = $2", ["x".repeat(MAX_PRIVATE_BRANCH_BYTES * 2), originId]);
    await expect(inspectAdditionalRecovery(client)).rejects.toThrow(/^Restored recovery operation inventory could not be verified\.$/u);

    // Simulate a historical archive without these entire feature schemas.
    await client.query("ALTER TABLE public.decision_assessments RENAME TO fixture_hidden_assessments");
    await expect(inspectAdditionalRecovery(client)).rejects.toThrow("Restored recovery operation inventory could not be verified.");
    await client.query("ALTER TABLE public.decision_operations RENAME TO fixture_hidden_operations");
    await client.query("ALTER TABLE public.conversation_private_branches RENAME TO fixture_hidden_branches");
    expect(await inspectAdditionalRecovery(client)).toEqual({ decisionAssessmentStatuses: null, decisionOperationStatuses: null, privateBranches: null });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
