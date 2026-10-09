import type { Locator, Page } from "@playwright/test";

export async function openConnectionPanel(page: Page, card: Locator, tab: "Bağlantı" | "Modeller" | "Test ve Geçmiş" = "Bağlantı") {
  await card.getByRole("button", { name: tab === "Modeller" ? "Modelleri Seç" : "Düzenle", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.waitFor({ state: "visible" });
  if (tab !== "Bağlantı") await dialog.getByRole("tab", { name: tab, exact: true }).click();
  return dialog;
}

export async function addConnectionModels(scope: Locator, models: string[]) {
  const dropdown = scope.locator(".connection-model-dropdown").first();
  if (await dropdown.getAttribute("open") === null) await dropdown.locator(":scope > summary").click();
  for (const model of models) {
    const checkbox = dropdown.getByRole("checkbox", { name: model, exact: true });
    if (await checkbox.count()) await checkbox.check();
    else {
      const manual = dropdown.locator(".connection-model-manual");
      if (await manual.getAttribute("open") === null) await manual.locator("summary").click();
      await manual.getByLabel("Model kimliği", { exact: true }).fill(model);
      await manual.getByRole("button", { name: "Modeli Ekle", exact: true }).click();
    }
  }
}
