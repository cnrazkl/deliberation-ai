import { workspaceView } from "./workspace-navigation";
import { expect, test } from "@playwright/test";

test("keeps a selected MCP result when deletion fails and allows retry", async ({ page }) => {
  const result = {
    id: "22222222-2222-4222-8222-222222222222",
    connectionId: "33333333-3333-4333-8333-333333333333",
    connectionLabel: "Tarayıcı MCP",
    toolName: "lookup",
    content: "Yerel test sonucu",
    sha256: "a".repeat(64),
    isError: false,
    createdAt: new Date().toISOString(),
  };
  let deleteAttempts = 0;
  await page.route("**/api/mcp-connections", async (route) => {
    await route.fulfill({ json: { connections: [{
      id: result.connectionId,
      label: result.connectionLabel,
      endpoint: "http://127.0.0.1:3001/mcp",
    }] } });
  });
  await page.route(/\/api\/mcp-tool-results(?:\?|$)/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { results: [result] } });
      return;
    }
    deleteAttempts += 1;
    await route.fulfill(deleteAttempts === 1
      ? { status: 503, json: { error: "E2E MCP sonucu silme hatası" } }
      : { json: { deleted: true } });
  });

  await page.goto("/"); await workspaceView(page, "Ayarlar");
  const panel = page.getByRole("region", { name: "Yerel MCP araçları" });
  const card = panel.locator(".mcp-result-list article").filter({ hasText: "Yerel test sonucu" });
  await expect(card).toBeVisible();
  await card.locator('input[type="checkbox"]').check();
  await card.getByRole("button", { name: "Sonucu sil" }).click();
  await expect(panel).toContainText("E2E MCP sonucu silme hatası");
  await expect(card).toBeVisible();
  await expect(card.locator('input[type="checkbox"]')).toBeChecked();
  await expect(card.getByRole("button", { name: "Sonucu sil" })).toBeEnabled();

  await card.getByRole("button", { name: "Sonucu sil" }).click();
  await expect(card).toHaveCount(0);
  await expect(panel).toContainText("bu çalışma için 0/3 sonuç seçili");
  expect(deleteAttempts).toBe(2);
});
