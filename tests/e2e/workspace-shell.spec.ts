import { withOwner } from "@deliberation-ai/persistence";
import {expect, test, type Page, testOwnerId } from "./authenticated-test";
import type { RunRecord } from "@deliberation-ai/application";
import { revealCouncilControls, workspaceView } from "./workspace-navigation";

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
    if (url.pathname.startsWith("/api/auth/")) { await route.continue(); return; }
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

for (const { width, zoom } of [...[320, 390, 640, 820, 1024, 1440].map((width) => ({ width, zoom: 1 })), { width: 1440, zoom: 2 }]) {
  test(`expanded workspace fits ${width}px at ${zoom}x with long attachments`, async ({ page }) => withOwner(testOwnerId(), async () => {
    await page.setViewportSize({ width, height: width === 820 ? 390 : 900 });
    await fixtures(page); await page.goto("/");
    await page.evaluate(({ width, zoom }) => {
      document.body.style.zoom = String(zoom);
      document.documentElement.dataset.theme = width === 390 ? "dark" : "light";
    }, { width, zoom });
    await revealCouncilControls(page);
    const chooserEvent = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "＋ Dosya seç", exact: true }).click();
    const chooser = await chooserEvent;
    await chooser.setFiles({ name: `${"long-file-name-".repeat(7)}.png`, mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64") });
    await expect(page.locator(".attachment-list")).toContainText("long-file-name");
    if (width === 390) await page.locator(".attachment-picker").screenshot({ path: "test-results/da112-mobile-attachments.png" });
    for (const view of ["Sohbet", "Ayarlar", "Zamanlayıcı"] as const) {
      await workspaceView(page, view);
      // Include expanded settings/diagnostics, not just the initial collapsed shell.
      await page.locator(".workspace-view:not([hidden]) details").evaluateAll((items) => {
        for (const item of items) (item as HTMLDetailsElement).open = true;
      });
      const overflow = await page.locator(".app-main").evaluate((main) => {
        return [...main.querySelectorAll("*")].filter((element) => {
          const rect = element.getBoundingClientRect();
          const css = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && css.visibility !== "hidden" &&
            (rect.right > document.documentElement.clientWidth + 1 || rect.left < -1 ||
              (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2 && css.overflowX === "visible"));
        }).map((element) => `${element.tagName}.${element.className}`).slice(0, 20);
      });
      expect(overflow, `${view} at ${width}px`).toEqual([]);
      if (width === 390 || width === 820) {
        await page.screenshot({ path: `test-results/da112-${width}-${view}.png`, fullPage: true });
      }
    }
  }));
}

test("keeps history at the left, separates settings/schedules, preserves drafts and persists appearance", async ({ page }) => withOwner(testOwnerId(), async () => {
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
  await sidebar.getByLabel("Tema").selectOption("dark");
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
  const fieldBounds = await draft.boundingBox(), configBounds = await page.locator(".council-config").boundingBox();
  expect(fieldBounds && configBounds && fieldBounds.y < configBounds.y).toBe(true);
  await page.screenshot({ path: "test-results/workspace-refresh-chat.png", fullPage: true });
  expect(writes).toBe(0);
}));

test("opens mobile history, navigates without overflow and returns to the preserved draft", async ({ page }) => withOwner(testOwnerId(), async () => {
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
}));

for (const { width, height } of [{ width: 1225, height: 918 }, { width: 390, height: 844 }, { width: 820, height: 390 }]) {
  test(`account bar and navigation remain pinned while scrolling at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await fixtures(page); await page.goto("/");
    await page.getByLabel("Sorunuz", { exact: true }).fill("Sabit gezinme sırasında korunacak soru taslağı");
    await workspaceView(page, "Ayarlar");
    await page.locator('.workspace-view:not([hidden]) details').evaluateAll((items) => { for (const item of items) (item as HTMLDetailsElement).open = true; });
    const sidebar = page.getByRole("complementary", { name: "Sohbet geçmişi ve gezinme" });
    if (!await sidebar.isVisible()) await page.getByRole("button", { name: "Sohbet geçmişini aç", exact: true }).click();
    const bar = page.getByRole("banner", { name: "Hesap" });
    const bounds = () => page.evaluate(() => {
      const header = document.querySelector(".account-bar")!.getBoundingClientRect();
      const aside = document.querySelector(".app-sidebar")!.getBoundingClientRect();
      return { headerTop: Math.round(header.top), sidebarTop: Math.round(aside.top), headerBottom: Math.round(header.bottom), sidebarBottom: Math.round(aside.bottom), viewport: window.innerHeight };
    });
    await expect(bar).toBeVisible();
    for (const scroll of [1000, 300, 1800, 0]) {
      await page.evaluate((y) => window.scrollTo(0, y), scroll);
      if (scroll > 0) expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      const position = await bounds();
      expect(position.headerTop).toBe(0); expect(position.sidebarTop).toBe(position.headerBottom);
      expect(position.sidebarBottom).toBe(position.viewport);
    }
    for (const name of ["Listeyi yenile", "Konuşma listesini yenile"]) {
      const refresh = sidebar.getByRole("button", { name, exact: true });
      await expect(refresh).toHaveText(""); await expect(refresh.locator("svg")).toHaveAttribute("aria-hidden", "true");
      await expect(refresh).toBeEnabled();
      const request = page.waitForRequest((item) => new URL(item.url()).pathname === (name === "Listeyi yenile" ? "/api/runs" : "/api/conversations") && item.method() === "GET");
      await refresh.click(); await request; await expect(refresh).toBeEnabled();
    }
    await page.screenshot({ path: `test-results/pinned-navigation-${width}.png` });
    if (width <= 800) await page.getByRole("button", { name: "Geçmiş menüsünü kapat", exact: true }).last().click();
    await workspaceView(page, "Sohbet");
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Sabit gezinme sırasında korunacak soru taslağı");
  });
}
