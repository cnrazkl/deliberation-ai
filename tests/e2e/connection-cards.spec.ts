import { expect, test } from "./authenticated-test";
import { workspaceView } from "./workspace-navigation";
import { addConnectionModels, openConnectionPanel } from "./connection-model-selection";

const settings = { provider: "openai-compatible", apiKey: "", baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "ollama", reasoningProtocol: "none", structuredOutputMode: "json-object" };

for (const theme of ["light", "dark"] as const) for (const [width, columns] of [[320, 1], [960, 2], [1280, 3], [1540, 4]]) {
  test(`compact connections use ${columns} columns at ${width}px in ${theme}`, async ({ page, request }, info) => {
    const ids: string[] = []; let providerRequests = 0;
    page.on("request", request => { if (request.method() === "POST" && /\/models|\/model-preview|\/generation-check|\/api\/runs$/.test(request.url())) providerRequests++; });
    try {
      for (let index = 0; index < 4; index++) {
        const saved = await request.post("/api/provider-connections", { data: { ...settings, label: index ? `Connection ${index + 1}` : "A long connection name to check wrapping safely", selectedModels: ["vendor/a-long-model-identifier-to-check-clipping", "second-model", "third-model"] } });
        expect(saved.ok()).toBe(true); ids.push((await saved.json()).id);
      }
      await page.setViewportSize({ width: width!, height: 975 }); await page.goto("/");
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await workspaceView(page, "Ayarlar");
      const grid = page.locator(".connection-grid"); await expect(grid.locator(".connection-card")).toHaveCount(4);
      expect(await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(columns);
      const cards = await grid.locator(".connection-card").evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect(); return { height: box.height, overflow: element.scrollWidth > element.clientWidth };
      }));
      expect(cards.every(card => card.height < 340 && !card.overflow)).toBe(true);
      await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(page.locator(".connection-form")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 1280 || width === 1540) await page.screenshot({ path: info.outputPath(`cards-${theme}-${columns}.png`) });
      const dialog = await openConnectionPanel(page, grid.locator(".connection-card").first());
      await expect(dialog.getByLabel("API anahtarı", { exact: true })).toHaveValue("");
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await dialog.getByRole("tab").evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height >= 44))).toBe(true);
      await dialog.getByRole("tab", { name: "Modeller", exact: true }).click(); await addConnectionModels(dialog.locator(".saved-connection-models").filter({ visible: true }), ["second-model"]);
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (width === 320 || width === 1540) await page.screenshot({ path: info.outputPath(`panel-${theme}-${width}.png`) });
      await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
      expect(providerRequests).toBe(0);
    } finally { for (const id of ids) await request.delete(`/api/provider-connections?id=${id}`); }
  });
}

test("connection panel preserves drafts, handles failures, restores focus and keeps reviewed generation inert", async ({ page, request }) => {
  let id: string | undefined, generationRequests = 0, reviews = 0;
  page.on("request", request => {
    if (request.url().includes("/generation-check")) { if (request.method() === "POST") generationRequests++; else if (request.method() === "GET") reviews++; }
  });
  const dialog = page.getByRole("dialog"), form = dialog.locator(".connection-form");
  try {
    await page.goto("/"); await page.getByLabel("Sorunuz", { exact: true }).fill("Keep my current question.");
    await workspaceView(page, "Ayarlar");
    const trigger = page.getByRole("button", { name: "Yeni Bağlantı Ekle", exact: true }); await trigger.click();
    await expect(dialog).toBeVisible();
    for (let count = 0; count < 16; count++) {
      await page.keyboard.press("Tab"); expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".connection-dialog")))).toBe(true);
    }
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    await trigger.click(); await form.getByLabel("Sağlayıcı ailesi").selectOption("openai-compatible"); await form.getByLabel("Uç nokta türü").selectOption("ollama");
    await form.getByLabel("Temel URL").fill(settings.baseUrl); await form.getByLabel("Bağlantı adı", { exact: true }).fill("Panel fixture");
    await page.route("**/api/provider-connections", route => route.request().method() === "POST" ? route.fulfill({ status: 503, json: { error: "Controlled panel failure" } }) : route.continue());
    await form.getByRole("button", { name: "Yeni Bağlantı Ekle", exact: true }).click(); await expect(form.getByRole("alert")).toContainText("Controlled panel failure");
    await expect(form.getByLabel("Bağlantı adı", { exact: true })).toHaveValue("Panel fixture");
    await page.unroute("**/api/provider-connections");
    const created = page.waitForResponse(response => response.url().endsWith("/api/provider-connections") && response.request().method() === "POST");
    await form.getByRole("button", { name: "Yeni Bağlantı Ekle", exact: true }).click(); const response = await created; expect(response.ok()).toBe(true); id = (await response.json()).id;
    await expect(dialog).not.toBeVisible(); await expect(page.locator(".primary-connections .connection-save-notice")).toContainText("başarıyla");
    const card = page.locator(".connection-card").filter({ hasText: "Panel fixture" });
    await openConnectionPanel(page, card); await form.getByLabel("Bağlantı adı", { exact: true }).fill("Panel fixture renamed");
    await dialog.getByRole("tab", { name: "Bağlantı", exact: true }).focus(); await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: "Modeller", exact: true })).toBeFocused(); await page.keyboard.press("ArrowLeft");
    await expect(form.getByLabel("Bağlantı adı", { exact: true })).toHaveValue("Panel fixture renamed");
    await form.getByRole("button", { name: "Bağlantıyı güncelle", exact: true }).click(); await expect(dialog).not.toBeVisible();
    await expect(card).toContainText("Panel fixture renamed");
    await openConnectionPanel(page, card, "Modeller");
    await page.route("**/api/provider-connections/*/models", route => route.fulfill({ json: { status: "available", verification: "catalog_only", models: ["local-a", "local-b"], truncated: false } }));
    await dialog.getByRole("button", { name: "Model listesini kontrol et" }).click();
    await addConnectionModels(dialog.locator(".saved-connection-models").filter({ visible: true }), ["local-a", "local-b"]);
    await dialog.getByRole("button", { name: "Model Seçimini Kaydet", exact: true }).click();
    await expect(dialog.locator(".saved-connection-models").filter({ visible: true }).getByRole("status")).toContainText("kaydedildi");
    expect((await (await request.get("/api/provider-connections")).json()).connections.find((connection: { id: string }) => connection.id === id).selectedModels).toEqual(["local-a", "local-b"]);
    await dialog.getByRole("tab", { name: "Test ve Geçmiş", exact: true }).click();
    await dialog.getByRole("button", { name: "Üretim testi ve model geçmişi", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /Onaylanan denemeyi/ })).toBeDisabled();
    const reviewCount = reviews; await page.keyboard.press("Escape"); await openConnectionPanel(page, card, "Test ve Geçmiş");
    await expect(dialog.getByRole("button", { name: /Onaylanan denemeyi/ })).toBeDisabled(); expect(reviews).toBe(reviewCount);
    await workspaceView(page, "Sohbet"); await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Keep my current question.");
    await workspaceView(page, "Ayarlar");
    await page.route("**/api/provider-connections?*", route => route.fulfill({ status: 503, json: { error: "Controlled deletion failure" } }));
    await card.getByRole("button", { name: "Sil", exact: true }).click(); await expect(page.locator(".primary-connections").getByRole("alert")).toContainText("silinemedi");
    await expect(card).toBeVisible(); await page.unroute("**/api/provider-connections?*");
    await card.getByRole("button", { name: "Sil", exact: true }).click(); await expect(card).toHaveCount(0);
    expect(generationRequests).toBe(0);
  } finally { if (id) await request.delete(`/api/provider-connections?id=${id}`); }
});
