import { workspaceView } from "./workspace-navigation";
import { expect, test } from "@playwright/test";

test("shows read-only local database and worker diagnostics", async ({ page }) => {
  await page.goto("/"); await workspaceView(page, "Ayarlar");
  const panel = page.locator(".diagnostics-card");
  await expect(panel.locator("summary")).toContainText("Worker");
  await panel.locator("summary").click();
  await expect(panel.getByText("Bağlı", { exact: true })).toBeVisible();
  await expect(panel.getByText("Belirsiz sağlayıcı işlemi")).toBeVisible();
  await panel.getByRole("button", { name: "Durumu yenile" }).click();
  await expect(panel.getByText("Son kontrol:")).toBeVisible();
});

test("explains stalled running work and unknown council outcomes without resubmission", async ({ page }) => {
  const writes: string[] = [];
  let recovered = false;
  page.on("request", (request) => { if (request.method() === "POST") writes.push(request.url()); });
  await page.route("**/api/local-diagnostics", (route) => route.fulfill({ json: {
    checkedAt: "2026-10-07T00:00:00Z", database: "ready", workerStatus: recovered ? "ready" : "stale", readyWorkers: recovered ? 1 : 0,
    latestHeartbeatAt: null, queuedRuns: 0, runningRuns: recovered ? 0 : 1, unresolvedProviderAttempts: recovered ? 0 : 2, activeSchedules: 0,
  } }));
  await page.goto("/"); await workspaceView(page, "Ayarlar");
  const panel = page.locator(".diagnostics-card");
  await panel.locator("summary").click();
  await expect(panel.getByText(/çalışıyor görünmesi işlemin sürdüğünü kanıtlamaz/)).toBeVisible();
  await expect(panel.getByText(/2 konsey sağlayıcı işleminin sonucu belirsiz/)).toBeVisible();
  await panel.getByRole("button", { name: "Durumu yenile" }).click();
  await expect(panel.getByText(/sonucu bilmeden yeniden göndermek/)).toBeVisible();
  recovered = true;
  await panel.getByRole("button", { name: "Durumu yenile" }).click();
  await expect(panel.locator(".inline-warning")).toHaveCount(0);
  await expect(panel.locator("summary")).toContainText("hazır");
  expect(writes).toEqual([]);
});
