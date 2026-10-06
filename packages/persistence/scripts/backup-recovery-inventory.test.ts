import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { PrivateDelivery } from "@deliberation-ai/contracts";
import { expect, test, vi } from "vitest";
import { addPrivateRecoveryBranch, inspectAdditionalRecovery, type PrivateRecoveryInventory } from "./backup-recovery-inventory";

const delivery = (originBranchId: string, status: PrivateDelivery["status"]): PrivateDelivery => ({
  id: randomUUID(), originBranchId, messageId: randomUUID(), fingerprint: "a".repeat(64), status,
  connectionId: randomUUID(), connectionFingerprint: "b".repeat(64),
  request: { version: "private-text-v1", model: "fixture", maxOutputTokens: 128,
    messages: Array.from({ length: 4 }, () => ({ role: "user", content: "SENSITIVE REQUEST" })) },
  createdAt: new Date().toISOString(), submittedAt: new Date().toISOString(), finishedAt: null, errorCode: null, result: null,
});

test("keeps ambiguous origin outcomes distinct from inherited historical snapshots", () => {
  const origin = randomUUID(), fork = randomUUID();
  const inventory: PrivateRecoveryInventory = { branches: 0, ownDeliveryStatuses: {}, copiedDeliveryStatuses: {} };
  addPrivateRecoveryBranch(inventory, origin, { deliveries: [delivery(origin, "outcome_unknown"), delivery(origin, "prepared")] });
  addPrivateRecoveryBranch(inventory, fork, { deliveries: [delivery(origin, "submitted"), delivery(fork, "failed")] });
  addPrivateRecoveryBranch(inventory, randomUUID(), {});
  expect(inventory).toEqual({ branches: 3, ownDeliveryStatuses: { outcome_unknown: 1, prepared: 1, failed: 1 }, copiedDeliveryStatuses: { submitted: 1 } });
  expect(JSON.stringify(inventory)).not.toContain("SENSITIVE");
});

test("reports historical missing schemas as unavailable rather than healthy zero counts", async () => {
  const client = { query: vi.fn().mockResolvedValue({ rows: [{ assessments: false, operations: false, branches: false }] }) };
  expect(await inspectAdditionalRecovery(client as unknown as Client)).toEqual({
    decisionAssessmentStatuses: null, decisionOperationStatuses: null, privateBranches: null,
  });
  expect(client.query).toHaveBeenCalledTimes(1);
});

test("rejects incomplete schema and redacts database/parser failure details", async () => {
  const partial = { query: vi.fn().mockResolvedValue({ rows: [{ assessments: true, operations: false, branches: false }] }) };
  await expect(inspectAdditionalRecovery(partial as unknown as Client)).rejects.toThrow("Restored recovery operation inventory could not be verified.");
  const failed = { query: vi.fn().mockRejectedValue(new Error("SENSITIVE REQUEST AND CONNECTION URL")) };
  await expect(inspectAdditionalRecovery(failed as unknown as Client)).rejects.toThrow(/^Restored recovery operation inventory could not be verified\.$/u);
  const unknownStatus = { query: vi.fn()
    .mockResolvedValueOnce({ rows: [{ assessments: true, operations: true, branches: false }] })
    .mockResolvedValueOnce({ rows: [{ status: "SENSITIVE UNKNOWN STATUS", total: "1" }] }) };
  await expect(inspectAdditionalRecovery(unknownStatus as unknown as Client)).rejects.toThrow(/^Restored recovery operation inventory could not be verified\.$/u);
});
