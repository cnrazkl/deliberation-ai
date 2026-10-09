import { afterEach, expect, test, vi } from "vitest";
import { SubmissionAttempts } from "./submission-attempts";

afterEach(() => vi.unstubAllGlobals());

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

test("LAN HTTP fallback keeps uncertain intent keys and separates completed or changed intents", () => {
  const source = globalThis.crypto;
  vi.stubGlobal("crypto", { getRandomValues: source.getRandomValues.bind(source) });
  const attempts = new SubmissionAttempts();
  const first = attempts.prepare("council", { source: "a" });
  expect(first.idempotencyKey).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(attempts.prepare("council", { source: "a" })).toEqual(first);
  const changed = attempts.prepare("council", { source: "b" });
  expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
  attempts.complete("council", first.idempotencyKey);
  expect(attempts.prepare("council", { source: "b" })).toEqual(changed);
  attempts.complete("council", changed.idempotencyKey);
  expect(attempts.prepare("council", { source: "b" }).idempotencyKey).not.toBe(changed.idempotencyKey);
});

test("entropy failure preserves a prior uncertain intent and never installs a replacement", () => {
  const attempts = new SubmissionAttempts();
  const first = attempts.prepare("council", { source: "a" });
  vi.stubGlobal("crypto", { getRandomValues: () => { throw new Error("secure entropy unavailable"); } });
  expect(() => attempts.prepare("council", { source: "b" })).toThrow("secure entropy unavailable");
  expect(attempts.prepare("council", { source: "a" })).toEqual(first);
});
