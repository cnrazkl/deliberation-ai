import { expect, test } from "vitest";
import { changedRecoveryTables, requireMatchingRecovery, requireQuiescentRecovery, type RecoverySnapshot, type RecoveryWork } from "./recovery-integrity";
const baseline: RecoverySnapshot = { version: "local-recovery-snapshot-v1", fingerprint: "fixture", tables: {
  "public.knowledge_grants": { rows: 1, sha256: "active" }, "public.private_branch_deletions": { rows: 1, sha256: "retained" }, "pgboss.job": { rows: 1, sha256: "created" },
} };
test("refuses a stale archive or rollback after changed grants, receipts or missing tables", () => {
  for (const table of ["public.knowledge_grants", "public.private_branch_deletions"]) {
    const changed = { ...baseline, tables: { ...baseline.tables, [table]: { rows: 1, sha256: "changed" } } };
    expect(changedRecoveryTables(baseline, changed)).toEqual([table]);
    expect(() => requireMatchingRecovery(baseline, changed, true)).toThrow("reconciliation");
  }
  expect(() => requireMatchingRecovery(baseline, { ...baseline, tables: {} })).toThrow();
  const parked = { ...baseline, tables: { ...baseline.tables, "pgboss.job": { rows: 1, sha256: "parked" } } };
  expect(() => requireMatchingRecovery(baseline, parked)).toThrow();
  expect(() => requireMatchingRecovery(baseline, parked, true)).not.toThrow();
});
test("blocks switching on any unreviewed work category or active schedules", () => {
  const clear: RecoveryWork = { councilPending: 0, councilUnsettled: 0, councilHistoricalUnsubmitted: 94, decisionPending: 0, decisionUnsettled: 0, privatePending: 0, privateUnknown: 0, privateCopies: 2,
    privateDeletionReceipts: 3, privateJobsWithDeletedReceipt: 3, privateJobsWithLiveReceipt: 0, privateJobsTargetingCopy: 0, privateJobsWithoutReceipt: 0, privateCopyOriginMissing: 0, probePending: 0, probeUnknown: 0, activeSchedules: 0 };
  expect(() => requireQuiescentRecovery(clear)).not.toThrow();
  for (const field of ["councilPending", "councilUnsettled", "decisionPending", "decisionUnsettled", "privatePending", "probePending", "activeSchedules"] as const) {
    expect(() => requireQuiescentRecovery({ ...clear, [field]: 1 })).toThrow();
  }
});
