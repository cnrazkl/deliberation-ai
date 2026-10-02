import { expect, test } from "vitest";
import { addTokenDetails, emptyTokenDetailTotals, readTokenDetails } from "./provider-usage";

test("keeps absent counters unavailable, reports real zero, and exposes only the allow-listed details", () => {
  const totals = emptyTokenDetailTotals();
  addTokenDetails(totals, null);
  expect(totals.totalTokens).toEqual({ reportedTokens: null, reportCount: 0 });
  const details = readTokenDetails({ rawText: "private", tokenDetails: { version: "provider-token-details-v1",
    inputTokenKind: "inclusive", outputTokenKind: "inclusive", cachedInputTokens: 0, totalTokens: 12 } });
  addTokenDetails(totals, details);
  addTokenDetails(totals, readTokenDetails({ tokenDetails: { ...details, totalTokens: 7 } }));
  expect(totals.totalTokens).toEqual({ reportedTokens: 19, reportCount: 2 });
  expect(totals.cachedInputTokens).toEqual({ reportedTokens: 0, reportCount: 2 });
  expect(totals.reasoningTokens).toEqual({ reportedTokens: null, reportCount: 0 });
  expect(JSON.stringify(details)).not.toContain("private");
  expect(readTokenDetails({ tokenDetails: { ...details, totalTokens: -1 } })).toBeNull();
});
