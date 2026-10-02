import { providerTokenDetailsSchema, type ProviderTokenDetails } from "@deliberation-ai/contracts";

export const tokenDetailFields = ["totalTokens", "cachedInputTokens", "cacheWriteInputTokens", "reasoningTokens", "toolInputTokens"] as const;
export type TokenDetailField = typeof tokenDetailFields[number];
export type TokenDetailTotals = Record<TokenDetailField, { reportedTokens: number | null; reportCount: number }>;

/** Allow-list only counts/conventions; never project response text, ids, or citations. */
export function readTokenDetails(metadata: unknown): ProviderTokenDetails | null {
  if (!metadata || typeof metadata !== "object") return null;
  const parsed = providerTokenDetailsSchema.safeParse((metadata as Record<string, unknown>).tokenDetails);
  return parsed.success ? parsed.data : null;
}

export function emptyTokenDetailTotals(): TokenDetailTotals {
  return Object.fromEntries(tokenDetailFields.map((key) => [key, { reportedTokens: null, reportCount: 0 }])) as TokenDetailTotals;
}

export function addTokenDetails(totals: TokenDetailTotals, details: ProviderTokenDetails | null): void {
  if (!details) return;
  for (const key of tokenDetailFields) {
    const value = details[key];
    if (value === undefined) continue;
    const metric = totals[key];
    // A provider-reported zero counts as reported; missing never does.
    metric.reportedTokens = (metric.reportedTokens ?? 0) + value;
    metric.reportCount += 1;
  }
}
