import { workspaceView } from "./workspace-navigation";
import { expect, test } from "@playwright/test";

test("terminal submitted council receipts are shown for manual decision without sending anything", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", request => { if (request.method() === "POST") writes.push(request.url()); });
  await page.route("**/api/provider-operations", route => route.fulfill({ json: { operations: [{
    id: "00000000-0000-4000-8000-000000000001", runId: "00000000-0000-4000-8000-000000000002",
    memberId: "Offline terminal fixture", round: 1, attempt: 1, provider: "offline", model: "offline",
    status: "submitted", errorCode: null, startedAt: "2026-10-08T10:00:00Z", runStatus: "partially_completed",
  }] } }));
  await page.goto("/"); await workspaceView(page, "Ayarlar");
  const panel = page.getByRole("region", { name: "Operatör kararı bekleyen işlemler" });
  await expect(panel.getByText("1 belirsiz sağlayıcı işlemi")).toBeVisible();
  await expect(panel.getByText(/ikinci kez ücretlenmesine/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Başarısız say ve kapat" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Yeni denemeye izin ver" })).toBeVisible();
  await panel.getByRole("button", { name: "Yenile", exact: true }).click();
  expect(writes).toEqual([]);
});

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

test("separates recovery hold, private/decision/probe uncertainty, queue age and backup warnings", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") writes.push(request.url()); });
  await page.route("**/api/local-diagnostics", (route) => route.fulfill({ json: {
    checkedAt: "2026-10-07T00:00:00Z", database: "ready", workerStatus: "ready", readyWorkers: 1, latestHeartbeatAt: null,
    queuedRuns: 0, runningRuns: 0, unresolvedProviderAttempts: 0, activeSchedules: 0,
    operational: { recoveryHold: true, privatePending: 1, privateUnknown: 1, privateCopied: 2, probePending: 1, probeUnknown: 1,
      decisionPending: 1, decisionUnknown: 1, decisionEnabled: false, queryMs: 2300, queue: { pending: 3, active: 0, oldestDueSeconds: 90000 },
      backup: { state: "missing", count: 0, bytes: 0, latestAt: null } },
  } }));
  await page.goto("/"); await workspaceView(page, "Ayarlar"); const panel = page.locator(".diagnostics-card");
  await expect(panel.locator("summary")).toContainText("Salt okunur kurtarma"); await panel.locator("summary").click();
  await expect(panel.getByText(/Konsey dışında sonucu doğrulanmamış/)).toBeVisible();
  await expect(panel.getByText(/Kayıtlı yedek bilgisi yok/)).toBeVisible();
  await expect(panel.getByText(/bir günden eski/)).toBeVisible();
  await panel.getByRole("button", { name: "Durumu yenile" }).click(); expect(writes).toEqual([]);
});
