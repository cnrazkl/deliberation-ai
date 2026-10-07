import { expect, test, vi } from "vitest";
import type { SaveProviderConnectionRequest } from "@deliberation-ai/contracts";
import { executeGenerationCheck, NormalizedProviderError } from "@deliberation-ai/providers";
import { executeBoundedConnectionCheck } from "./connection-check";
vi.mock("@deliberation-ai/providers", async (original) => ({ ...await original<object>(), executeGenerationCheck: vi.fn() }));
const target: SaveProviderConnectionRequest = { provider: "openai-compatible", label: "Fixture", defaultModel: "fixture",
  apiKey: "synthetic", endpointPreset: "custom", baseUrl: "https://example.test", reasoningProtocol: "none", structuredOutputMode: "json-object" };
test("projects only bounded observed metadata and retains unknown counts without text", async () => {
  vi.mocked(executeGenerationCheck).mockResolvedValueOnce({ rawText: "SENSITIVE RAW", parsed: { summary: "Fixture", claims: [{ statement: "4", kind: "shared", quote: "4" }] },
    metadata: { provider: "fixture", model: "m".repeat(121), remoteResponseId: "r".repeat(513), inputTokens: -1, outputTokens: 700 } });
  const result = await executeBoundedConnectionCheck(target, "fixture");
  expect(result).toEqual({ status: "succeeded", failure: null, httpStatus: null, returnedModel: null, remoteResponseId: null, inputTokens: null, outputTokens: 700 });
  expect(JSON.stringify(result)).not.toContain("SENSITIVE");
});
test("classifies known rejection and ambiguous network errors without provider messages", async () => {
  vi.mocked(executeGenerationCheck).mockRejectedValueOnce(new NormalizedProviderError("SENSITIVE", "gemini_402", "known", false));
  expect(await executeBoundedConnectionCheck(target, "fixture")).toMatchObject({ status: "failed", failure: "rejected", httpStatus: 402 });
  vi.mocked(executeGenerationCheck).mockRejectedValueOnce(new Error("SENSITIVE"));
  expect(await executeBoundedConnectionCheck(target, "fixture")).toMatchObject({ status: "outcome_unknown", failure: "network_unknown", httpStatus: null });
});
