import type { Client } from "pg";
import { expect, test, vi } from "vitest";
import { inspectRestoredQueue, projectQueueInventory } from "./backup-queue-inventory";

test("separates pending, active and terminal queue states, including delayed and other work", () => {
  const result = projectQueueInventory([
    { category: "council", state: "created", total: "3", future: "2" },
    { category: "council", state: "retry", total: "2", future: "1" },
    { category: "private", state: "active", total: "1", future: "0" },
    { category: "decision", state: "failed", total: "4", future: "0" },
    { category: "other", state: "created", total: "1", future: "1" },
  ]);
  expect(result.council.states.created).toBe(3);
  expect(result.council.states.retry).toBe(2);
  expect(result.council.futureStartAfter).toBe(3);
  expect(result.private.states.active).toBe(1);
  expect(result.decision.states.failed).toBe(4);
  expect(result.other.futureStartAfter).toBe(1);
  expect(result.council.states.completed).toBe(0);
});

test("fails closed on unknown states/categories, duplicate groups and inconsistent counts", () => {
  const valid = { category: "council", state: "created", total: "1", future: "0" };
  for (const invalid of [
    { ...valid, category: "SENSITIVE QUEUE NAME" }, { ...valid, state: "new-state" },
    { ...valid, total: "9007199254740992" }, { ...valid, total: "-1" },
    { ...valid, future: "2" }, { ...valid, future: "NaN" },
    { ...valid, state: "active", future: "1" },
  ]) expect(() => projectQueueInventory([invalid])).toThrow(/^Restored queue inventory is invalid\.$/u);
  expect(() => projectQueueInventory([valid, valid])).toThrow("Restored queue inventory is invalid.");
});

test("only reads aggregate metadata and redacts query/schema failures", async () => {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  const result = await inspectRestoredQueue(client as unknown as Client);
  expect(result.queues).toEqual(projectQueueInventory([]));
  expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
  const sql = client.query.mock.calls[0]![0] as string;
  expect(sql).not.toMatch(/\b(data|output|id)\b/u);
  expect(client.query).toHaveBeenCalledTimes(1);
  const failed = { query: vi.fn().mockRejectedValue(new Error("SENSITIVE PAYLOAD AND DATABASE URL")) };
  await expect(inspectRestoredQueue(failed as unknown as Client)).rejects.toThrow(/^Restored queue inventory could not be verified\.$/u);
});
