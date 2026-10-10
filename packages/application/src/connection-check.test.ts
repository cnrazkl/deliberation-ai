import { expect, test, vi } from "vitest";
import type { SaveProviderConnectionRequest } from "@deliberation-ai/contracts";
import { executeGenerationCheck, generateConnectionChatText, NormalizedProviderError } from "@deliberation-ai/providers";
import { executeBoundedConnectionChat, executeBoundedConnectionCheck } from "./connection-check";
vi.mock("@deliberation-ai/providers", async (original) => ({ ...await original<object>(), executeGenerationCheck: vi.fn(), generateConnectionChatText: vi.fn() }));
const target: SaveProviderConnectionRequest = { provider: "openai-compatible", label: "Fixture", defaultModel: "fixture",
  apiKey: "synthetic", endpointPreset: "custom", baseUrl: "https://example.test", reasoningProtocol: "none", structuredOutputMode: "json-object" };
test("projects only bounded observed metadata and retains unknown counts without text", async () => {
  vi.mocked(executeGenerationCheck).mockResolvedValueOnce({ rawText: "SENSITIVE RAW", parsed: { summary: "Fixture", claims: [{ statement: "4", kind: "shared", quote: "4" }] },
    metadata: { provider: "fixture", model: "m".repeat(121), remoteResponseId: "r".repeat(513), inputTokens: -1, outputTokens: 700 } });
  const result = await executeBoundedConnectionCheck(target, "fixture");
  expect(result).toEqual({ status: "succeeded", failure: null, httpStatus: null, returnedModel: null, remoteResponseId: null, inputTokens: null, outputTokens: 700 });
  expect(JSON.stringify(result)).not.toContain("SENSITIVE");
});
test("chat sends only the reviewed single message through a bounded plain-text transport", async () => {
  vi.mocked(generateConnectionChatText).mockResolvedValueOnce({ text: "Fixture reply", model: "fixture", remoteResponseId: null,
    inputTokens: null, outputTokens: 8, tokenDetails: null, finishReason: "length" });
  const result = await executeBoundedConnectionChat(target, "intent", "Short fixture question");
  expect(result).toMatchObject({ status: "succeeded", reply: "Fixture reply", replyTruncated: true, inputTokens: null });
  expect(vi.mocked(generateConnectionChatText).mock.calls.at(-1)).toEqual([
    { model: "fixture", instructions: expect.any(String), message: "Short fixture question" },
    { provider: "openai-compatible", apiKey: "synthetic", baseUrl: "https://example.test", endpointPreset: "custom", operationKey: "intent", timeoutMs: 45000 },
  ]);
});
test("chat returns safe HTTP and transport codes without raw provider error bodies", async () => {
  for (const [code, outcome, status, expected] of [["private_compatible_429", "known", "failed", "provider_http_429"], ["provider_dns_failure", "unknown", "outcome_unknown", "provider_dns_failure"]] as const) {
    vi.mocked(generateConnectionChatText).mockRejectedValueOnce(new NormalizedProviderError("SECRET RAW ERROR", code, outcome, false));
    const result = await executeBoundedConnectionChat(target, "intent", "Fixture");
    expect(result).toMatchObject({ status, errorCode: expected });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  }
});
test("classifies known rejection and ambiguous network errors without provider messages", async () => {
  vi.mocked(executeGenerationCheck).mockRejectedValueOnce(new NormalizedProviderError("SENSITIVE", "gemini_402", "known", false));
  expect(await executeBoundedConnectionCheck(target, "fixture")).toMatchObject({ status: "failed", failure: "rejected", httpStatus: 402 });
  vi.mocked(executeGenerationCheck).mockRejectedValueOnce(new Error("SENSITIVE"));
  expect(await executeBoundedConnectionCheck(target, "fixture")).toMatchObject({ status: "outcome_unknown", failure: "network_unknown", httpStatus: null });
});
