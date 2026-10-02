import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { closeDatabase } from "@deliberation-ai/persistence";

test("checks a saved local catalog only on click and offers its models to council members", async ({ page, request }) => {
  const calls: string[] = [];
  const server: Server = createServer((incoming, outgoing) => {
    calls.push(incoming.url ?? "");
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ data: [{ id: "local-model-a", display_name: "Do not trust custom metadata", capabilities: { effort: { max: { supported: true } } } }, { id: "local-model-b" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local catalog server did not bind.");
  let connectionId: string | undefined;
  try {
    const saved = await request.post("/api/provider-connections", { data: {
      provider: "openai-compatible",
      label: `E2E catalog ${crypto.randomUUID()}`,
      apiKey: "",
      defaultModel: "local-model-a",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      endpointPreset: "litellm",
      reasoningProtocol: "none",
      structuredOutputMode: "json-object",
    } });
    expect(saved.ok()).toBe(true);
    connectionId = (await saved.json() as { id: string }).id;

    await page.goto("/");
    await page.getByText(/Yerel sağlayıcı bağlantıları/).click();
    expect(calls).toEqual([]);
    const card = page.locator(".connection-status").filter({ hasText: "E2E catalog" });
    await card.getByRole("button", { name: "Model listesini kontrol et" }).click();
    await expect(card.getByRole("status")).toContainText("2 model kimliği listelendi");
    await expect(card.getByRole("status")).toContainText("API anahtarı doğrulanmış sayılmaz");
    expect(calls).toEqual(["/v1/models"]);
    await page.getByLabel("Üye 1 bağlantısı").selectOption(connectionId);
    await expect(page.getByLabel("Üye 1 modeli")).toHaveAttribute("list", `connection-models-${connectionId}`);
    const modelField = page.getByLabel("Üye 1 modeli").locator("..");
    await expect(modelField).not.toContainText("Do not trust custom metadata");

    await page.reload();
    await page.getByText(/Yerel sağlayıcı bağlantıları/).click();
    await expect(card.getByRole("status")).toContainText("2 model kimliği listelendi");
    expect(calls).toHaveLength(1);
    await page.getByLabel("Üye 1 bağlantısı").selectOption(connectionId);
    await expect(page.getByLabel("Üye 1 modeli")).toHaveAttribute("list", `connection-models-${connectionId}`);

    await page.route(`**/api/provider-connections/${connectionId}/models`, async (route) => {
      await route.fulfill({ json: {
        status: "available",
        verification: "authenticated_catalog",
        models: ["local-model-a"],
        details: [{ id: "local-model-a", displayName: "Katalog modeli", inputTokenLimit: 32_000, reasoningLevels: ["low", "high"] }],
        checkedAt: "2026-09-27T00:00:00.000Z",
        truncated: false,
      } });
    });
    await card.getByRole("button", { name: "Model listesini kontrol et" }).click();
    await expect(modelField).toContainText("Katalog modeli");
    await expect(modelField).toContainText("Düşük, Yüksek");

    const foreignOrigin = await request.post(`/api/provider-connections/${connectionId}/models`, { headers: { origin: "https://untrusted.example" } });
    expect(foreignOrigin.status()).toBe(403);
    expect(calls).toHaveLength(1);
  } finally {
    if (connectionId) await request.delete(`/api/provider-connections?id=${encodeURIComponent(connectionId)}`);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closeDatabase();
  }
});
