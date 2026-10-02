import { expect, test } from "@playwright/test";

test("shows read-only local database and worker diagnostics", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator(".diagnostics-card");
  await expect(panel.locator("summary")).toContainText("Worker");
  await panel.locator("summary").click();
  await expect(panel.getByText("Bağlı", { exact: true })).toBeVisible();
  await expect(panel.getByText("Belirsiz sağlayıcı işlemi")).toBeVisible();
  await panel.getByRole("button", { name: "Durumu yenile" }).click();
  await expect(panel.getByText("Son kontrol:")).toBeVisible();
});
