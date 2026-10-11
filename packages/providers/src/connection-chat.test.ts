import { expect, test, vi } from "vitest";
import { generateConnectionChatText } from "./private-text";
import { connectionTestParts, validateConnectionTestAttachments, connectionTestProviderError } from "./connection-test-media";
import { type ConnectionTestAttachment } from "@deliberation-ai/contracts";

const files: ConnectionTestAttachment[] = [
  { name: "pixel.png", mimeType: "image/png", data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64") },
  { name: "tiny.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.4\nfixture").toString("base64") },
  { name: "tone.wav", mimeType: "audio/wav", data: Buffer.from("RIFF1234WAVEfixture").toString("base64") },
];
test("test media validates bytes and maps native/image/audio/PDF parts without discarding inputs", () => {
  expect(validateConnectionTestAttachments(files)).toEqual(files);
  expect(connectionTestParts("openai-compatible", "Describe", files)).toMatchObject([{ type: "text" }, { type: "image_url" }, { type: "file" }, { type: "input_audio", input_audio: { format: "wav" } }]);
  expect(connectionTestParts("google", "Describe", files)).toMatchObject([{ text: "Describe" }, { inlineData: { mimeType: "image/png" } }, { inlineData: { mimeType: "application/pdf" } }, { inlineData: { mimeType: "audio/wav" } }]);
  expect(connectionTestParts("anthropic", "Describe", files.slice(0, 2))).toMatchObject([{ type: "text" }, { type: "image" }, { type: "document" }]);
  expect(connectionTestParts("openai", "Describe", files.slice(0, 2))).toMatchObject([{ type: "input_text" }, { type: "input_image" }, { type: "input_file" }]);
  expect(() => connectionTestParts("anthropic", "Describe", files)).toThrow(/ses/u);
  expect(() => validateConnectionTestAttachments([{ ...files[0]!, data: Buffer.from("wrong signature").toString("base64") }])).toThrow(/türü/u);
  expect(() => validateConnectionTestAttachments([{ ...files[0]!, data: Buffer.alloc(1_048_577).toString("base64") }])).toThrow();
});
test("file test sends native PDF and audio payload with one bounded provider call", async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.messages[1].content).toEqual(connectionTestParts("openai-compatible", "Describe", files));
    expect(body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "native" } }]);
    expect(body.max_completion_tokens).toBe(512);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "File fixture reply" }, finish_reason: "stop" }] }));
  });
  await expect(generateConnectionChatText({ model: "fixture", instructions: "Fixture", message: "Describe", attachments: files },
    { provider: "openai-compatible", baseUrl: "https://example.test/v1", apiKey: "synthetic", endpointPreset: "openrouter", operationKey: "fixture", fetch })).resolves.toMatchObject({ text: "File fixture reply" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
test("HTTP and HTTP-200 embedded provider failures expose safe codes, never raw reflected input", async () => {
  const diagnostic = connectionTestProviderError({ error: { code: 400, message: "image unsupported PRIVATE MESSAGE AND SECRET", metadata: { error_type: "unsupported_modality" } } }, 400)!;
  expect(diagnostic.diagnostic).toEqual({ detail: expect.stringContaining("görsel"), providerCode: "unsupported_modality" });
  expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE");
  const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ error: { code: 502, message: "PRIVATE BODY", metadata: { error_type: "provider_unavailable" } } }] })));
  await expect(generateConnectionChatText({ model: "fixture", instructions: "Fixture", message: "Describe" },
    { provider: "openai-compatible", baseUrl: "https://example.test/v1", apiKey: "synthetic", endpointPreset: "openrouter", operationKey: "fixture", fetch })).rejects.toMatchObject({ code: "provider_response_invalid", diagnostic: { providerCode: "provider_unavailable" } });
});
test("connection chat sends exactly two bounded messages without council formats or tools", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.messages).toEqual([{ role: "system", content: "Fixture instruction" }, { role: "user", content: "Fixture message" }]);
    expect(body.max_completion_tokens).toBe(512); expect(body.tools).toBeUndefined(); expect(body.response_format).toBeUndefined();
    expect(init?.redirect).toBe("error");
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Fixture reply" }, finish_reason: "stop" }] }));
  });
  const result = await generateConnectionChatText({ model: "fixture", instructions: "Fixture instruction", message: "Fixture message" },
    { baseUrl: "https://example.test/v1", apiKey: "synthetic", endpointPreset: "openrouter", operationKey: "fixture", timeoutMs: 45_000, fetch });
  expect(result.text).toBe("Fixture reply"); expect(fetch).toHaveBeenCalledTimes(1);
  await expect(generateConnectionChatText({ model: "fixture", instructions: "Fixture", message: "x".repeat(1201) },
    { baseUrl: "https://example.test/v1", apiKey: "", endpointPreset: "custom", operationKey: "fixture", fetch })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
