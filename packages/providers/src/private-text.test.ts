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
