import { withOwner } from "@deliberation-ai/persistence";
import { randomUUID } from "node:crypto";
import {expect, test, testOwnerId } from "./authenticated-test";
import type { RunHistoryPage } from "@deliberation-ai/persistence";

test("saved history refresh rejects an older response and preserves the draft", async ({ page }) => withOwner(testOwnerId(), async () => {
  const currentId = randomUUID();
  const freshId = randomUUID();
  const staleId = randomUUID();
  const item = (runId: string, question: string): RunHistoryPage["runs"][number] => ({
    runId, question, createdAt: new Date().toISOString(), status: "completed", riskProfile: "standard",
    memberCount: 2, attachmentCount: 0, hasReport: true,
  });
  let listStage: "error" | "current" | "fresh" = "error";
  let generations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/runs") generations += 1;
  });
  let olderArrived!: () => void;
  let releaseOlder!: () => void;
  let olderFinished!: () => void;
  const olderSeen = new Promise<void>((resolve) => { olderArrived = resolve; });
  const olderRelease = new Promise<void>((resolve) => { releaseOlder = resolve; });
  const olderSettled = new Promise<void>((resolve) => { olderFinished = resolve; });
  const settleOlder = (request: { url(): string }) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/runs" && url.searchParams.has("before")) olderFinished();
  };
  page.on("requestfinished", settleOlder);
  page.on("requestfailed", settleOlder);
  await page.route("**/api/runs*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/runs" || route.request().method() !== "GET") { await route.continue(); return; }
    if (url.searchParams.has("before")) {
      olderArrived(); await olderRelease;
      await route.fulfill({ json: { runs: [item(staleId, "Önceki sayfanın geç gelen sonucu")], nextCursor: null } }).catch(() => undefined);
      return;
    }
    if (listStage === "error") { await route.fulfill({ status: 503, json: {} }); return; }
    await route.fulfill({ json: {
      runs: [item(listStage === "current" ? currentId : freshId, listStage === "current" ? "Önceki liste" : "Yenilenen çalışma listesi")],
      nextCursor: listStage === "current" ? currentId : null,
    } });
  });
  try {
    await page.goto("/");
    const history = page.locator("details.run-history");
    await expect(history.getByRole("alert")).toHaveText("Çalışma geçmişi yüklenemedi.");
    await page.getByLabel("Sorunuz", { exact: true }).fill("Çalışma listesi yenilenirken korunacak taslak");
    listStage = "current";
    await history.getByRole("button", { name: "Listeyi yenile", exact: true }).click();
    await expect(history.locator('[data-run-id="' + currentId + '"]')).toBeVisible();
    await history.getByRole("button", { name: "Daha eski çalışmaları göster", exact: true }).click();
    await olderSeen;
    listStage = "fresh";
    await history.getByRole("button", { name: "Listeyi yenile", exact: true }).click();
    await expect(history.locator('[data-run-id="' + freshId + '"]')).toBeVisible();
    releaseOlder();
    await olderSettled;
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect(history.locator("[data-run-id]")).toHaveCount(1);
    await expect(history).not.toContainText("Önceki sayfanın geç gelen sonucu");
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Çalışma listesi yenilenirken korunacak taslak");
    expect(generations).toBe(0);
  } finally { releaseOlder(); }
}));
