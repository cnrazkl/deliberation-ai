import { withOwner, closeDatabase } from "@deliberation-ai/persistence";
import { revealCouncilControls, workspaceView } from "./workspace-navigation";
import { createServer } from "node:http";
import { expect, test, testOwnerId } from "./authenticated-test";
import { addConnectionModels, openConnectionPanel } from "./connection-model-selection";

test("saved catalog supports multiple models, preserves drafts and keeps connection choices separate", async ({ page, request }, testInfo) => withOwner(testOwnerId(), async () => {
  const calls: string[] = [];
  const server = createServer((incoming, outgoing) => {
    calls.push(incoming.url ?? ""); outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ data: [{ id: "local-model-a", display_name: "Do not trust custom metadata" }, { id: "local-model-b" }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Catalog did not bind.");
  const settings = { provider: "openai-compatible", apiKey: "", baseUrl: `http://127.0.0.1:${address.port}/v1`, endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object" };
  const ids: string[] = [];
  try {
    for (const label of ["E2E catalog", "E2E editor"]) {
      const saved = await request.post("/api/provider-connections", { data: { ...settings, label, defaultModel: "local-model-a" } });
      expect(saved.ok()).toBe(true); ids.push((await saved.json()).id);
    }
    await page.goto("/"); await revealCouncilControls(page); await page.getByLabel("Sorunuz", { exact: true }).fill("Keep this draft and the selected model.");
    await workspaceView(page, "Ayarlar");
    expect(calls).toEqual([]);
    const card = page.locator(".connection-card").filter({ hasText: "E2E catalog" });
    const panel = await openConnectionPanel(page, card, "Modeller");
    await panel.getByRole("button", { name: "Model listesini kontrol et" }).click();
    await expect(panel.getByRole("status")).toContainText("2 model kimliği listelendi");
    await expect(panel.getByRole("status")).toContainText("API anahtarı doğrulanmış sayılmaz");
    expect(calls).toEqual(["/v1/models"]);
    const choices = panel.locator(".saved-connection-models").filter({ visible: true });
    await addConnectionModels(choices, ["local-model-a", "local-model-b"]);
    await panel.getByRole("button", { name: "Model Seçimini Kaydet", exact: true }).click();
    await expect(choices.getByRole("status")).toContainText("Model seçimleri kaydedildi");
    await panel.getByRole("tab", { name: "Bağlantı", exact: true }).click();
    const editor = panel.locator(".connection-form");
    await editor.getByLabel("Bağlantı adı", { exact: true }).fill("Unsaved catalog name");
    await panel.getByRole("tab", { name: "Modeller", exact: true }).click();
    await panel.getByRole("tab", { name: "Bağlantı", exact: true }).click();
    await expect(editor.getByLabel("Bağlantı adı", { exact: true })).toHaveValue("Unsaved catalog name");
    const second = page.locator(".connection-card").filter({ hasText: "E2E editor" });
    await panel.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await openConnectionPanel(page, second);
    await expect(editor.getByLabel("Bağlantı adı", { exact: true })).toHaveValue("E2E editor");
    await expect(editor.getByLabel("API anahtarı", { exact: true })).toHaveValue("");
    await panel.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await workspaceView(page, "Sohbet"); await page.getByLabel("Üye 1 bağlantısı").selectOption(ids[0]!);
    await page.getByLabel("Üye 1 modeli").selectOption("local-model-a");
    const model = page.getByLabel("Üye 1 modeli");
    await expect(model).toHaveJSProperty("tagName", "SELECT");
    await expect(model.locator("option")).toHaveText(["Bağlantıdan bir model seçin", "local-model-a", "local-model-b"]);
    await expect(model.locator("..")).not.toContainText("Do not trust custom metadata");
    await workspaceView(page, "Ayarlar");
    await openConnectionPanel(page, card, "Modeller");
    await addConnectionModels(choices, ["local-model-a", "local-model-b"]);
    await panel.getByRole("checkbox", { name: "local-model-a", exact: true }).uncheck();
    await panel.getByRole("button", { name: "Model Seçimini Kaydet", exact: true }).click();
    await expect(choices.getByRole("status")).toContainText("Model seçimleri kaydedildi");
    await workspaceView(page, "Sohbet"); await expect(model).toHaveValue("local-model-a");
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Keep this draft and the selected model.");
    await expect(model.locator("option")).toHaveText(["Bağlantıdan bir model seçin", "local-model-a · Bu sohbetin mevcut modeli", "local-model-b"]);
    await model.selectOption("local-model-b"); await page.getByLabel("Üye 2 bağlantısı").selectOption(ids[1]!);
    await expect(page.getByLabel("Üye 2 modeli").locator("option")).toHaveText(["Bağlantıdan bir model seçin", "local-model-a"]);
    await page.reload(); await revealCouncilControls(page); await page.getByLabel("Üye 1 bağlantısı").selectOption(ids[0]!);
    await expect(model).toHaveValue("local-model-b");
    await expect(model.locator("option")).toHaveText(["Bağlantıdan bir model seçin", "local-model-b"]);
    expect(calls).toHaveLength(1);
    await workspaceView(page, "Ayarlar"); await openConnectionPanel(page, card, "Modeller");
    await expect(panel.getByRole("status")).toContainText("2 model kimliği listelendi");
    await page.setViewportSize({ width: 320, height: 975 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await addConnectionModels(choices, ["local-model-a"]);
    await page.screenshot({ path: testInfo.outputPath("saved-models-320.png") });
    await page.route("**/api/provider-connections", route => route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { error: "Controlled selection failure" } }) : route.continue());
    await panel.getByRole("button", { name: "Model Seçimini Kaydet", exact: true }).click();
    await expect(choices.getByRole("alert")).toContainText("kaydedilemedi");
    await expect(panel.getByRole("checkbox", { name: "local-model-a", exact: true })).toBeChecked();
    expect((await (await request.get("/api/provider-connections")).json()).connections.find((item: { id: string }) => item.id === ids[0]).selectedModels).toEqual(["local-model-b"]);
    expect((await request.post(`/api/provider-connections/${ids[0]}/models`, { headers: { origin: "https://untrusted.example" } })).status()).toBe(403);
    expect(calls).toHaveLength(1);
  } finally {
    for (const id of ids) await request.delete(`/api/provider-connections?id=${id}`);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await closeDatabase();
  }
}));
