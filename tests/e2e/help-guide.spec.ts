import { expect, test, testOrigin } from "./authenticated-test";

test("public guide has complete destinations, searchable topics and no application requests", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: testOrigin, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} });
  const page = await context.newPage();
  const apiRequests: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url()); });
  try {
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("İlk sorudan");
    const articles = page.locator(".help-article");
    expect(await articles.count()).toBeGreaterThanOrEqual(20);
    const broken = await page.locator('a[href^="#"]').evaluateAll((links) => links.filter((link) => !document.getElementById(link.getAttribute("href")!.slice(1))).map((link) => link.getAttribute("href")));
    expect(broken).toEqual([]);
    await page.getByLabel("Kılavuzda ara").fill("ZAMANLAYICI");
    await page.getByRole("navigation", { name: "Yardım konuları" }).getByRole("link", { name: "Zamanlayıcı: günlük ve haftalık çalışmalar" }).click();
    await expect(page).toHaveURL(/#zamanlayici$/);
    await expect(page.locator("#zamanlayici")).toContainText("Duraklatılmış zamanlama oluştur");
    await page.locator("#zamanlayici summary").click();
    await expect(page.locator("#zamanlayici details")).toContainText("Her gerçekleşme ayrı çalışma kotasına sahiptir");
    await page.getByLabel("Kılavuzda ara").fill("eşleşmeyecekxyz");
    await expect(page.getByRole("status")).toContainText("0 bölüm");
    await expect(articles).toHaveCount(26);
    await page.getByLabel("Tema").selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const openDetails = await page.locator(".help-technical[open]").count();
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect(page.locator(".help-technical[open]")).toHaveCount(26);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator(".help-technical[open]")).toHaveCount(openDetails);
    expect(apiRequests).toEqual([]);
  } finally { await context.close(); }
});

test("help opens separately and preserves authenticated question draft", async ({ page }) => {
  await page.goto("/");
  const draft = page.getByLabel("Sorunuz", { exact: true });
  await draft.fill("Yardım okurken korunacak kişisel soru taslağım");
  const popupEvent = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Yardım (yeni sekmede açılır)" }).click();
  const popup = await popupEvent;
  await expect(popup.getByRole("heading", { level: 1 })).toContainText("İlk sorudan");
  await expect(draft).toHaveValue("Yardım okurken korunacak kişisel soru taslağım");
  await popup.close();
});

test("login and root expose help without a personal workspace", async ({ browser }) => {
  for (const storageState of [{ cookies: [], origins: [] }, ".local/e2e/root-session.json"]) {
    const context = await browser.newContext({ baseURL: testOrigin, storageState, extraHTTPHeaders: {} });
    try { const page = await context.newPage(); await page.goto("/"); await expect(page.getByRole("link", { name: "Yardım (yeni sekmede açılır)" })).toHaveAttribute("href", "/help"); }
    finally { await context.close(); }
  }
});

for (const width of [320, 820, 1440]) test(`expanded help fits ${width}px`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width, height: 900 }); await page.goto("/help");
  // A stateful search waits for hydration before expanding native details for layout checks.
  await page.getByLabel("Kılavuzda ara").fill("zamanlayıcı");
  await expect(page.getByRole("status")).toContainText("bölüm bulundu");
  await page.getByLabel("Kılavuzda ara").fill("");
  await page.locator(".help-technical").evaluateAll((items) => { for (const item of items) (item as HTMLDetailsElement).open = true; });
  await page.getByLabel("Tema").selectOption(width === 320 ? "dark" : "light");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `test-results/help-${width}.png`, fullPage: false });
  expect(errors).toEqual([]);
});
