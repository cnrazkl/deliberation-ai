import type { Client } from "pg";
import { expect, test, vi } from "vitest";
import { inspectRestoredQueueTargets, projectQueueTargets } from "./backup-queue-targets";

test("separates queue states, missing targets and job linkage from application outcomes", () => {
  const result = projectQueueTargets([
    { category: "decision", state: "created", relation: "missing_target", target_status: "unavailable", total: "246" },
    { category: "council", state: "retry", relation: "linked_job", target_status: "completed", total: "1" },
    { category: "council", state: "retry", relation: "linked_job", target_status: "queued", total: "2" },
    { category: "council", state: "completed", relation: "different_job", target_status: "partially_completed", total: "1" },
    { category: "private", state: "completed", relation: "branch_present_receipt_unchecked", target_status: "unavailable", total: "1" },
  ]);
  expect(result.decision.created.relations.missing_target).toBe(246);
  expect(result.council.retry.relations.linked_job).toBe(3);
  expect(result.council.retry.targetStatuses).toEqual({ completed: 1, queued: 2 });
  expect(result.private.completed.targetStatuses).toEqual({});
  expect(result.private.active.relations.missing_target).toBe(0);
});

test("rejects unknown, inconsistent, duplicate and overflowing aggregate records without leaking values", () => {
  const valid = { category: "council", state: "active", relation: "linked_job", target_status: "running", total: "1" };
  for (const change of [
    { category: "SENSITIVE" }, { state: "unexpected" }, { relation: "unexpected" }, { target_status: "SENSITIVE" },
    { category: "private" }, { relation: "missing_target" }, { relation: "branch_present_receipt_unchecked", target_status: "unavailable" },
    { total: "-1" }, { total: "NaN" }, { total: "9007199254740992" },
  ]) expect(() => projectQueueTargets([{ ...valid, ...change }])).toThrow(/^Restored queue target inventory is invalid\.$/u);
  expect(() => projectQueueTargets([valid, valid])).toThrow("Restored queue target inventory is invalid.");
  expect(() => projectQueueTargets([{ ...valid, total: "9007199254740991" }, { ...valid, target_status: "queued" }])).toThrow("Restored queue target inventory is invalid.");
});

test("reads aggregate SQL only, distinguishes absent schemas and redacts query errors", async () => {
  const query = vi.fn().mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT to_regclass") ? [{ present: false }] : [] }));
  expect(await inspectRestoredQueueTargets({ query } as unknown as Client)).toEqual(projectQueueTargets([]));
  expect(query).toHaveBeenCalledTimes(6);
  const aggregates = query.mock.calls.filter(([sql]) => !sql.startsWith("SELECT to_regclass"));
  for (const [sql] of aggregates) {
    expect(sql).toContain("'schema_unavailable'");
    expect(sql).not.toContain("LEFT JOIN");
    expect(sql).not.toMatch(/SELECT\s+(?:\*|j\.(?:id|data|output))/u);
  }
  await expect(inspectRestoredQueueTargets({ query: vi.fn().mockRejectedValue(new Error("SENSITIVE URL/PAYLOAD")) } as unknown as Client))
    .rejects.toThrow(/^Restored queue target inventory could not be verified\.$/u);
});
