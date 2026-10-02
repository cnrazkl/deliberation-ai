import { expect, test } from "vitest";
import { providerBillingSchema, providerBillingChangeSchema, type ProviderBillingInput, type ProviderBillingRecord, type ProviderBillingChange } from "@deliberation-ai/contracts";
import { usdToPico, validateBillingAmounts, foldBillingChanges, validateBillingReallocation } from "./billing";

const input: ProviderBillingInput = { version: "provider-billing-v1", operationId: "00000000-0000-4000-8000-000000000001",
  connectionId: "00000000-0000-4000-8000-000000000002", provider: "openai-compatible", model: "fixture", remoteResponseId: "response",
  statementId: "statement", lineId: "line", documentSha256: "a".repeat(64), billedAt: "2026-10-01T00:00:00.000Z",
  reviewedAt: "2026-10-01T00:00:00.000Z", attribution: "exact_remote_response", scope: "all_charges_for_this_attempt", currency: "USD",
  totalUsd: "0.010000000001", components: [{ kind: "tokens", amountUsd: "0.000000000001" }, { kind: "tools", amountUsd: "0.02" }, { kind: "credit", amountUsd: "-0.01" }] };
test("reconciles exact amounts including tools and credits without floating point rounding", () => {
  expect(() => validateBillingAmounts(input)).not.toThrow();
  expect(usdToPico(input.totalUsd)).toBe(BigInt("10000000001"));
  expect(usdToPico("999999999.999999999999")).toBe(BigInt("999999999999999999999"));
});
test("rejects totals that do not reconcile and positive credits or negative non-credit charges", () => {
  expect(() => validateBillingAmounts({ ...input, totalUsd: "0.01" })).toThrow("total");
  for (const component of [{ kind: "credit" as const, amountUsd: "1" }, { kind: "tools" as const, amountUsd: "-1" }]) {
    expect(() => validateBillingAmounts({ ...input, components: [component] })).toThrow("credits");
  }
  expect(() => validateBillingAmounts({ ...input, totalUsd: "0", components: [{ kind: "tokens", amountUsd: "0" }] })).not.toThrow();
});
test("requires explicit attribution, complete scope, USD and an evidence digest", () => {
  expect(providerBillingSchema.safeParse(input).success).toBe(true);
  for (const change of [{ attribution: "aggregate" }, { scope: "tokens_only" }, { currency: "EUR" }, { documentSha256: "not-a-digest" },
    { totalUsd: "-1" }, { totalUsd: "1e3" }, { totalUsd: "0.0000000000001" }, { components: [] }]) {
    expect(providerBillingSchema.safeParse({ ...input, ...change }).success).toBe(false);
  }
});
const original: ProviderBillingRecord = { ...input, id: "00000000-0000-4000-8000-000000000003", runId: "run",
  fingerprint: "a".repeat(64), receiptFingerprint: "receipt", recordedAt: input.reviewedAt };

test("requires a reviewed source and complete consistent evidence for identity reallocation", () => {
  const source = foldBillingChanges(original, []);
  const transfer = { version: "provider-billing-reallocation-v1" as const, sourceRecordId: original.id, expectedFingerprint: source.currentFingerprint,
    documentSha256: input.documentSha256, reviewedAt: input.reviewedAt, reason: "Synthetic remapping", replacement: { ...input, operationId: "new-operation" } };
  expect(() => validateBillingReallocation(source, transfer)).not.toThrow();
  for (const change of [{ ...transfer, expectedFingerprint: "stale" }, { ...transfer, sourceRecordId: "foreign" },
    { ...transfer, documentSha256: "wrong" }, { ...transfer, replacement: input },
    { ...transfer, replacement: { ...transfer.replacement, totalUsd: "3" } }]) expect(() => validateBillingReallocation(source, change)).toThrow();
  expect(() => validateBillingReallocation({ ...source, status: "reallocated" }, transfer)).toThrow("unavailable");
});
const replacement: ProviderBillingChange = { version: "provider-billing-change-v1", recordId: original.id, expectedFingerprint: original.fingerprint,
  documentSha256: input.documentSha256, reviewedAt: input.reviewedAt, reason: "Correct the synthetic amount", action: "replace",
  replacement: { ...input, totalUsd: "0.02", components: [{ kind: "tokens", amountUsd: "0.02" }] }, id: "change", sequence: 1,
  fingerprint: "b".repeat(64), recordedAt: input.reviewedAt };
test("folds replace, void and restore without modifying original evidence or adding both amounts", () => {
  const corrected = foldBillingChanges(original, [replacement]);
  expect(corrected.totalUsd).toBe("0.02"); expect(original.totalUsd).toBe("0.010000000001");
  const { replacement: _replacement, ...base } = replacement;
  const voided: ProviderBillingChange = { ...base, action: "void", sequence: 2, expectedFingerprint: replacement.fingerprint, fingerprint: "c".repeat(64) };
  expect(foldBillingChanges(original, [replacement, voided]).status).toBe("voided");
  expect(foldBillingChanges(original, [replacement, voided, { ...replacement, sequence: 3, expectedFingerprint: voided.fingerprint }]).status).toBe("owner_recorded");
});
test("rejects broken chains, changed source/receipt identity and inconsistent replacement evidence", () => {
  for (const change of [{ ...replacement, sequence: 2 }, { ...replacement, expectedFingerprint: "wrong" },
    { ...replacement, replacement: { ...replacement.replacement, lineId: "different" } },
    { ...replacement, replacement: { ...replacement.replacement, operationId: "different" } },
    { ...replacement, documentSha256: "b".repeat(64) }, { ...replacement, reviewedAt: "2026-09-30T00:00:00.000Z" }]) {
    expect(() => foldBillingChanges(original, [change])).toThrow();
  }
  expect(providerBillingChangeSchema.safeParse({ ...replacement, id: undefined, sequence: undefined, fingerprint: undefined, recordedAt: undefined }).success).toBe(false);
});
