import { expect, test, type Page } from "@playwright/test";
import type { RunRecord } from "@deliberation-ai/application";
import { workspaceView } from "./workspace-navigation";

const runId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const question = "Kaydedilmiş örnek konuşma nasıl yeniden açılır?";
const createdAt = "2026-10-03T12:00:00.000Z";
async function fixtures(page: Page) {
  const run: RunRecord = { runId, question, idempotencyKey: "workspace-fixture", requestHash: "workspace-fixture",
    promptVersion: "council-v1", promptFingerprint: "a".repeat(64), riskProfile: "standard", snapshotId: "workspace-fixture",
    memberCount: 2, memoryEntryCount: 0, attachmentCount: 0, toolResultCount: 0, createdAt, status: "completed", report: null };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json: Record<string, unknown> = {
      "/api/provider-connections": { connections: [] }, "/api/provider-operations": { operations: [] },
      "/api/council-templates": { templates: [] }, "/api/memory-entries": { entries: [] },
      "/api/mcp-connections": { connections: [] }, "/api/mcp-tool-results": { results: [] },
      "/api/preflight-drafts": { drafts: [] },
      "/api/conversations": { conversations: [{ conversationId, createdAt, origin: "native", recordedRunCount: 1,
        availableRunCount: 1, unavailableRunCount: 0, latestAvailableRun: { runId, question, status: "completed" } }], nextCursor: null },
      "/api/runs": { runs: [{ runId, question, createdAt, status: "completed", riskProfile: "standard", memberCount: 2, attachmentCount: 0, hasReport: false }], nextCursor: null },
      [`/api/runs/${runId}`]: run,
      "/api/local-schedules": { schedules: [{ id: "33333333-3333-4333-8333-333333333333", name: "Örnek günlük çalışma", question,
        providerMode: "fake", reviewRounds: 0, selfRevisionEnabled: false, riskProfile: "standard", cadence: "daily",
        status: "paused", nextRunAt: "2400-01-01T00:00:00.000Z", lastRunAt: createdAt, lastRunId: runId },
        { id: "55555555-5555-4555-8555-555555555555", name: "Kaldırılmış çıktı örneği", question, providerMode: "fake",
          reviewRounds: 0, selfRevisionEnabled: false, riskProfile: "standard", cadence: "daily", status: "paused",
          nextRunAt: "2400-01-01T00:00:00.000Z", lastRunAt: createdAt, lastRunId: "44444444-4444-4444-8444-444444444444" }] },
      "/api/local-diagnostics": { checkedAt: createdAt, database: "ready", workerStatus: "ready", readyWorkers: 1, latestHeartbeatAt: createdAt,
        queuedRuns: 0, runningRuns: 0, unresolvedProviderAttempts: 0, activeSchedules: 0 },
    };
    // These fixtures never dispatch or mutate persisted data.
    await route.fulfill({ status: json[url.pathname] ? 200 : 404, json: json[url.pathname] ?? { error: "Fixture unavailable" } });
  });
}

test("keeps history at the left, separates settings/schedules, preserves drafts and persists appearance", async ({ page }) => {
  await fixtures(page);
  let writes = 0;
  page.on("request", (request) => { if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) writes++; });
  await page.goto("/");
  const chat = page.getByRole("region", { name: "Konsey çalışma alanı", exact: true });
  const sidebar = page.getByRole("complementary", { name: "Sohbet geçmişi ve gezinme" });
  await expect(chat).toBeVisible();
  await expect(page.locator(".council-config")).not.toHaveAttribute("open");
  await expect(page.getByRole("region", { name: "Ayarlar alanı", exact: true })).toBeHidden();
  await expect(page.getByRole("region", { name: "Zamanlayıcı alanı", exact: true })).toBeHidden();
  await expect(sidebar.getByText(question, { exact: true }).first()).toBeVisible();
  const draft = page.getByLabel("Sorunuz", { exact: true });
  await draft.fill("Bölümler arasında korunması gereken soru taslağı");
  await workspaceView(page, "Ayarlar");
  await expect(chat).toBeHidden();
  await expect(page.getByRole("region", { name: "Yerel MCP araçları", exact: true })).toBeVisible();
  await expect(page.locator(".diagnostics-card > summary")).toContainText("Worker");
  await page.getByRole("region", { name: "Görünüm ayarları" }).getByLabel("Tema").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await workspaceView(page, "Zamanlayıcı");
  const outputs = page.getByRole("region", { name: "Zamanlayıcı çıktıları" });
  await expect(outputs).toContainText("Örnek günlük çalışma");
  await outputs.locator("article").filter({ hasText: "Kaldırılmış çıktı örneği" }).getByRole("button", { name: "Son çalışmayı aç" }).click();
  await expect(chat.getByRole("alert")).toContainText("Kayıtlı çalışma açılamadı");
  await workspaceView(page, "Zamanlayıcı");
  await outputs.locator("article").filter({ hasText: "Örnek günlük çalışma" }).getByRole("button", { name: "Son çalışmayı aç" }).click();
  await expect(chat).toBeVisible();
  await expect(page.locator("#council-result")).toContainText(question);
  await expect(draft).toHaveValue("Bölümler arasında korunması gereken soru taslağı");
  await sidebar.getByRole("button", { name: "Konuşmayı aç", exact: true }).click();
  await expect(draft).toHaveValue("Bölümler arasında korunması gereken soru taslağı");
  await page.reload();
  await expect(sidebar.getByLabel("Tema")).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/da111-dark-desktop.png" });
  await sidebar.getByLabel("Tema").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "test-results/da111-light-desktop.png" });
  await sidebar.getByLabel("Tema").selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).colorScheme)).toBe("dark");
  await sidebar.getByRole("button", { name: "＋ Yeni sohbet", exact: true }).click();
  await expect(draft).toHaveValue("");
  await expect(draft).toBeFocused();
  expect(writes).toBe(0);
});

test("opens mobile history, navigates without overflow and returns to the preserved draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page); await page.goto("/");
  const draft = page.getByLabel("Sorunuz", { exact: true });
  await draft.fill("Mobil görünümde korunacak soru taslağı");
  const sidebar = page.getByRole("complementary", { name: "Sohbet geçmişi ve gezinme" });
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Sohbet geçmişini aç", exact: true }).click();
  await expect(sidebar).toBeVisible();
  await sidebar.getByLabel("Tema").selectOption("dark");
  await workspaceView(page, "Ayarlar");
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("heading", { name: "Ayarlar", exact: true })).toBeVisible();
  await workspaceView(page, "Sohbet");
  await expect(draft).toHaveValue("Mobil görünümde korunacak soru taslağı");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/da111-dark-mobile.png" });
});
