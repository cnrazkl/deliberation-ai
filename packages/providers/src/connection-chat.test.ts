import { expect, test, vi } from "vitest";
import { generateConnectionChatText } from "./private-text";
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
