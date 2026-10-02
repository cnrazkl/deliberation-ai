import { describe, expect, test, vi } from "vitest";
import { checkProviderConnectionModels } from "./model-catalog";

const base = {
  provider: "openai" as const,
  endpointPreset: "custom" as const,
  apiKey: "private-test-key",
  defaultModel: "gpt-test",
};

describe("owner-triggered model catalog checks", () => {
  test("uses an authenticated read-only OpenAI list request without exposing the key", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ id: "gpt-test" }] })) as unknown as typeof fetch;
    const result = await checkProviderConnectionModels(base, fetcher);
    expect(result).toMatchObject({ status: "available", verification: "authenticated_catalog", models: ["gpt-test"], truncated: false });
    expect(result.details).toBeUndefined();
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/models");
    expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store" });
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer private-test-key");
    expect(JSON.stringify(result)).not.toContain("private-test-key");
    const customBase = await checkProviderConnectionModels({ ...base, baseUrl: "http://127.0.0.1:3001/v1" }, fetcher);
    expect(customBase.verification).toBe("catalog_only");
  });

  test("uses OpenRouter's user-filtered endpoint and distinguishes generic catalog-only checks", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ id: "vendor/model" }] })) as unknown as typeof fetch;
    const router = await checkProviderConnectionModels({ ...base, provider: "openai-compatible", endpointPreset: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }, fetcher);
    expect(String(vi.mocked(fetcher).mock.calls[0]![0])).toBe("https://openrouter.ai/api/v1/models/user?limit=300");
    expect(router.verification).toBe("authenticated_catalog");
    const routerOverride = await checkProviderConnectionModels({ ...base, provider: "openai-compatible", endpointPreset: "openrouter", baseUrl: "https://proxy.example.test/v1" }, fetcher);
    expect(routerOverride.verification).toBe("catalog_only");
    const generic = await checkProviderConnectionModels({ ...base, provider: "openai-compatible", baseUrl: "http://127.0.0.1:4000/v1", apiKey: "" }, fetcher);
    expect(String(vi.mocked(fetcher).mock.calls[2]![0])).toBe("http://127.0.0.1:4000/v1/models");
    expect((vi.mocked(fetcher).mock.calls[2]![1]?.headers as Record<string, string>).authorization).toBeUndefined();
    expect(generic.verification).toBe("catalog_only");
  });

  test("uses provider-native headers and excludes Gemini non-generation models", async () => {
    const fetcher = vi.fn(async () => Response.json({ models: [
      { name: "models/gemini-test", supportedActions: ["generateContent"], displayName: "Gemini Test", inputTokenLimit: 32_000, outputTokenLimit: 8_000, thinking: true },
      { name: "models/embed-test", supportedActions: ["embedContent"] },
    ] })) as unknown as typeof fetch;
    const result = await checkProviderConnectionModels({ ...base, provider: "google" }, fetcher);
    expect(result.models).toEqual(["gemini-test"]);
    expect(result.details).toEqual([{ id: "gemini-test", displayName: "Gemini Test", inputTokenLimit: 32_000, outputTokenLimit: 8_000, thinking: true }]);
    expect(String(vi.mocked(fetcher).mock.calls[0]![0])).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100");
    expect((vi.mocked(fetcher).mock.calls[0]![1]?.headers as Record<string, string>)["x-goog-api-key"]).toBe("private-test-key");
    const anthropicFetcher = vi.fn(async () => Response.json({ data: [{ id: "claude-test", display_name: "Claude Test", max_input_tokens: 200_000, max_tokens: 64_000, capabilities: { effort: { low: { supported: true }, medium: { supported: false }, high: { supported: true }, max: { supported: true } } } }], has_more: true })) as unknown as typeof fetch;
    const anthropic = await checkProviderConnectionModels({ ...base, provider: "anthropic" }, anthropicFetcher);
    expect(anthropic.truncated).toBe(true);
    expect(anthropic.details).toEqual([{ id: "claude-test", displayName: "Claude Test", inputTokenLimit: 200_000, outputTokenLimit: 64_000, reasoningLevels: ["low", "high", "max"] }]);
    expect((vi.mocked(anthropicFetcher).mock.calls[0]![1]?.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
  });

  test("does not interpret missing list support, authentication rejection or oversized output as generation results", async () => {
    const connection = { ...base, provider: "openai-compatible" as const, baseUrl: "https://example.test/v1" };
    expect((await checkProviderConnectionModels(connection, async () => new Response(null, { status: 404 }))).status).toBe("unsupported");
    expect((await checkProviderConnectionModels(connection, async () => new Response(null, { status: 401 }))).status).toBe("auth_failed");
    expect((await checkProviderConnectionModels(connection, async () => new Response(null, { status: 302, headers: { location: "https://other.test/models" } }))).status).toBe("unavailable");
    const tooLarge = new Response("x".repeat(4 * 1024 * 1024 + 1));
    expect((await checkProviderConnectionModels(connection, async () => tooLarge)).status).toBe("unavailable");
    expect((await checkProviderConnectionModels({ ...connection, baseUrl: "ftp://example.test/v1" }, vi.fn())).status).toBe("unsupported");
  });

  test("bounds the returned model suggestions and identifies incomplete catalogs", async () => {
    const data = Array.from({ length: 305 }, (_, index) => ({ id: `model-${index}` }));
    const result = await checkProviderConnectionModels(base, async () => Response.json({ data }));
    expect(result.status).toBe("available");
    expect(result.models).toHaveLength(300);
    expect(result.truncated).toBe(true);
  });

  test("shows only documented OpenRouter catalog metadata and ignores custom metadata claims", async () => {
    const model = { id: "vendor/model", name: "Vendor Model", context_length: 128_000, supported_parameters: ["reasoning", "max_tokens"], pricing: { prompt: "999" } };
    const official = await checkProviderConnectionModels({ ...base, provider: "openai-compatible", endpointPreset: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }, async () => Response.json({ data: [model], total_count: 2 }));
    expect(official.details).toEqual([{ id: "vendor/model", displayName: "Vendor Model", contextWindowTokens: 128_000, reasoningParameterListed: true }]);
    expect(official.truncated).toBe(true);
    expect(JSON.stringify(official)).not.toContain("pricing");
    const custom = await checkProviderConnectionModels({ ...base, provider: "openai-compatible", baseUrl: "https://example.test/v1" }, async () => Response.json({ data: [model] }));
    expect(custom.details).toBeUndefined();
  });
});
