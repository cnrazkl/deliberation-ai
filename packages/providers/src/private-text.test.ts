import { expect, test, vi } from "vitest";
import { generatePrivateText } from "./private-text";
import { NormalizedProviderError } from "./index";
import type { PrivateDeliveryRequest } from "@deliberation-ai/contracts";
const input: PrivateDeliveryRequest = { version: "private-text-v1", model: "offline-model", maxOutputTokens: 1_024,
  messages: [{ role: "system", content: "Private reply" }, { role: "user", content: "Source" }, { role: "assistant", content: "Selected reply" }, { role: "user", content: "Follow-up" }] };
const options = { baseUrl: "https://example.test/v1", apiKey: "not-sent", endpointPreset: "custom", operationKey: "offline-intent" };
const googleOptions = { ...options, provider: "google" as const, baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "offline-key" };
const googleCandidate = { content: { role: "model", parts: [{ text: "Private " }, { text: "answer", thought: false, thoughtSignature: "opaque-fixture-state" }] }, finishReason: "STOP" };
const googleReply = { modelVersion: "offline-gemini", responseId: "offline-google-reply", candidates: [googleCandidate],
  usageMetadata: { promptTokenCount: 21, candidatesTokenCount: 8, cachedContentTokenCount: 6, thoughtsTokenCount: 3, totalTokenCount: 32 } };

test("private output allowance admits the lower bound and rejects invalid limits before network", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(googleReply));
  await generatePrivateText({ ...input, maxOutputTokens: 128 }, { ...googleOptions, fetch });
  expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body)).generationConfig.maxOutputTokens).toBe(128);
  fetch.mockClear();
  for (const maxOutputTokens of [127, 1025, 128.5, NaN]) {
    await expect(generatePrivateText({ ...input, maxOutputTokens }, { ...googleOptions, fetch })).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("Gemini sends exact stateless text/order and header credentials, preserves candidate/thought conventions and drops opaque state", async () => {
  const messages = [...input.messages, { role: "user" as const, content: "Another owner draft" }];
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(googleReply));
  const result = await generatePrivateText({ ...input, messages }, { ...googleOptions, fetch });
  expect(result).toMatchObject({ text: "Private answer", model: "offline-gemini", remoteResponseId: "offline-google-reply", finishReason: "stop", inputTokens: 21, outputTokens: 8,
    tokenDetails: { inputTokenKind: "inclusive", outputTokenKind: "candidates", cachedInputTokens: 6, reasoningTokens: 3, totalTokens: 32 } });
  expect(JSON.stringify(result)).not.toContain("opaque-fixture-state");
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/offline-model:generateContent");
  expect(init!.redirect).toBe("error");
  expect(init!.headers).toEqual({ "content-type": "application/json", "idempotency-key": "offline-intent", "x-goog-request-id": "offline-intent", "x-goog-api-key": "offline-key" });
  expect(JSON.parse(init!.body as string)).toEqual({ systemInstruction: { parts: [{ text: messages[0]!.content }] },
    contents: messages.slice(1).map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] })),
    generationConfig: { candidateCount: 1, maxOutputTokens: 1_024, responseMimeType: "text/plain" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("Gemini marks partial output caps, retains missing counts as unknown and records cap-without-text usage", async () => {
  const result = await generatePrivateText(input, { ...googleOptions, fetch: vi.fn().mockResolvedValue(Response.json({ ...googleReply,
    usageMetadata: { promptTokenCount: -1 }, candidates: [{ ...googleCandidate, finishReason: "MAX_TOKENS" }] })) });
  expect(result).toMatchObject({ text: "Private answer", finishReason: "length", inputTokens: null, outputTokens: null });
  expect(result.tokenDetails?.reasoningTokens).toBeUndefined();
  for (const content of [undefined, { role: "model", parts: [] }, { role: "model", parts: [{ text: "" }] }]) {
    await expect(generatePrivateText(input, { ...googleOptions, fetch: vi.fn().mockResolvedValue(Response.json({ ...googleReply,
      candidates: [{ finishReason: "MAX_TOKENS", content }] })) })).rejects.toMatchObject({ code: "private_output_limit_without_text", outcome: "known",
      metadata: { provider: "google", inputTokens: 21, outputTokens: 8 } });
  }
});

test("Gemini rejects thought/tool/media/unknown parts, blocked safety, multiple candidates and excessive joined text without content leaks", async () => {
  const invalid = [null, [], { ...googleReply, candidates: [] }, { ...googleReply, candidates: [googleCandidate, googleCandidate] },
    { ...googleReply, error: { message: "private-error-key" } }, { ...googleReply, promptFeedback: { blockReason: "SAFETY" } },
    { ...googleReply, promptFeedback: { safetyRatings: [{ blocked: true }] } },
    ...[{ groundingMetadata: {} }, { urlContextMetadata: {} }, { groundingAttributions: [{}] }].map((extra) => ({ ...googleReply, candidates: [{ ...googleCandidate, ...extra }] })),
    ...["SAFETY", "RECITATION", "OTHER", "MALFORMED_FUNCTION_CALL"].map((finishReason) => ({ ...googleReply, candidates: [{ ...googleCandidate, finishReason }] })),
    ...[{ thought: true }, { functionCall: {} }, { inlineData: {} }, { fileData: {} }, { executableCode: {} }, { toolCall: {} }, { futurePart: true }]
      .map((extra) => ({ ...googleReply, candidates: [{ ...googleCandidate, content: { role: "model", parts: [{ text: "private-error-key", ...extra }] } }] })),
    { ...googleReply, candidates: [{ ...googleCandidate, safetyRatings: [{ blocked: true }] }] },
    { ...googleReply, candidates: [{ ...googleCandidate, content: { role: "user", parts: [{ text: "private-error-key" }] } }] },
    { ...googleReply, candidates: [{ ...googleCandidate, content: { role: "model", parts: [{ text: "x".repeat(8_193) }, { text: "y".repeat(8_192) }] } }] },
    { ...googleReply, candidates: [{ finishReason: "STOP" }] },
  ];
  for (const value of invalid) {
    const error = await generatePrivateText(input, { ...googleOptions, fetch: vi.fn().mockResolvedValue(Response.json(value)) }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid_private_response", outcome: "known" });
    if (value && !Array.isArray(value)) expect(error).toMatchObject({ metadata: { provider: "google", inputTokens: 21, outputTokens: 8 } });
    expect(JSON.stringify(error)).not.toMatch(/private-error-key|opaque-fixture-state|metadata|offline-key|xxxxxxxx/);
  }
});

test("Gemini unfinished candidate stays unknown without polling or retry", async () => {
  for (const finishReason of [undefined, "FINISH_REASON_UNSPECIFIED"]) {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...googleReply, candidates: [{ ...googleCandidate, finishReason }] }));
    await expect(generatePrivateText(input, { ...googleOptions, fetch })).rejects.toMatchObject({ code: "private_remote_pending", outcome: "unknown", retryable: false,
      metadata: { inputTokens: 21, outputTokens: 8 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

test("Gemini validates native instruction/order/prefill/cap before fetch and encodes the exact model segment", async () => {
  const fetch = vi.fn();
  for (const request of [{ ...input, messages: input.messages.slice(1) },
    { ...input, messages: [...input.messages, { role: "system" as const, content: "Later instruction" }, { role: "user" as const, content: "Question" }] },
    { ...input, messages: [...input.messages, { role: "assistant" as const, content: "Prefill" }] }, { ...input, maxOutputTokens: 2_000 }]) {
    await expect(generatePrivateText(request as PrivateDeliveryRequest, { ...googleOptions, fetch })).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockResolvedValue(Response.json(googleReply));
  await generatePrivateText({ ...input, model: "exact/model?name" }, { ...googleOptions, fetch });
  expect(fetch.mock.calls[0]![0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/exact%2Fmodel%3Fname:generateContent");
});

test("Gemini HTTP/body/deadline failures are bounded, secret-free and never retried", async () => {
  for (const response of [new Response("private-error-key", { status: 401 }), new Response("bad-json"), new Response("x".repeat(131_073))]) {
    const fetch = vi.fn().mockResolvedValue(response);
    const error = await generatePrivateText(input, { ...googleOptions, fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect(JSON.stringify(error)).not.toContain("private-error-key");
    expect(fetch).toHaveBeenCalledTimes(1);
  }
  for (const fetch of [vi.fn().mockRejectedValue(new Error("offline-key")), vi.fn(() => new Promise<Response>(() => {}))]) {
    await expect(generatePrivateText(input, { ...googleOptions, fetch, timeoutMs: 5 })).rejects.toMatchObject({ outcome: "unknown", retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
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

const openaiOptions = { ...options, provider: "openai" as const, baseUrl: "https://api.openai.com/v1", apiKey: "offline-key" };
const openaiMessage = { type: "message", role: "assistant", status: "completed", phase: "final_answer",
  content: [{ type: "output_text", text: "Private ", annotations: [] }, { type: "output_text", text: "answer", annotations: [] }] };
const openaiReply = { object: "response", id: "offline-openai-reply", model: "offline-openai", status: "completed", error: null, incomplete_details: null,
  output: [{ type: "reasoning", summary: [], content: [], encrypted_content: "opaque-fixture-state" }, openaiMessage],
  usage: { input_tokens: 21, output_tokens: 8, total_tokens: 29, input_tokens_details: { cached_tokens: 6 }, output_tokens_details: { reasoning_tokens: 3 } } };

test("OpenAI sends exact stateless turns with final assistant phases, no storage/automatic truncation and native inclusive usage", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(openaiReply));
  const result = await generatePrivateText(input, { ...openaiOptions, fetch });
  expect(result).toMatchObject({ text: "Private answer", remoteResponseId: "offline-openai-reply", finishReason: "stop", inputTokens: 21, outputTokens: 8,
    tokenDetails: { inputTokenKind: "inclusive", outputTokenKind: "inclusive", totalTokens: 29, cachedInputTokens: 6, reasoningTokens: 3 } });
  expect(JSON.stringify(result)).not.toContain("opaque-fixture-state");
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe("https://api.openai.com/v1/responses");
  expect(init!.redirect).toBe("error");
  expect(init!.headers).toEqual({ "content-type": "application/json", "idempotency-key": "offline-intent", authorization: "Bearer offline-key" });
  expect(JSON.parse(init!.body as string)).toEqual({ model: input.model,
    input: input.messages.map((item) => item.role === "assistant" ? { ...item, phase: "final_answer" } : item),
    max_output_tokens: 1_024, store: false, background: false, stream: false, truncation: "disabled", text: { format: { type: "text" } } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("OpenAI preserves ordered message text, marks output-cap truncation and keeps absent usage unknown", async () => {
  const result = await generatePrivateText(input, { ...openaiOptions, fetch: vi.fn().mockResolvedValue(Response.json({ ...openaiReply, usage: {},
    status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [openaiMessage, { ...openaiMessage, status: "incomplete",
      content: [{ type: "output_text", text: " — partial", annotations: [] }] }] })) });
  expect(result).toMatchObject({ text: "Private answer — partial", finishReason: "length", inputTokens: null, outputTokens: null });
  expect(result.tokenDetails?.reasoningTokens).toBeUndefined();
  const error = await generatePrivateText(input, { ...openaiOptions, fetch: vi.fn().mockResolvedValue(Response.json({ ...openaiReply,
    status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [openaiReply.output[0]] })) }).catch((e: unknown) => e);
  expect(error).toMatchObject({ code: "private_output_limit_without_text", outcome: "known", metadata: { inputTokens: 21, outputTokens: 8 } });
});

test("OpenAI refuses tools/refusals/commentary/visible reasoning, mismatched statuses and malformed or excessive text without leaking raw content", async () => {
  const invalid = [null, [], { ...openaiReply, output: [] }, { ...openaiReply, output_text: "Do not trust the SDK shortcut", output: undefined },
    { ...openaiReply, error: { message: "private-error-key" } },
    { ...openaiReply, status: "failed" }, { ...openaiReply, status: "cancelled" },
    { ...openaiReply, status: "incomplete", incomplete_details: { reason: "content_filter" } },
    { ...openaiReply, status: "incomplete" },
    ...["function_call", "web_search_call", "future_item"].map((type) => ({ ...openaiReply, output: [openaiMessage, { type, text: "private-error-key" }] })),
    ...[{ phase: "commentary" }, { status: "in_progress" }, { status: "incomplete" }, { role: "user" },
      { content: [{ type: "refusal", refusal: "private-error-key" }] },
      { content: [{ type: "output_text", text: "private-error-key", annotations: [{ type: "url_citation" }] }] },
      { content: [{ type: "output_text", text: "x".repeat(16_385) }] },
    ].map((change) => ({ ...openaiReply, output: [{ ...openaiMessage, ...change }] })),
    { ...openaiReply, output: [openaiMessage, { type: "reasoning", summary: [{ type: "summary_text", text: "private-error-key" }] }] },
    { ...openaiReply, output: [openaiMessage, { type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "private-error-key" }] }] },
  ];
  for (const response of invalid) {
    const error = await generatePrivateText(input, { ...openaiOptions, fetch: vi.fn().mockResolvedValue(Response.json(response)) }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid_private_response", outcome: "known" });
    if (response && !Array.isArray(response)) expect(error).toMatchObject({ metadata: { provider: "openai", inputTokens: 21, outputTokens: 8 } });
    expect(JSON.stringify(error)).not.toMatch(/private-error-key|metadata|offline-key|xxxxxxxx/);
  }
});

test("OpenAI remote queued/in-progress receipts stay unknown with observed usage and no follow-up fetch", async () => {
  for (const status of ["queued", "in_progress"]) {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...openaiReply, status }));
    await expect(generatePrivateText(input, { ...openaiOptions, fetch })).rejects.toMatchObject({ code: "private_remote_pending", outcome: "unknown", retryable: false,
      metadata: { remoteResponseId: "offline-openai-reply", inputTokens: 21 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

test("OpenAI refuses reordered native instructions, assistant prefills and changed caps before fetch", async () => {
  const fetch = vi.fn();
  for (const request of [{ ...input, messages: input.messages.slice(1) },
    { ...input, messages: [...input.messages, { role: "system" as const, content: "Later instruction" }, { role: "user" as const, content: "Question" }] },
    { ...input, messages: [...input.messages, { role: "assistant" as const, content: "Prefill" }] }, { ...input, maxOutputTokens: 2_000 }]) {
    await expect(generatePrivateText(request as PrivateDeliveryRequest, { ...openaiOptions, fetch })).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("OpenAI HTTP/body limits and deadlines never retry or expose provider error content", async () => {
  for (const response of [new Response("private-error-key", { status: 401 }), new Response("bad-json"), new Response("x".repeat(131_073))]) {
    const fetch = vi.fn().mockResolvedValue(response);
    const error = await generatePrivateText(input, { ...openaiOptions, fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect(JSON.stringify(error)).not.toContain("private-error-key");
    expect(fetch).toHaveBeenCalledTimes(1);
  }
  for (const fetch of [vi.fn().mockRejectedValue(new Error("offline-key")), vi.fn(() => new Promise<Response>(() => {}))]) {
    await expect(generatePrivateText(input, { ...openaiOptions, fetch, timeoutMs: 5 })).rejects.toMatchObject({ outcome: "unknown", retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

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
  await expect(generatePrivateText(input, { ...anthropicOptions, provider: "unsupported" as "anthropic", fetch })).rejects.toMatchObject({ code: "unsupported_private_provider" });
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
