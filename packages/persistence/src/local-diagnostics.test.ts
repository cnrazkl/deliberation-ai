import { expect, test } from "vitest";
import { classifyWorkerStatus } from "./local-diagnostics";

test("distinguishes a live worker from stopped, stale and never-started states", () => {
  const seen = new Date("2026-09-26T12:00:00Z");
  expect(classifyWorkerStatus(1, seen, null)).toBe("ready");
  expect(classifyWorkerStatus(0, seen, seen)).toBe("stopped");
  expect(classifyWorkerStatus(0, seen, null)).toBe("stale");
  expect(classifyWorkerStatus(0, null, null)).toBe("never_seen");
});
