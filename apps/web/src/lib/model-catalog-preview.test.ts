import { describe, expect, it } from "vitest";
import { CatalogPreviewRequestError, readCatalogPreviewRequest } from "./model-catalog-preview";

function request(body: unknown) { return new Request("http://localhost/api/provider-connections/model-preview", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}); }
const cloud = { provider: "openai", apiKey: "synthetic-test-key", endpointPreset: "custom" };

describe("transient model catalog request boundary", () => {
  it("does not require a model, connection name or saved identity", async () => {
    expect(await readCatalogPreviewRequest(request({ ...cloud, apiKey: " synthetic-test-key " }))).toEqual(cloud);
    expect(await readCatalogPreviewRequest(request({ provider: "openai-compatible", endpointPreset: "ollama", baseUrl: "http://127.0.0.1:11434/v1" }))).toEqual({
      provider: "openai-compatible", endpointPreset: "ollama", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "",
    });
  });
  it.each([
    { ...cloud, apiKey: "" }, { ...cloud, apiKey: "a".repeat(513) }, { ...cloud, id: "foreign-connection" },
    { ...cloud, provider: "fake" }, { ...cloud, endpointPreset: "ollama", apiKey: "" },
    { ...cloud, baseUrl: "not-a-url" }, { ...cloud, baseUrl: "file:///secret" }, { ...cloud, baseUrl: "https://name:secret@example.com" },
    { provider: "openai-compatible", apiKey: "synthetic", endpointPreset: "custom" },
    { provider: "openai-compatible", apiKey: "synthetic", endpointPreset: "nvidia", baseUrl: "https://other.example/v1" },
  ])("rejects malformed or credential-bearing configuration with a content-free error", async body => {
    await expect(readCatalogPreviewRequest(request(body))).rejects.toMatchObject({ status: 400, message: "Model listesi isteği geçersiz." });
  });
  it("accepts the fixed hosted NVIDIA catalog without requiring inference settings", async () => {
    await expect(readCatalogPreviewRequest(request({ provider: "openai-compatible", apiKey: "synthetic", endpointPreset: "nvidia", baseUrl: "https://integrate.api.nvidia.com/v1" }))).resolves.toMatchObject({ endpointPreset: "nvidia" });
  });
  it("bounds streamed input even without a Content-Length header", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(4_096)); controller.enqueue(new Uint8Array(4_097)); },
      cancel() { cancelled = true; },
    });
    const streamed = new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    await expect(readCatalogPreviewRequest(streamed)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
  it("rejects malformed JSON and incorrect media types without echoing input", async () => {
    const invalid = new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "synthetic-private-input" });
    await expect(readCatalogPreviewRequest(invalid)).rejects.toBeInstanceOf(CatalogPreviewRequestError);
    await expect(readCatalogPreviewRequest(new Request("http://localhost", { method: "POST", body: "synthetic-private-input" }))).rejects.toMatchObject({ status: 415 });
  });
});
