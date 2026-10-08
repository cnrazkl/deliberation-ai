import type { Page } from "@playwright/test";

export async function workspaceView(page: Page, name: "Sohbet" | "Ayarlar" | "Zamanlayıcı") {
  const toggle = page.getByRole("button", { name: "Sohbet geçmişini aç", exact: true });
  const nav = page.getByRole("navigation", { name: "Ana menü", includeHidden: true });
  await nav.waitFor({ state: "attached" });
  if (!await nav.isVisible()) await toggle.click();
  await nav.getByRole("button", { name, exact: true }).click();
}

// Existing behavioral tests explicitly reveal controls now collapsed by default.
export async function revealCouncilControls(page: Page) {
  await workspaceView(page, "Sohbet");
  const disclosures = [page.locator(".council-config"), page.locator(".attachment-picker"), page.locator(".token-preview"),
    page.locator("details.composer-disclosure").filter({ has: page.locator(".execution-limits-control") }),
    page.locator("details.composer-disclosure").filter({ has: page.locator(".prompt-revision-editor") }), page.locator(".context-disclosure")];
  for (const details of disclosures) {
    if (await details.count() && await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  }
}
export async function revealConversationOptions(page: Page) {
  await page.locator(".conversation-options").first().waitFor({ state: "visible" });
  for (const details of await page.locator(".conversation-options").all()) {
    if (await details.getAttribute("open") === null) await details.locator("summary").click();
  }
}
