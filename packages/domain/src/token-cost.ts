import type { PriceSnapshot, ProviderTokenDetails, TokenCostEstimate } from "@deliberation-ai/contracts";

export function picoUsdToUsd(value: bigint): string {
  const digits = value.toString().padStart(13, "0");
  return `${digits.slice(0, -12)}.${digits.slice(-12)}`;
}
function microsPerMillion(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
}
export function estimateTokenCost(input: {
  price: PriceSnapshot | null; inputTokens: number | null; outputTokens: number | null;
  details: ProviderTokenDetails | null; usageFingerprint: string; submitted: boolean; returnedModel?: string;
}): TokenCostEstimate {
  const price = input.price;
  const base: TokenCostEstimate = { version: "token-cost-v1", status: "unavailable", currency: "USD",
    amountPicoUsd: null, amountUsd: null, reason: null, priceSnapshotId: price?.id ?? null,
    priceFingerprint: price?.fingerprint ?? null, usageFingerprint: input.usageFingerprint, components: [],
    exclusions: ["tools", "cache_write", "storage", "tiers_and_modalities", "discounts", "tax", "invoice_reconciliation"] };
  const unavailable = (reason: string): TokenCostEstimate => ({ ...base, reason });
  if (!input.submitted) return { ...base, status: "not_submitted", reason: "no_submission" };
  if (!price) return unavailable("price_unavailable_at_submission");
  if (input.returnedModel !== price.model) return unavailable("returned_model_unconfirmed");
  const { inputTokens, outputTokens, details } = input;
  if (inputTokens === null || outputTokens === null || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)
    || inputTokens < 0 || outputTokens < 0 || !details) return unavailable("usage_incomplete");
  if ((details.inputTokenKind !== "provider_defined" && details.inputTokenKind !== price.inputBasis)
    || (details.outputTokenKind !== "provider_defined" && details.outputTokenKind !== price.outputBasis)) return unavailable("counting_convention_mismatch");
  // Missing cache counts cannot silently become zero. Mixed cache-write TTL is not available in v1 receipts.
  if (details.cachedInputTokens === undefined || (price.inputBasis === "uncached" && details.cacheWriteInputTokens === undefined)) return unavailable("cache_usage_incomplete");
  if ((details.cacheWriteInputTokens ?? 0) > 0) return unavailable("cache_write_breakdown_unavailable");
  const cached = details.cachedInputTokens;
  if (!Number.isSafeInteger(cached) || cached < 0 || (price.inputBasis === "inclusive" && cached > inputTokens)) return unavailable("invalid_cache_usage");
  if (cached > 0 && price.cachedInputUsdPerMillion === undefined) return unavailable("cache_price_unavailable");
  if ((price.inputBasis === "inclusive" ? inputTokens : inputTokens + cached) > price.maxInputTokens) return unavailable("price_input_band_exceeded");
  let output = outputTokens;
  if (price.outputBasis === "candidates") {
    if (details.reasoningTokens === undefined) return unavailable("reasoning_usage_incomplete");
    output += details.reasoningTokens;
    if (!Number.isSafeInteger(output) || details.reasoningTokens < 0) return unavailable("invalid_reasoning_usage");
  }
  const components: TokenCostEstimate["components"] = [];
  const add = (kind: TokenCostEstimate["components"][number]["kind"], tokens: number, usdPerMillion: string) => {
    components.push({ kind, tokens, usdPerMillion, amountPicoUsd: (BigInt(tokens) * microsPerMillion(usdPerMillion)).toString() });
  };
  add("input", price.inputBasis === "inclusive" ? inputTokens - cached : inputTokens, price.inputUsdPerMillion);
  if (cached > 0) add("cached_input", cached, price.cachedInputUsdPerMillion!);
  add("output", output, price.outputUsdPerMillion);
  const total = components.reduce((sum, component) => sum + BigInt(component.amountPicoUsd), BigInt(0));
  return { ...base, status: "estimated", components, amountPicoUsd: total.toString(), amountUsd: picoUsdToUsd(total) };
}
