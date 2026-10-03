import { revealCouncilControls, workspaceView } from "./workspace-navigation";
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
  let secondConnectionId: string | undefined;
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
    const second = await request.post("/api/provider-connections", { data: {
      provider: "openai-compatible", label: `E2E editor ${crypto.randomUUID()}`,
      apiKey: "", defaultModel: "local-model-a", baseUrl: `http://127.0.0.1:${address.port}/v1`,
      endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object",
    } });
    expect(second.ok()).toBe(true);
    secondConnectionId = (await second.json() as { id: string }).id;

    await page.goto("/"); await revealCouncilControls(page);
    await workspaceView(page, "Ayarlar");
    await page.getByText(/Yerel sağlayıcı bağlantıları/).click();
    expect(calls).toEqual([]);
    const card = page.locator(".connection-status").filter({ hasText: "E2E catalog" });
    await card.getByRole("button", { name: "Model listesini kontrol et" }).click();
    await expect(card.getByRole("status")).toContainText("2 model kimliği listelendi");
    await expect(card.getByRole("status")).toContainText("API anahtarı doğrulanmış sayılmaz");
    expect(calls).toEqual(["/v1/models"]);
    const connectionCard = page.locator(".connection-card").filter({ hasText: "E2E catalog" });
    const picker = connectionCard.getByRole("combobox", { name: /katalog modeli/ });
    await expect(picker.locator("option")).toHaveText(["Başlangıç modeli seçin", "local-model-a", "local-model-b"]);
    await picker.selectOption("local-model-b");
    const editor = connectionCard.getByRole("region", { name: /bağlantısını düzenle/ });
    await expect(editor.getByLabel("Başlangıç modeli (görev sırasında değiştirilebilir)")).toHaveValue("local-model-b");
    await editor.getByLabel("Bağlantı adı", { exact: true }).fill("Unsaved catalog name");
    await picker.selectOption("local-model-a");
    await expect(editor.getByLabel("Bağlantı adı", { exact: true })).toHaveValue("Unsaved catalog name");
    await connectionCard.getByRole("button", { name: "Düzenle", exact: true }).click();
    await expect(editor.getByLabel("Bağlantı adı", { exact: true })).toHaveValue("Unsaved catalog name");
    const secondCard = page.locator(".connection-card").filter({ hasText: "E2E editor" });
    await secondCard.getByRole("button", { name: "Düzenle", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(secondCard.locator(".connection-editor")).toBeVisible();
    await expect(page.locator(".connection-form")).toHaveCount(1);
    await expect(secondCard.getByLabel("API anahtarı", { exact: true })).toHaveValue("");
    await connectionCard.getByRole("button", { name: "Düzenle", exact: true }).click();
    await editor.getByRole("button", { name: "Düzenlemeyi iptal et" }).click();
    await expect(editor).toHaveCount(0);
    expect(calls).toHaveLength(1);
    await workspaceView(page, "Sohbet");
    await page.getByLabel("Üye 1 bağlantısı").selectOption(connectionId);
    await expect(page.getByLabel("Üye 1 modeli")).toHaveAttribute("list", `connection-models-${connectionId}`);
    const modelField = page.getByLabel("Üye 1 modeli").locator("..");
    await expect(modelField).not.toContainText("Do not trust custom metadata");

    await page.reload(); await revealCouncilControls(page);
    await workspaceView(page, "Ayarlar");
    await page.getByText(/Yerel sağlayıcı bağlantıları/).click();
    await expect(card.getByRole("status")).toContainText("2 model kimliği listelendi");
    expect(calls).toHaveLength(1);
    await workspaceView(page, "Sohbet");
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
    await workspaceView(page, "Ayarlar");
    await card.getByRole("button", { name: "Model listesini kontrol et" }).click();
    await expect(modelField).toContainText("Katalog modeli");
    await expect(modelField).toContainText("Düşük, Yüksek");
    await expect(picker.locator("option")).toHaveText(["Başlangıç modeli seçin", "local-model-a"]);
    await connectionCard.getByRole("button", { name: "Düzenle", exact: true }).click();
    await expect(editor).toBeVisible();
    await editor.getByLabel("Başlangıç modeli (görev sırasında değiştirilebilir)").fill("local-model-b");
    await editor.getByRole("button", { name: "Bağlantıyı güncelle" }).click();
    await expect(editor).toHaveCount(0);
    await expect(card).toContainText("varsayılan local-model-b");
    await expect(page.getByLabel("Üye 1 modeli")).toHaveValue("local-model-a");
    await expect(picker).toHaveCount(0);
    await card.getByRole("button", { name: "Model listesini kontrol et" }).click();
    await expect(picker).toHaveValue("");
    await page.setViewportSize({ width: 390, height: 844 });
    await connectionCard.getByRole("button", { name: "Düzenle", exact: true }).click();
    await expect(editor).toBeVisible();
    const box = await connectionCard.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    await editor.getByRole("button", { name: "Düzenlemeyi iptal et" }).click();

    const foreignOrigin = await request.post(`/api/provider-connections/${connectionId}/models`, { headers: { origin: "https://untrusted.example" } });
    expect(foreignOrigin.status()).toBe(403);
    expect(calls).toHaveLength(1);
  } finally {
    if (secondConnectionId) await request.delete(`/api/provider-connections?id=${encodeURIComponent(secondConnectionId)}`);
    if (connectionId) await request.delete(`/api/provider-connections?id=${encodeURIComponent(connectionId)}`);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closeDatabase();
  }
});
