import { expect, test, vi } from "vitest";
import { generatePrivateText } from "./private-text";
import { NormalizedProviderError } from "./index";
import type { PrivateDeliveryRequest } from "@deliberation-ai/contracts";
const input: PrivateDeliveryRequest = { version: "private-text-v1", model: "offline-model", maxOutputTokens: 1_024,
  messages: [{ role: "system", content: "Private reply" }, { role: "user", content: "Source" }, { role: "assistant", content: "Selected reply" }, { role: "user", content: "Follow-up" }] };
const options = { baseUrl: "https://example.test/v1", apiKey: "not-sent", endpointPreset: "custom", operationKey: "offline-intent" };
test("sends bounded plain text with a stable intent, no tools and OpenRouter cap translation", async () => {
  for (const endpointPreset of ["custom", "openrouter"]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ id: "reply-one", model: "observed-model",
      choices: [{ finish_reason: "length", message: { content: "Partial private reply" } }], usage: { prompt_tokens: 13, completion_tokens: 3 } }));
    const value = await generatePrivateText(input, { ...options, endpointPreset, fetch });
    expect(value).toMatchObject({ text: "Partial private reply", inputTokens: 13, outputTokens: 3, finishReason: "length" });
    const [, init] = fetch.mock.calls[0]!;
    expect(init!.redirect).toBe("error");
    expect(init!.headers).toMatchObject({ "idempotency-key": "offline-intent" });
    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({ model: input.model, messages: input.messages, [endpointPreset === "openrouter" ? "max_completion_tokens" : "max_tokens"]: 1_024 });
  }
});
test("invalid text retains observed usage without leaking failed content", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ id: "invalid-reply", choices: [{ message: { content: "x".repeat(16_385) } }],
    usage: { prompt_tokens: 20, completion_tokens: 8 } }));
  const error = await generatePrivateText(input, { ...options, fetch }).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(NormalizedProviderError);
  expect(error).toMatchObject({ code: "invalid_private_response", outcome: "known", metadata: { inputTokens: 20, outputTokens: 8 } });
  expect(JSON.stringify(error)).not.toContain("metadata");
  expect(JSON.stringify(error)).not.toContain("xxxxxxxxxx");
});
test("rejects tools, oversize and malformed responses; network interruption stays unknown", async () => {
  const responses = [Response.json({ choices: [{ message: { content: "reply", tool_calls: [] } }] }), new Response("bad-json"), new Response("x".repeat(131_073))];
  for (const response of responses) await expect(generatePrivateText(input, { ...options, fetch: vi.fn().mockResolvedValue(response) })).rejects.toBeInstanceOf(NormalizedProviderError);
  await expect(generatePrivateText(input, { ...options, fetch: vi.fn().mockRejectedValue(new Error("connection lost")) })).rejects.toMatchObject({ outcome: "unknown" });
  const fetch = vi.fn();
  await expect(generatePrivateText({ ...input, maxOutputTokens: 2_000 } as unknown as PrivateDeliveryRequest, { ...options, fetch })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

const anthropicOptions = { ...options, provider: "anthropic" as const, baseUrl: "https://api.anthropic.com", apiKey: "offline-key" };
const anthropicReply = { type: "message", role: "assistant", id: "offline-claude-reply", model: "offline-claude",
  content: [{ type: "text", text: "Private " }, { type: "text", text: "answer" }], stop_reason: "end_turn",
  usage: { input_tokens: 11, output_tokens: 4, cache_read_input_tokens: 7, cache_creation_input_tokens: 2 } };

test("Anthropic translates only the leading system turn, preserves text/order and normalizes additive cache usage", async () => {
  const messages = [...input.messages, { role: "user" as const, content: "Second owner draft, without an invented reply" }];
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(anthropicReply));
  const result = await generatePrivateText({ ...input, messages }, { ...anthropicOptions, fetch });
  expect(result).toMatchObject({ text: "Private answer", model: "offline-claude", remoteResponseId: "offline-claude-reply", finishReason: "stop",
    inputTokens: 11, outputTokens: 4, tokenDetails: { inputTokenKind: "uncached", cachedInputTokens: 7, cacheWriteInputTokens: 2 } });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe("https://api.anthropic.com/v1/messages");
  expect(init!.redirect).toBe("error");
  expect(init!.headers).toEqual({ "content-type": "application/json", "idempotency-key": options.operationKey,
    "x-api-key": "offline-key", "anthropic-version": "2023-06-01" });
  expect(JSON.parse(init!.body as string)).toEqual({ model: input.model, system: messages[0]!.content, messages: messages.slice(1), max_tokens: 1_024 });
});

test("Anthropic output truncation and absent/invalid counts remain distinct from a complete reply or zero usage", async () => {
  const result = await generatePrivateText(input, { ...anthropicOptions,
    fetch: vi.fn().mockResolvedValue(Response.json({ ...anthropicReply, stop_reason: "max_tokens", usage: { input_tokens: -1 } })) });
  expect(result).toMatchObject({ text: "Private answer", finishReason: "length", inputTokens: null, outputTokens: null,
    tokenDetails: { inputTokenKind: "uncached", outputTokenKind: "inclusive" } });
  expect(result.tokenDetails?.cachedInputTokens).toBeUndefined();
});

test("Anthropic refuses tools/thinking/refusals, empty or malformed blocks and excessive joined text; observed usage survives", async () => {
  const invalid = [null, [], { ...anthropicReply, content: [] }, { ...anthropicReply, content: {} },
    { ...anthropicReply, content: [{ type: "text", text: "" }] },
    ...["tool_use", "thinking", "redacted_thinking"].map((type) => ({ ...anthropicReply, content: [...anthropicReply.content, { type, text: "untrusted private content" }] })),
    { ...anthropicReply, stop_reason: "tool_use" }, { ...anthropicReply, stop_reason: "refusal" },
    { ...anthropicReply, content: [{ type: "text", text: "x".repeat(8_193) }, { type: "text", text: "y".repeat(8_192) }] }];
  for (const response of invalid) {
    const error = await generatePrivateText(input, { ...anthropicOptions, fetch: vi.fn().mockResolvedValue(Response.json(response)) }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid_private_response", outcome: "known" });
    if (response && !Array.isArray(response)) expect(error).toMatchObject({ metadata: { provider: "anthropic", inputTokens: 11, outputTokens: 4 } });
    expect(JSON.stringify(error)).not.toMatch(/untrusted private content|metadata|offline-key|xxxxxxxx/);
  }
});

test("Anthropic rejects instruction reordering, assistant prefill, unsupported providers and changed caps before fetch", async () => {
  const invalid = [
    { ...input, messages: input.messages.map((item) => ({ ...item, role: item.role === "system" ? "user" as const : item.role })) },
    { ...input, messages: [...input.messages, { role: "system" as const, content: "later instruction" }, { role: "user" as const, content: "question" }] },
    { ...input, messages: [...input.messages, { role: "assistant" as const, content: "prefill" }] },
    { ...input, maxOutputTokens: 2_000 },
  ];
  const fetch = vi.fn();
  for (const request of invalid) await expect(generatePrivateText(request as PrivateDeliveryRequest, { ...anthropicOptions, fetch })).rejects.toThrow();
  await expect(generatePrivateText(input, { ...anthropicOptions, provider: "google" as "anthropic", fetch })).rejects.toMatchObject({ code: "unsupported_private_provider" });
  expect(fetch).not.toHaveBeenCalled();
});

test("Anthropic HTTP/malformed/oversize failures are bounded and never retried; disconnect/deadline remains unknown", async () => {
  for (const response of [new Response("private-error-key", { status: 401 }), new Response("bad-json"), new Response("x".repeat(131_073))]) {
    const fetch = vi.fn().mockResolvedValue(response);
    const error = await generatePrivateText(input, { ...anthropicOptions, fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect(JSON.stringify(error)).not.toContain("private-error-key");
    expect(fetch).toHaveBeenCalledTimes(1);
  }
  const fetch = vi.fn().mockRejectedValue(new Error("network offline-key"));
  await expect(generatePrivateText(input, { ...anthropicOptions, fetch })).rejects.toMatchObject({ outcome: "unknown", retryable: false });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(generatePrivateText(input, { ...anthropicOptions, timeoutMs: 5, fetch: vi.fn(() => new Promise<Response>(() => {})) })).rejects.toMatchObject({ outcome: "unknown" });
});
