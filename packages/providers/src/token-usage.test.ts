import { expect, test } from "vitest";
import { extractTokenUsage } from "./token-usage";

test("preserves inclusive OpenAI totals and cache/reasoning breakdown without double counting", () => {
  expect(extractTokenUsage("openai", { input_tokens: 100, output_tokens: 40, total_tokens: 140,
    input_tokens_details: { cached_tokens: 90, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 30 } }))
    .toEqual({ inputTokens: 100, outputTokens: 40, tokenDetails: { version: "provider-token-details-v1",
      inputTokenKind: "inclusive", outputTokenKind: "inclusive", totalTokens: 140,
      cachedInputTokens: 90, cacheWriteInputTokens: 0, reasoningTokens: 30 } });
});

test("keeps Claude uncached input and Gemini candidate output conventions distinct", () => {
  const claude = extractTokenUsage("anthropic", { input_tokens: 10, output_tokens: 20,
    cache_creation_input_tokens: 50, cache_read_input_tokens: 80, output_tokens_details: { thinking_tokens: 15 } });
  expect(claude.inputTokens).toBe(10);
  expect(claude.tokenDetails).toMatchObject({ inputTokenKind: "uncached", cachedInputTokens: 80, cacheWriteInputTokens: 50, reasoningTokens: 15 });
  expect(claude.tokenDetails.totalTokens).toBeUndefined();
  const gemini = extractTokenUsage("google", { promptTokenCount: 100, candidatesTokenCount: 12,
    thoughtsTokenCount: 30, cachedContentTokenCount: 70, toolUsePromptTokenCount: 5, totalTokenCount: 142 });
  expect(gemini.outputTokens).toBe(12);
  expect(gemini.tokenDetails).toMatchObject({ outputTokenKind: "candidates", reasoningTokens: 30, totalTokens: 142, toolInputTokens: 5 });
});

test("compatible fields remain provider-defined and invalid or absent counts stay unavailable", () => {
  const result = extractTokenUsage("openai-compatible", { prompt_tokens: "120", completion_tokens: -1,
    total_tokens: Infinity, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 1.5 } });
  expect(result).toEqual({ tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "provider_defined",
    outputTokenKind: "provider_defined", cachedInputTokens: 0 } });
  expect(extractTokenUsage("openai", null)).not.toHaveProperty("inputTokens");
});
