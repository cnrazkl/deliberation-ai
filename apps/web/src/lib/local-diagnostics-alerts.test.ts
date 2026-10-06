import { expect, test } from "vitest";
import { localDiagnosticsAlerts, type LocalDiagnosticsAlertInput } from "./local-diagnostics-alerts";

const idle: LocalDiagnosticsAlertInput = { workerStatus: "ready", readyWorkers: 1, queuedRuns: 0, runningRuns: 0, unresolvedProviderAttempts: 0, activeSchedules: 0 };
test("healthy and idle stopped workers need no work warning", () => {
  expect(localDiagnosticsAlerts(idle)).toEqual([]);
  expect(localDiagnosticsAlerts({ ...idle, workerStatus: "stopped", readyWorkers: 0 })).toEqual([]);
});
test("stale running work warns even with no queued jobs or schedules", () => {
  expect(localDiagnosticsAlerts({ ...idle, workerStatus: "stale", readyWorkers: 0, runningRuns: 1 })).toHaveLength(1);
  expect(localDiagnosticsAlerts({ ...idle, runningRuns: 1 })).toEqual([]);
});
test("unknown outcomes warn independently of a healthy worker and preserve uncertainty", () => {
  const [message] = localDiagnosticsAlerts({ ...idle, unresolvedProviderAttempts: 2 });
  expect(message).toContain("2 konsey");
  expect(message).toContain("ulaşmış olabilir");
  expect(message).toContain("ücrete");
});
test("independent warnings survive together for duplicate workers or stalled schedules", () => {
  expect(localDiagnosticsAlerts({ ...idle, readyWorkers: 2, unresolvedProviderAttempts: 1 })).toHaveLength(2);
  expect(localDiagnosticsAlerts({ ...idle, workerStatus: "stopped", readyWorkers: 0, activeSchedules: 1, unresolvedProviderAttempts: 1 })).toHaveLength(2);
});
