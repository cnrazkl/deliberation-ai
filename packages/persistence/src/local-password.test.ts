import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import { hashLocalPassword, verifyLocalPassword } from "./local-password";
import { withOwner, getOwnerId, requireOwnerContext } from "./owner";
import { createRuntimeReadToken, verifyRuntimeReadToken } from "./runtime-read-auth";
import { hostIsQuiescent } from "./host-quiescence";

test("salted passwords verify correctly and malformed or unknown records fail closed", async () => {
  const password = randomBytes(20).toString("hex");
  const a = await hashLocalPassword(password), b = await hashLocalPassword(password);
  expect(a).not.toBe(b); expect(a).not.toContain(password);
  expect(await verifyLocalPassword(password, a)).toBe(true);
  expect(await verifyLocalPassword(`${password}x`, a)).toBe(false);
  for (const record of [null, "plain", "scrypt-v1:xx:zz"]) expect(await verifyLocalPassword(password, record)).toBe(false);
});
test("simultaneous and nested owner scopes survive awaits without leaking", async () => {
  const previous = globalThis.deliberationRequireOwnerContext;
  try {
    requireOwnerContext(); expect(() => getOwnerId()).toThrow("owner context");
    await Promise.all(["alice", "bob"].map(id => withOwner(id, async () => {
      await new Promise(resolve => setTimeout(resolve, id === "alice" ? 20 : 5));
      expect(getOwnerId()).toBe(id);
      expect(() => withOwner("nested", () => { expect(getOwnerId()).toBe("nested"); throw new Error("test"); })).toThrow("test");
      expect(getOwnerId()).toBe(id);
    })));
    expect(() => getOwnerId()).toThrow("owner context");
  } finally { globalThis.deliberationRequireOwnerContext = previous; }
});
test("runtime read tokens require the machine key and a short lifetime", () => {
  const key = randomBytes(32).toString("base64"), other = randomBytes(32).toString("base64");
  const now = Date.now(), token = createRuntimeReadToken(key, now);
  expect(verifyRuntimeReadToken(key, token, now + 1000)).toBe(true);
  expect(verifyRuntimeReadToken(other, token, now)).toBe(false);
  expect(verifyRuntimeReadToken(key, token, now + 16_000)).toBe(false);
  expect(verifyRuntimeReadToken(key, token, now - 2000)).toBe(false);
  expect(verifyRuntimeReadToken(key, "invalid", now)).toBe(false);
});
test("maintenance refuses active work from any account or unacknowledged probes", () => {
  const quiet = { activeRuns: 0, activeDecisions: 0, activeSchedules: 0, activeJobs: 0, activePrivate: 0, pendingProbes: 0 };
  expect(hostIsQuiescent(quiet)).toBe(true);
  for (const key of Object.keys(quiet)) expect(hostIsQuiescent({ ...quiet, [key]: 1 })).toBe(false);
  expect(hostIsQuiescent({ ...quiet, activeRuns: NaN })).toBe(false);
});
