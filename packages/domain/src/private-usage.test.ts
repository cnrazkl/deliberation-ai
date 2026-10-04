import { expect, test } from "vitest";
import type { PrivateDelivery, PrivateDeliveryUsage } from "@deliberation-ai/contracts";
import { summarizePrivateUsage } from "./private-usage";

const usage: PrivateDeliveryUsage = { model: "fixture", remoteResponseId: null, inputTokens: 10, outputTokens: 5,
  tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "inclusive", cachedInputTokens: 2, reasoningTokens: 3 } };
function receipt(overrides: Partial<PrivateDelivery> = {}): PrivateDelivery {
  return { id: "receipt", originBranchId: "branch", messageId: "message", fingerprint: "hash", status: "succeeded",
    connectionId: "connection", connectionFingerprint: "connection-hash", request: { version: "private-text-v1", model: "fixture", messages: [], maxOutputTokens: 1024 },
    createdAt: "2026-10-04T00:00:00Z", submittedAt: "2026-10-04T00:00:00Z", finishedAt: "2026-10-04T00:00:01Z", errorCode: null,
    result: { ...usage, text: "Fixture reply" }, ...overrides };
}
test("copied receipts never inflate a child's own observed usage", () => {
  const source = receipt(); const own = receipt({ id: "child-send", originBranchId: "child" });
  const summary = summarizePrivateUsage("child", [source, own]);
  expect(summary).toMatchObject({ ownReceipts: 1, submittedAttempts: 1, copiedReceipts: 1 });
  expect(summary.groups[0]!.input.total).toBe(10);
  expect(summarizePrivateUsage("child", [source])).toMatchObject({ submittedAttempts: 0, copiedReceipts: 1, groups: [] });
});
test("missing is unknown while provider-reported zero is retained with its denominator", () => {
  const summary = summarizePrivateUsage("branch", [receipt({ usage: { ...usage, inputTokens: 0 } }),
    receipt({ id: "second", usage: { ...usage, inputTokens: null, outputTokens: null } })]);
  expect(summary.groups[0]!.input).toEqual({ reported: 1, attempts: 2, knownSubtotal: 0, total: null });
  expect(summary.groups[0]!.output).toEqual({ reported: 1, attempts: 2, knownSubtotal: 5, total: null });
});
test("metered failures, unknown outcomes and acknowledged uncertainty remain observable", () => {
  const summary = summarizePrivateUsage("branch", [receipt({ status: "failed", result: null, usage }),
    receipt({ id: "unknown", status: "outcome_unknown", result: null }),
    receipt({ id: "closed", status: "discarded", result: null, usage: { ...usage, inputTokens: null, outputTokens: null } })]);
  expect(summary).toMatchObject({ submittedAttempts: 3, uncertain: 2 });
  expect(summary.groups.find((group) => group.inputKind === "inclusive")!.input).toMatchObject({ total: null, knownSubtotal: 10, reported: 1 });
  expect(summary.groups.find((group) => group.inputKind === "unknown")!.input.knownSubtotal).toBeNull();
});
test("prepared and cancelled-before-submit slots are not zero-token provider calls", () => {
  const summary = summarizePrivateUsage("branch", [receipt({ status: "prepared", submittedAt: null, result: null }),
    receipt({ id: "cancelled", status: "cancelled", submittedAt: null, result: null }),
    receipt({ id: "failed-local", status: "failed", submittedAt: null, result: null })]);
  expect(summary).toMatchObject({ ownReceipts: 3, pending: 1, submittedAttempts: 0, groups: [] });
});
test("legacy result usage remains readable and included detail counters are not added twice", () => {
  const summary = summarizePrivateUsage("branch", [receipt()]); const group = summary.groups[0]!;
  expect(group.input.total).toBe(10); expect(group.output.total).toBe(5);
  expect(group.cachedInput.total).toBe(2); expect(group.reasoning.total).toBe(3);
  expect(group.providerTotal.total).toBeNull();
});
test("connection, model and provider counter conventions stay in separate groups", () => {
  const summary = summarizePrivateUsage("branch", [receipt(), receipt({ id: "connection-2", connectionId: "other" }),
    receipt({ id: "model-2", request: { ...receipt().request, model: "different" } }),
    receipt({ id: "uncached", usage: { ...usage, tokenDetails: { ...usage.tokenDetails!, inputTokenKind: "uncached" } } }),
    receipt({ id: "candidates", usage: { ...usage, tokenDetails: { ...usage.tokenDetails!, outputTokenKind: "candidates", totalTokens: 22 } } })]);
  expect(summary.groups).toHaveLength(5);
  const candidates = summary.groups.find((group) => group.outputKind === "candidates")!;
  expect(candidates.output.total).toBe(5); expect(candidates.reasoning.total).toBe(3); expect(candidates.providerTotal.total).toBe(22);
});
