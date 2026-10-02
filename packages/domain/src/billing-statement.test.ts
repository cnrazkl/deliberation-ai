import { expect, test } from "vitest";
import { billingStatementSchema, type BillingStatementInput, type ProviderBillingRecord } from "@deliberation-ai/contracts";
import { foldBillingChanges } from "./billing";
import { inspectBillingStatement } from "./billing-statement";

const original: ProviderBillingRecord = { version: "provider-billing-v1", id: "00000000-0000-4000-8000-000000000001",
  operationId: "00000000-0000-4000-8000-000000000002", connectionId: "00000000-0000-4000-8000-000000000003",
  provider: "fixture", model: "fixture", remoteResponseId: "response", runId: "run", fingerprint: "a".repeat(64), receiptFingerprint: "receipt",
  statementId: "statement", lineId: "1", documentSha256: "b".repeat(64), billedAt: "2026-10-01T00:00:00.000Z", reviewedAt: "2026-10-01T00:00:00.000Z",
  recordedAt: "2026-10-01T00:00:00.000Z", attribution: "exact_remote_response", scope: "all_charges_for_this_attempt", currency: "USD",
  totalUsd: "0.010000000001", components: [{ kind: "tokens", amountUsd: "0.010000000001" }] };
const state = foldBillingChanges(original, []);
const packet: BillingStatementInput = { version: "billing-statement-v1", connectionId: original.connectionId, statementId: original.statementId,
  documentSha256: original.documentSha256, reviewedAt: original.reviewedAt, currency: "USD", scope: "complete_connection_statement",
  totalUsd: "0.009000000001", lines: [
    { lineId: "1", amountUsd: original.totalUsd, allocation: "attempt", recordId: original.id, expectedFingerprint: original.fingerprint },
    { lineId: "credit", amountUsd: "-0.002", allocation: "unallocated", kind: "credit", reason: "Shared statement credit" },
    { lineId: "tax", amountUsd: "0.001", allocation: "unallocated", kind: "tax", reason: "Account tax" },
  ] };

test("reconciles exact signed statement totals while preserving separate unallocated charges", () => {
  expect(inspectBillingStatement(packet, [state])).toMatchObject({ status: "reconciled_owner_packet", differenceUsd: "0.000000000000",
    matchedAttemptSubtotalUsd: "0.010000000001", unallocatedSubtotalUsd: "-0.001000000000", matchedAttempts: 1, unallocatedLines: 2,
    providerAuthenticity: "unverified", paymentStatus: "unknown", monetaryDispatchAllowed: false });
  const sharedOnly = inspectBillingStatement({ ...packet, totalUsd: "-0.001", lines: packet.lines.slice(1) }, []);
  expect(sharedOnly.status).toBe("reconciled_owner_packet"); expect(sharedOnly.matchedAttemptSubtotalUsd).toBeNull();
});
test("reports total residual, duplicate lines/records and invalid charge signs without double matching", () => {
  const duplicate = inspectBillingStatement({ ...packet, lines: [...packet.lines, packet.lines[0]!] }, [state]);
  expect(duplicate.matchedAttempts).toBe(1);
  expect(duplicate.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["duplicate_line", "duplicate_record", "statement_total_mismatch"]));
  expect(duplicate.differenceUsd).toBe("-0.010000000001");
  for (const charge of [{ kind: "tax" as const, amountUsd: "-1" }, { kind: "credit" as const, amountUsd: "1" }]) {
    expect(inspectBillingStatement({ ...packet, lines: [{ ...packet.lines[1]!, allocation: "unallocated", reason: "test", ...charge }] }, []).issues.map((issue) => issue.reason)).toContain("invalid_charge_sign");
  }
});
test("excludes stale, voided, mismatched and unavailable attempt amounts", () => {
  for (const record of [{ ...state, currentFingerprint: "c".repeat(64) }, { ...state, status: "voided" as const },
    { ...state, totalUsd: "1" }, { ...state, connectionId: "different" }, { ...state, reviewedAt: "2026-10-02T00:00:00.000Z" }]) {
    const result = inspectBillingStatement(packet, [record]);
    expect(result.status).toBe("incomplete"); expect(result.matchedAttemptSubtotalUsd).toBeNull();
  }
  expect(inspectBillingStatement(packet, []).issues[0]!.reason).toBe("record_unavailable");
  expect(inspectBillingStatement(packet, [state], new Set([state.id])).issues[0]!.reason).toBe("receipt_mismatch");
  expect(inspectBillingStatement(packet, [state], new Set([state.id])).matchedAttemptSubtotalUsd).toBeNull();
});
test("detects omitted known records even when listed amounts balance", () => {
  const result = inspectBillingStatement({ ...packet, totalUsd: "-0.001", lines: packet.lines.slice(1) }, [state]);
  expect(result.differenceUsd).toBe("0.000000000000"); expect(result.status).toBe("incomplete");
  expect(result.issues).toEqual([{ lineId: "1", recordId: state.id, reason: "known_record_omitted" }]);
});

test("excludes superseded attributions from coverage but rejects packets that still reference them", () => {
  const moved = { ...state, status: "reallocated" as const, currentFingerprint: "e".repeat(64) };
  expect(inspectBillingStatement(packet, [moved]).issues.map((issue) => issue.reason)).toContain("reallocated_record");
  expect(inspectBillingStatement({ ...packet, totalUsd: "-0.001", lines: packet.lines.slice(1) }, [moved]).status).toBe("reconciled_owner_packet");
});
test("bounds statement intake and requires explicit complete scope and safe fixed-point amounts", () => {
  expect(billingStatementSchema.safeParse(packet).success).toBe(true);
  for (const change of [{ scope: "tokens_only" }, { currency: "EUR" }, { totalUsd: "1e2" }, { totalUsd: "0.0000000000001" },
    { lines: [] }, { lines: Array.from({ length: 1001 }, () => packet.lines[0]) }, { secret: "not allowed" }]) {
    expect(billingStatementSchema.safeParse({ ...packet, ...change }).success).toBe(false);
  }
});
