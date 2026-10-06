import { expect, test, vi } from "vitest";
import { NVIDIA_HOSTED_BASE_URL, saveProviderConnectionSchema } from "@deliberation-ai/contracts";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import { checkProviderConnectionModels } from "./model-catalog";
import { generatePrivateText } from "./private-text";

const settings = { provider: "openai-compatible" as const, endpointPreset: "nvidia" as const,
  label: "Offline NVIDIA", apiKey: "offline-fixture-key", defaultModel: "vendor/manual-model",
  baseUrl: NVIDIA_HOSTED_BASE_URL, reasoningProtocol: "none" as const, structuredOutputMode: "prompt-only" as const };
const request = { memberId: "member-a", role: "analist", councilRole: "analyst" as const, round: 0 as const,
  operationId: "offline-operation", maxOutputTokens: 512,
  input: { snapshotId: "snapshot-a", question: "Yeterince uzun bir test sorusu" } };
const output = { summary: "Özet", claims: [{ statement: "İddia", kind: "recommendation", quote: "İddia" }] };
const reply = { choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } };
const privateRequest = { version: "private-text-v1" as const, model: "vendor/manual-model", maxOutputTokens: 512,
  messages: [{ role: "system" as const, content: "Private reply" }, { role: "user" as const, content: "Source" },
    { role: "assistant" as const, content: "Selected answer" }, { role: "user" as const, content: "Private question" }] };
const providerOptions = { ...settings, model: settings.defaultModel, id: "member-a", councilRole: "analyst" as const, reasoningLevel: "default" as const };

test("NVIDIA save contract requires explicit hosted identity, key and model", () => {
  expect(saveProviderConnectionSchema.parse(settings).endpointPreset).toBe("nvidia");
  for (const change of [{ apiKey: "" }, { defaultModel: " " }, { baseUrl: "https://example.test/v1" },
    { baseUrl: `${NVIDIA_HOSTED_BASE_URL}/` }, { provider: "openai" }, { reasoningProtocol: "reasoning-effort" },
    { structuredOutputMode: "json-object" }]) {
    expect(saveProviderConnectionSchema.safeParse({ ...settings, ...change }).success).toBe(false);
  }
});

test("NVIDIA sends exact manual model and bounded text-only JSON prompt, preserving usage", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(reply));
  const result = await new OpenAICompatibleProvider({ ...providerOptions, fetch }).generate(request);
  expect(result).toMatchObject({ parsed: output, metadata: { provider: "openai-compatible", model: settings.defaultModel, inputTokens: 12, outputTokens: 3 } });
  const [url, options] = fetch.mock.calls[0]!;
  expect(url).toBe(`${NVIDIA_HOSTED_BASE_URL}/chat/completions`);
  expect(options).toMatchObject({ redirect: "error", headers: { authorization: `Bearer ${settings.apiKey}` } });
  const body = JSON.parse(String(options!.body));
  expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model"]);
  expect(body).toMatchObject({ model: settings.defaultModel, max_tokens: 512 });
  expect(body.messages.map((message: { role: string }) => message.role)).toEqual(["system", "user"]);
});

test("NVIDIA malformed council output retains raw text and observed usage", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ ...reply, choices: [{ message: { content: "malformed" } }] }));
  await expect(new OpenAICompatibleProvider({ ...providerOptions, fetch }).generate(request)).rejects.toMatchObject({
    code: "provider_response_invalid", rawText: "malformed", metadata: { inputTokens: 12, outputTokens: 3 } });
});

test.each([202, 503])("NVIDIA HTTP %s stays unknown without automatic retry in council and private paths", async (status) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ requestId: "pending-fixture" }, { status }));
  await expect(new OpenAICompatibleProvider({ ...providerOptions, fetch }).generate(request)).rejects.toMatchObject({ outcome: "unknown", retryable: false });
  await expect(generatePrivateText(privateRequest, { ...settings, operationKey: "offline-private", fetch })).rejects.toMatchObject({ outcome: "unknown", retryable: false });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("NVIDIA missing usage stays absent and private output remains plain text", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: "Private answer" }, finish_reason: "stop" }] }));
  const result = await generatePrivateText(privateRequest, { ...settings, operationKey: "offline-private", fetch });
  expect(result).toMatchObject({ text: "Private answer" });
  expect(result.inputTokens).toBeNull(); expect(result.outputTokens).toBeNull();
  expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ model: settings.defaultModel, messages: privateRequest.messages, max_tokens: 512 });
});

test("NVIDIA catalog is optional, unverified metadata is ignored, and failures preserve manual entry", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: [{ id: "vendor/listed-model", context_length: 99999, supported_parameters: ["reasoning"], capabilities: { vision: true } }] }));
  const result = await checkProviderConnectionModels(settings, fetch);
  expect(result).toMatchObject({ status: "available", verification: "catalog_only", models: ["vendor/listed-model"] });
  expect(result.details).toBeUndefined();
  expect(String(fetch.mock.calls[0]![0])).toBe(`${NVIDIA_HOSTED_BASE_URL}/models`);
  fetch.mockResolvedValue(new Response(null, { status: 404 }));
  expect(await checkProviderConnectionModels(settings, fetch)).toMatchObject({ status: "unsupported", verification: "none" });
  fetch.mockResolvedValue(new Response(null, { status: 401 }));
  expect(await checkProviderConnectionModels(settings, fetch)).toMatchObject({ status: "auth_failed" });
  expect(settings.defaultModel).toBe("vendor/manual-model");
});

test("NVIDIA incompatible targets and unverified reasoning fail before any request", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(new OpenAICompatibleProvider({ ...providerOptions, baseUrl: "https://example.test/v1", fetch }).generate(request)).rejects.toMatchObject({ outcome: "known" });
  await expect(new OpenAICompatibleProvider({ ...providerOptions, reasoningLevel: "high", fetch }).generate(request)).rejects.toMatchObject({ code: "nvidia_settings_not_supported" });
  await expect(new OpenAICompatibleProvider({ ...providerOptions, webSearchMode: "auto", fetch }).generate(request)).rejects.toMatchObject({ code: "web_search_not_supported" });
  await expect(new OpenAICompatibleProvider({ ...providerOptions, receivesAttachments: true, fetch }).generate({ ...request,
    input: { ...request.input, attachments: [{ name: "fixture.png", mimeType: "image/png", dataBase64: "aGVsbG8=", sha256: "a".repeat(64) }] },
  })).rejects.toMatchObject({ code: "nvidia_settings_not_supported" });
  await expect(generatePrivateText(privateRequest, { ...settings, baseUrl: "https://example.test/v1", operationKey: "offline-private", fetch })).rejects.toMatchObject({ outcome: "known" });
  expect(await checkProviderConnectionModels({ ...settings, baseUrl: "https://example.test/v1" }, fetch)).toMatchObject({ status: "unsupported" });
  expect(fetch).not.toHaveBeenCalled();
});
