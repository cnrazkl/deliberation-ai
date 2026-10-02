import type { ProviderTokenDetails } from "@deliberation-ai/contracts";

export function validTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647
    ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Raw native counts: Claude cache counts are additive; Gemini candidates exclude thoughts. */
export function extractTokenUsage(provider: "openai" | "anthropic" | "google" | "openai-compatible", value: unknown) {
  const usage = record(value);
  const compatible = provider === "openai-compatible";
  const inputDetails = record(usage[compatible ? "prompt_tokens_details" : "input_tokens_details"]);
  const outputDetails = record(usage[compatible ? "completion_tokens_details" : "output_tokens_details"]);
  const fields: Record<string, unknown> = provider === "google" ? {
    inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount, cachedInputTokens: usage.cachedContentTokenCount,
    reasoningTokens: usage.thoughtsTokenCount, toolInputTokens: usage.toolUsePromptTokenCount,
  } : provider === "anthropic" ? {
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens, cacheWriteInputTokens: usage.cache_creation_input_tokens,
    reasoningTokens: outputDetails.thinking_tokens,
  } : {
    inputTokens: usage[compatible ? "prompt_tokens" : "input_tokens"],
    outputTokens: usage[compatible ? "completion_tokens" : "output_tokens"], totalTokens: usage.total_tokens,
    cachedInputTokens: inputDetails.cached_tokens, cacheWriteInputTokens: inputDetails.cache_write_tokens,
    reasoningTokens: outputDetails.reasoning_tokens,
  };
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(fields)) {
    const valid = validTokenCount(value);
    if (valid !== undefined) counts[key] = valid;
  }
  const { inputTokens, outputTokens, ...details } = counts;
  const tokenDetails: ProviderTokenDetails = {
    version: "provider-token-details-v1",
    inputTokenKind: provider === "anthropic" ? "uncached" : compatible ? "provider_defined" : "inclusive",
    outputTokenKind: provider === "google" ? "candidates" : compatible ? "provider_defined" : "inclusive",
    ...details,
  };
  return { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}), tokenDetails };
}
