import { test, expect } from "@playwright/test";
import { workspaceView } from "./workspace-navigation";

test("private output default requires save, survives reload, synchronizes tabs and resets", async ({ page, context }) => {
  let mutations = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    // The existing composer posts a read-only token preview during initialization.
    if (path.startsWith("/api/") && path !== "/api/runs/token-preview" && ["POST", "PATCH", "DELETE"].includes(request.method())) mutations++;
  });
  await page.goto("/"); await workspaceView(page, "Ayarlar");
  const panel = page.getByRole("region", { name: "Özel yanıt varsayılanı", exact: true });
  await expect(panel).toContainText("Kaydedilen varsayılan: 1024 token");
  await panel.getByLabel("Varsayılan özel çıktı sınırı").selectOption("256");
  await expect(panel).toContainText("Kaydedilen varsayılan: 1024 token");
  await panel.getByRole("button", { name: "Varsayılanı bu tarayıcıya kaydet" }).click();
  await expect(panel.getByRole("status")).toContainText("kaydedildi");
  await page.reload(); await workspaceView(page, "Ayarlar");
  await expect(panel.getByLabel("Varsayılan özel çıktı sınırı")).toHaveValue("256");
  const other = await context.newPage(); await other.goto("/"); await workspaceView(other, "Ayarlar");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: "test-results/da117-mobile-output-default.png" });
  await panel.getByRole("button", { name: "Varsayılanı 1024'e sıfırla" }).click();
  await expect(other.getByRole("region", { name: "Özel yanıt varsayılanı" })).toContainText("Kaydedilen varsayılan: 1024 token");
  expect(mutations).toBe(0);
});

test("invalid stored values fall back and blocked storage reports a failed save", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("deliberation-private-output-default-v1", "1025"));
  await page.goto("/"); await workspaceView(page, "Ayarlar");
  const panel = page.getByRole("region", { name: "Özel yanıt varsayılanı", exact: true });
  await expect(panel).toContainText("Kaydedilen varsayılan: 1024 token");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Fixture storage denied"); }; });
  await panel.getByLabel("Varsayılan özel çıktı sınırı").selectOption("128");
  await panel.getByRole("button", { name: "Varsayılanı bu tarayıcıya kaydet" }).click();
  await expect(panel.getByRole("status")).toContainText("kaydedilemedi");
  await expect(panel).toContainText("Kaydedilen varsayılan: 1024 token");
});
