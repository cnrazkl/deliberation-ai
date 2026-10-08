import { expect, it, vi } from "vitest";
import { executeSynthesisText, synthesisTargetIdentity, type SynthesisTarget } from "./synthesis";
const target: SynthesisTarget = { provider: "openai-compatible", defaultModel: "offline-model", apiKey: "offline-fixture",
  baseUrl: "https://example.test/v1", endpointPreset: "custom", reasoningProtocol: "none", structuredOutputMode: "prompt-only" };
const input = { instructions: "Fixed synthesis instructions", data: "Untrusted frozen claims" };
const reply = { id: "offline-id", model: "offline-model", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "{\"paragraphs\":[]}" } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 } };
it("sends exactly the two reviewed texts, one request, fixed output cap and no tools or fabricated history", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(reply));
  const result = await executeSynthesisText(target, "offline-intent", input, fetch);
  expect(result).toMatchObject({ status: "returned", result: { inputTokens: 100, outputTokens: 20, finishReason: "stop" } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe("https://example.test/v1/chat/completions");
  expect(fetch.mock.calls[0]![1]!.redirect).toBe("error");
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ model: target.defaultModel, max_tokens: 4_096,
    messages: [{ role: "system", content: input.instructions }, { role: "user", content: input.data }] });
});
it.each(["openai", "anthropic", "google"] as const)("reuses the bounded %s native text transport without model tools", async (provider) => {
  const response = provider === "openai" ? { object: "response", id: "offline", model: "offline-model", status: "completed", output: [
    { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "{}" }] }] }
    : provider === "anthropic" ? { type: "message", role: "assistant", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }
    : { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "{}" }] } }] };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
  expect(await executeSynthesisText({ ...target, provider, baseUrl: undefined }, "offline-intent", input, fetch)).toMatchObject({ status: "returned" });
  expect(fetch).toHaveBeenCalledTimes(1); expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).not.toHaveProperty("tools");
});
it("rejects tools, alternate choices, wrong roles, redirects, server uncertainty and unfinished native output without retry or content leaks", async () => {
  for (const response of [Response.json({ ...reply, choices: [...reply.choices, ...reply.choices] }),
    Response.json({ ...reply, choices: [{ finish_reason: "stop", message: { role: "user", content: "private content" } }] }),
    Response.json({ ...reply, choices: [{ finish_reason: "stop", message: { role: "assistant", content: "private content", tool_calls: [{}] } }] }),
    new Response("private-error-fixture", { status: 401 }), new Response("private-error-fixture", { status: 503 })]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const result = await executeSynthesisText(target, "offline-intent", input, fetch);
    expect(result.status).toBe("failed"); expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/private-error-fixture|offline-fixture/);
    if (result.status === "failed" && result.code === "invalid_private_response") expect(result.rawText).toBeTruthy();
  }
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline-fixture"));
  expect(await executeSynthesisText(target, "offline-intent", input, fetch)).toMatchObject({ status: "failed", outcome: "unknown" });
  expect(fetch).toHaveBeenCalledTimes(1);
  const pending = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ object: "response", status: "in_progress" }));
  const { baseUrl: _base, ...native } = target;
  expect(await executeSynthesisText({ ...native, provider: "openai" }, "offline-intent", input, pending)).toMatchObject({ status: "failed", outcome: "unknown" });
  expect(pending).toHaveBeenCalledTimes(1);
});
it("normalizes equal endpoint identities and rejects credential/query URLs before fetch", async () => {
  expect(synthesisTargetIdentity(target)).toBe(synthesisTargetIdentity({ ...target, baseUrl: "https://EXAMPLE.test/v1/" }));
  expect(synthesisTargetIdentity(target)).not.toBe(synthesisTargetIdentity({ ...target, defaultModel: "different-model" }));
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const baseUrl of ["https://credential@example.test/v1", "https://example.test/v1?secret=x", "file:///tmp/example", "http://example.test/v1"]) {
    expect(await executeSynthesisText({ ...target, baseUrl }, "offline-intent", input, fetch)).toMatchObject({ status: "failed" });
  }
  expect(fetch).not.toHaveBeenCalled();
});
