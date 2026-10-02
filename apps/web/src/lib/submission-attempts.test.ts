import { expect, test } from "vitest";
import { SubmissionAttempts } from "./submission-attempts";

test("keeps the same key after an uncertain response, replaces it after success or a changed intent", () => {
  const attempts = new SubmissionAttempts();
  const first = attempts.prepare("rerun", { source: "a", member: "b" });
  expect(attempts.prepare("rerun", { source: "a", member: "b" })).toEqual(first);
  const changed = attempts.prepare("rerun", { source: "a", member: "c" });
  expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
  attempts.complete("rerun", first.idempotencyKey);
  expect(attempts.prepare("rerun", { source: "a", member: "c" })).toEqual(changed);
  attempts.complete("rerun", changed.idempotencyKey);
  expect(attempts.prepare("rerun", { source: "a", member: "c" }).idempotencyKey).not.toBe(changed.idempotencyKey);
});
