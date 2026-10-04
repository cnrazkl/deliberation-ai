import { expect, test } from "vitest";
import { summarizeConversationCouncilUsage as summarize, type CouncilUsageRecord } from "./conversation-council-usage";
const record: CouncilUsageRecord = { id: "operation", provider: "fixture", model: "requested", round: 0, status: "succeeded",
  inputTokens: 0, outputTokens: 5, tokenDetails: null };
test("council usage counts receipts, including unknown and pending coverage, without inventing sends", () => {
  const summary = summarize([record, { ...record, id: "pending", status: "prepared", inputTokens: null, outputTokens: null }]);
  expect(summary).toMatchObject({ operationCount: 2, pending: 1 });
  expect(summary.groups[0]!.input).toEqual({ reported: 1, attempts: 2, knownSubtotal: 0, total: null });
});
test("rounds, models, providers and counting conventions remain separate", () => {
  expect(summarize([record, { ...record, id: "round", round: 1 }, { ...record, id: "model", model: "other" },
    { ...record, id: "provider", provider: "other" }, { ...record, id: "kind", tokenDetails: { version: "provider-token-details-v1",
      inputTokenKind: "uncached", outputTokenKind: "inclusive", cachedInputTokens: 10 } }]).groups).toHaveLength(5);
});
test("duplicate identity or invalid counters refuse a misleading summary", () => {
  expect(() => summarize([record, record])).toThrow();
  expect(() => summarize([{ ...record, inputTokens: -1 }])).toThrow();
  expect(() => summarize([{ ...record, inputTokens: Number.MAX_SAFE_INTEGER },
    { ...record, id: "overflow", inputTokens: 1 }])).toThrow();
  expect(summarize([{ ...record, status: "retry_authorized" }])).toMatchObject({ uncertain: 1, pending: 1 });
});
