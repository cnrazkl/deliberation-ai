import { expect, test } from "vitest";
import { billingStatementChangeSchema, type BillingStatementChangeInput, type BillingStatementVersion } from "@deliberation-ai/contracts";
import { foldStatementVersions } from "./billing-statement-history";

const change: BillingStatementChangeInput = { version: "billing-statement-change-v1", action: "record", connectionId: "00000000-0000-4000-8000-000000000001",
  statementId: "fixture", expectedFingerprint: null, documentSha256: "a".repeat(64), reviewedAt: "2026-10-01T00:00:00.000Z", reason: "Synthetic initial review",
  packet: { version: "billing-statement-v1", connectionId: "00000000-0000-4000-8000-000000000001", statementId: "fixture", documentSha256: "a".repeat(64),
    reviewedAt: "2026-10-01T00:00:00.000Z", currency: "USD", scope: "complete_connection_statement", totalUsd: "-0.1",
    lines: [{ lineId: "credit", allocation: "unallocated", kind: "credit", reason: "Shared credit", amountUsd: "-0.1" }] } };
const original: BillingStatementVersion = { id: "id", input: change, sequence: 1, fingerprint: "b".repeat(64), recordedAt: change.reviewedAt,
  inspection: { version: "billing-statement-inspection-v1", status: "reconciled_owner_packet", connectionId: change.connectionId, statementId: change.statementId,
    documentSha256: change.documentSha256, currency: "USD", declaredTotalUsd: "-0.100000000000", listedTotalUsd: "-0.100000000000", differenceUsd: "0.000000000000",
    matchedAttemptSubtotalUsd: null, unallocatedSubtotalUsd: "-0.100000000000", matchedAttempts: 0, unallocatedLines: 1, issues: [],
    providerAuthenticity: "unverified", paymentStatus: "unknown", monetaryDispatchAllowed: false, writes: false,
    packetFingerprint: "c".repeat(64), ledgerFingerprint: "d".repeat(64), inspectedAt: change.reviewedAt, receiptChecks: { present: 0, retainedWithoutReceipt: 0 } } };
const voided: BillingStatementVersion = { ...original, sequence: 2, fingerprint: "e".repeat(64), inspection: null,
  input: { version: change.version, action: "void", connectionId: change.connectionId, statementId: change.statementId, expectedFingerprint: original.fingerprint,
    documentSha256: change.documentSha256, reviewedAt: change.reviewedAt, reason: "Withdraw synthetic source" } };
test("keeps one effective statement version, full historical packets and unknown payment through void/restore", () => {
  const state = foldStatementVersions([original, voided]);
  expect(state.status).toBe("voided"); expect(state.effective).toBeNull(); expect(state.versions[0]!.inspection!.declaredTotalUsd).toBe("-0.100000000000");
  const restored = foldStatementVersions([original, voided, { ...original, sequence: 3, input: { ...change, expectedFingerprint: voided.fingerprint } }]);
  expect(restored.status).toBe("owner_recorded"); expect(restored.versions).toHaveLength(3);
  expect(restored).toMatchObject({ providerAuthenticity: "unverified", paymentStatus: "unknown", monetaryDispatchAllowed: false });
});
test("rejects gaps, stale heads, changed identities, first withdrawal and inconsistent archived arithmetic", () => {
  expect(() => foldStatementVersions([])).toThrow();
  for (const version of [{ ...voided, sequence: 3 }, { ...voided, input: { ...voided.input, expectedFingerprint: null } },
    { ...voided, input: { ...voided.input, statementId: "other" } }, { ...voided, input: { ...voided.input, reviewedAt: "2026-09-30T00:00:00.000Z" } }]) {
    expect(() => foldStatementVersions([original, version])).toThrow();
  }
  expect(() => foldStatementVersions([{ ...voided, sequence: 1, input: { ...voided.input, expectedFingerprint: null } }])).toThrow("recorded");
  for (const inspection of [{ ...original.inspection!, status: "incomplete" as const }, { ...original.inspection!, unallocatedSubtotalUsd: "0.000000000000" },
    { ...original.inspection!, matchedAttemptSubtotalUsd: "0.000000000000" }, { ...original.inspection!, documentSha256: "x" }]) {
    expect(() => foldStatementVersions([{ ...original, inspection }])).toThrow();
  }
});
test("rejects packet/source identity mismatches and unbounded or unknown change fields", () => {
  expect(billingStatementChangeSchema.safeParse(change).success).toBe(true);
  expect(billingStatementChangeSchema.safeParse({ ...change, reason: "" }).success).toBe(false);
  expect(billingStatementChangeSchema.safeParse({ ...change, secret: "x" }).success).toBe(false);
  expect(() => foldStatementVersions([{ ...original, input: { ...change, packet: { ...change.packet, statementId: "other" } } }])).toThrow("identity");
});
