import { expect, test } from "./authenticated-test";
import { workspaceView } from "./workspace-navigation";

const draftConnection = { provider: "openai-compatible", label: "Layout check", apiKey: "", defaultModel: "local-check",
  baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "ollama", reasoningProtocol: "none", structuredOutputMode: "json-object" };

test("connection creation reports encrypted success in place and failures never report success", async ({ page, request }) => {
  let savedId: string | undefined;
  try {
    await page.goto("/"); await page.getByLabel("Sorunuz", { exact: true }).fill("Preserve this draft when saving a connection.");
    await workspaceView(page, "Ayarlar"); await page.locator(".primary-connections > summary").click();
    const form = page.locator(".primary-connections > .connection-form");
    await form.getByLabel("Sağlayıcı ailesi", { exact: true }).selectOption("openai-compatible");
    await form.getByLabel("Uç nokta türü", { exact: true }).selectOption("ollama");
    await form.getByLabel("Bağlantı adı", { exact: true }).fill("In-place save check");
    await form.locator(".connection-default-model input").fill("local-check");
    await page.evaluate(() => { (window as Window & { saveMarker?: string }).saveMarker = "preserve-document"; });
    const formTop = await form.evaluate(el => el.getBoundingClientRect().top + window.scrollY);
    const response = page.waitForResponse(r => r.url().endsWith("/api/provider-connections") && r.request().method() === "POST");
    await form.getByRole("button", { name: "Yeni Bağlantı Ekle", exact: true }).click();
    const saved = await response; expect(saved.ok()).toBe(true); savedId = (await saved.json()).id;
    await expect(form.locator(".connection-save-notice")).toHaveText("Yeni bağlantı başarıyla şifrelenerek eklenmiştir.");
    expect(await page.evaluate(() => (window as Window & { saveMarker?: string }).saveMarker)).toBe("preserve-document");
    expect(Math.abs((await form.evaluate(el => el.getBoundingClientRect().top + window.scrollY)) - formTop)).toBeLessThan(2);
    await expect(form.getByLabel("API anahtarı", { exact: true })).toHaveValue("");
    await form.getByLabel("Bağlantı adı", { exact: true }).fill("Failed save check");
    await form.locator(".connection-default-model input").fill("local-check");
    await page.route("**/api/provider-connections", route => route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { error: "Controlled save failure" } }) : route.continue());
    await form.getByRole("button", { name: "Yeni Bağlantı Ekle", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("Controlled save failure");
    await expect(form.locator(".connection-save-notice")).toBeEmpty();
    await expect(form.getByLabel("Bağlantı adı", { exact: true })).toHaveValue("Failed save check");
    await workspaceView(page, "Sohbet"); await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Preserve this draft when saving a connection.");
  } finally { if (savedId) await request.delete(`/api/provider-connections?id=${savedId}`); }
});

for (const theme of ["light", "dark"] as const) for (const width of [320, 960, 1440]) {
  test(`${theme} help and connection controls remain clear at ${width}px without secure-context UUID support`, async ({ page, request }, testInfo) => {
    let savedId: string | undefined, generationRequests = 0;
    page.on("request", r => { if (r.method() === "POST" && r.url().includes("/generation-check")) generationRequests++; });
    await page.addInitScript(() => { Object.defineProperty(window.crypto, "randomUUID", { value: undefined, configurable: true }); });
    try {
      await page.setViewportSize({ width, height: 975 });
      await page.goto("/help"); await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      await page.evaluate(() => document.fonts.ready);
      const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      expect(font.toLowerCase()).toContain("manrope");
      const example = page.locator("#baslangic .help-example");
      expect(await example.locator("pre").evaluate(el => getComputedStyle(el).fontFamily)).toBe(font);
      expect(await example.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(20);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 960) { await example.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath(`help-${theme}.png`) }); }
      const saved = await request.post("/api/provider-connections", { data: draftConnection }); expect(saved.ok()).toBe(true); savedId = (await saved.json()).id;
      await page.goto("/"); await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      await workspaceView(page, "Ayarlar"); await page.locator(".primary-connections > summary").click();
      await expect(page.locator(".appearance-card")).toHaveCount(0);
      await expect(page.locator(".sidebar-footer select[aria-label='Tema']")).toHaveCount(1);
      const card = page.locator(".connection-card").filter({ hasText: "Layout check" });
      const panel = card.locator(".connection-generation-panel");
      await panel.getByRole("button", { name: "Üretim testi ve model geçmişi" }).click();
      await expect(panel.getByRole("button", { name: /Onaylanan denemeyi/ })).toBeDisabled();
      await expect(panel.getByRole("alert")).toHaveCount(0);
      const geometry = await panel.evaluate(el => {
        const card = el.closest(".connection-card")!.getBoundingClientRect(), box = el.getBoundingClientRect();
        const note = el.querySelector(".connection-generation-note")!.getBoundingClientRect();
        const controls = el.querySelector(".connection-generation-controls")!.getBoundingClientRect();
        return { left: box.left - card.left, right: card.right - box.right, bottom: card.bottom - box.bottom, gap: controls.top - note.bottom };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(16); expect(geometry.right).toBeGreaterThanOrEqual(16);
      expect(geometry.bottom).toBeGreaterThanOrEqual(16); expect(geometry.gap).toBeGreaterThanOrEqual(16);
      expect(await panel.getByRole("button").first().evaluate(el => getComputedStyle(el).textTransform)).toBe("capitalize");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(generationRequests).toBe(0);
      if (width === 960) { await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath(`connections-${theme}.png`) }); }
    } finally { if (savedId) await request.delete(`/api/provider-connections?id=${savedId}`); }
  });
}
