import { expect, test, vi } from "vitest";
import type { SaveProviderConnectionRequest } from "@deliberation-ai/contracts";
import { boundedCheckFetch, createGenerationCheckProvider, generationCheckPrompt, generationCheckRequest } from "./generation-check";
import { NormalizedProviderError } from "./index";
import { generatePrivateText } from "./private-text";
const output = { summary: "Dört.", claims: [{ statement: "2 + 2 = 4", kind: "shared", quote: "2 + 2 = 4" }] };
const target: SaveProviderConnectionRequest = { provider: "openai-compatible", label: "Fixture", defaultModel: "fixture-model",
  apiKey: "synthetic-key", baseUrl: "https://example.test/v1", endpointPreset: "custom", reasoningProtocol: "none", structuredOutputMode: "json-object" };

test("recovery generation fence refuses all four adapter families before fetch", async () => {
  vi.stubEnv("DELIBERATION_RECOVERY_FORBID_GENERATION", "true");
  try {
    for (const provider of ["openai-compatible", "openai", "anthropic", "google"] as const) {
      const fetcher = vi.fn<typeof fetch>();
      await expect(createGenerationCheckProvider({ ...target, provider }, fetcher).generate(generationCheckRequest("fixture"))).rejects.toMatchObject({ code: "recovery_generation_disabled", outcome: "known" });
      await expect(generatePrivateText({ version: "private-text-v1", model: "fixture", maxOutputTokens: 128, messages: Array.from({ length: 4 }, () => ({ role: "user" as const, content: "Synthetic request" })) }, {
        provider, baseUrl: "https://example.test/v1", apiKey: "synthetic-key", endpointPreset: "custom", operationKey: "fixture", fetch: fetcher,
      })).rejects.toMatchObject({ code: "recovery_generation_disabled", outcome: "known" });
      expect(fetcher).not.toHaveBeenCalled();
    }
  } finally { vi.unstubAllEnvs(); }
});

test("uses fixed content and one bounded request through all four council adapter families", async () => {
  for (const provider of ["openai-compatible", "openai", "anthropic", "google"] as const) {
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const text = JSON.stringify(output);
      const response = provider === "openai-compatible" ? { id: "fixture", model: "fixture-model", choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20 } }
        : provider === "openai" ? { id: "resp_fixture", model: "fixture-model", status: "completed", output: [{ id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }
        : provider === "anthropic" ? { id: "fixture", model: "fixture-model", stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 20 } }
        : { responseId: "fixture", modelVersion: "fixture-model", candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } };
      return Response.json(response);
    });
    const result = await createGenerationCheckProvider({ ...target, provider }, fetcher).generate(generationCheckRequest("fixture-operation"));
    expect(result.parsed).toEqual(output);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = requests[0]!;
    expect(provider === "google" ? (body.generationConfig as Record<string, unknown>).maxOutputTokens
      : provider === "openai" ? body.max_output_tokens : body.max_tokens).toBe(512);
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/owner question|attachments|memory input/u);
  }
  expect(generationCheckPrompt().timeoutMs).toBe(45_000);
  expect(generationCheckPrompt().user).toContain("2 + 2");
});

test("retains known/unknown errors without an automatic retry", async () => {
  for (const status of [401, 500]) {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ raw: "SENSITIVE" }, { status }));
    const error = await createGenerationCheckProvider(target, fetcher).generate(generationCheckRequest("fixture")).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect((error as NormalizedProviderError).outcome).toBe(status === 401 ? "known" : "unknown");
    expect((error as Error).message).not.toContain("SENSITIVE");
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

test("bounds response bytes and refuses redirects before returning provider text", async () => {
  let cancelled = false;
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.redirect).toBe("error");
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65_537)); }, cancel() { cancelled = true; } }));
  });
  await expect(boundedCheckFetch(fetcher)("https://example.test")).rejects.toThrow("Generation check response unavailable.");
  expect(cancelled).toBe(true);
});

test("uses the documented lowest level for Gemini 3.7/3.8 Flash while preserving older model mappings", async () => {
  for (const [model, expected] of [["gemini-3.8-flash", "low"], ["gemini-3.7-flash", "low"], ["gemini-3-flash-preview", "minimal"]]) {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe(expected);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] }, finishReason: "STOP" }] });
    });
    await createGenerationCheckProvider({ ...target, provider: "google", reasoningProtocol: "gemini-level", defaultModel: model! }, fetcher)
      .generate(generationCheckRequest("fixture"));
  }
});
