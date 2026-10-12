import type { Page } from "@playwright/test";

export async function workspaceView(page: Page, name: "Müzakere" | "Konseyler" | "Ayarlar" | "Zamanlayıcı") {
  const connectionDialog = page.getByRole("dialog");
  if (await connectionDialog.isVisible()) await connectionDialog.getByRole("button", { name: "Bağlantı panelini kapat", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Müzakere geçmişini aç", exact: true });
  const nav = page.getByRole("navigation", { name: "Ana menü", includeHidden: true });
  await nav.waitFor({ state: "attached" });
  if (!await nav.isVisible()) await toggle.click();
  await nav.getByRole("button", { name, exact: true }).click();
}

// Existing behavioral tests explicitly reveal controls now collapsed by default.
export async function revealCouncilControls(page: Page) {
  await workspaceView(page, "Konseyler");
  const disclosures = [page.locator(".council-config")];
  for (const details of disclosures) {
    if (await details.count() && await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  }
}
export async function revealChatTab(page: Page, tab: "Soru" | "Kaynaklar Ve Dosyalar" | "Bağlam Ve Kontroller" | "Sonuçlar", expand = true) {
  await workspaceView(page, "Müzakere"); await page.getByRole("tab", { name: tab, exact: true }).click();
  if (expand) await page.locator('[id^="chat-panel-"]:not([hidden]) details').evaluateAll(items => items.forEach(item => { (item as HTMLDetailsElement).open = true; }));
}
export async function saveCouncilForChat(page: Page, name = `Browser council ${Date.now()}`) {
  await revealCouncilControls(page);
  const editor = page.getByRole("region", { name: "Konsey kaydı", exact: true });
  await editor.getByLabel("Şablon adı", { exact: true }).fill(name);
  await editor.getByRole("button", { name: "Yeni Konsey Oluştur", exact: true }).click();
  await editor.getByRole("status").filter({ hasText: "kaydedildi" }).waitFor();
  await revealChatTab(page, "Soru");
}
/** Offline form tests use synthetic metadata and must not persist a nonexistent connection. */
export async function mockCouncilStorage(page: Page) {
  await page.route("**/api/council-templates", async route => {
    if (route.request().method() === "POST") {
      const data = route.request().postDataJSON();
      await route.fulfill({ json: { ...data, id: "33333333-3333-4333-8333-333333333333", memberCount: data.members.length } });
    } else await route.fulfill({ json: { templates: [] } });
  });
}
export async function revealConversationOptions(page: Page) {
  await page.getByRole("button", { name: "Özel dal taslaklarını göster", exact: true }).first().waitFor({ state: "visible" });
}
