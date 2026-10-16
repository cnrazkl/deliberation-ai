import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, test } from "vitest";
import { AnthropicMessagesProvider } from "./anthropic-messages-provider";
import { GeminiGenerateContentProvider } from "./gemini-generate-content-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import { OpenAIResponsesProvider } from "./openai-responses-provider";

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

// Local HTTP fixtures exercise real fetch/SDK redirect behavior without model calls.
test.each([307, 308])("council providers refuse HTTP %i without forwarding credentials or prompts", async (status) => {
  let forwardedRequests = 0;
  let originalRequests = 0;
  const destination = createServer((_request, response) => {
    forwardedRequests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const destinationUrl = await listen(destination);
  const source = createServer((_request, response) => {
    originalRequests += 1;
    response.writeHead(status, { location: destinationUrl });
    response.end();
  });
  const baseUrl = await listen(source);
  try {
    const options = { apiKey: "fixture-key", baseUrl, model: "fixture-model", id: "member-a", label: "Fixture",
      councilRole: "analyst" as const, reasoningLevel: "default" as const, reasoningProtocol: "none" as const,
      timeoutMs: 1_000 };
    const providers = [new AnthropicMessagesProvider(options), new GeminiGenerateContentProvider(options),
      new OpenAICompatibleProvider({ ...options, endpointPreset: "custom", structuredOutputMode: "json-object" }),
      new OpenAIResponsesProvider(options)];
    for (const provider of providers) {
      await expect(provider.generate({ memberId: "member-a", role: "analyst", councilRole: "analyst", round: 0,
        operationId: "fixture-operation", input: { snapshotId: "fixture-snapshot", question: "Private fixture question" } }))
        .rejects.toMatchObject({ outcome: "unknown", retryable: false });
      expect(forwardedRequests).toBe(0);
    }
    expect(originalRequests).toBe(providers.length);
  } finally {
    await close(source);
    await close(destination);
  }
});
