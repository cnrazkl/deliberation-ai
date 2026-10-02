import { expect, test } from "@playwright/test";
import type { RunRecord } from "@deliberation-ai/application";

test("keeps observing an active run after the former polling deadline", async ({ page }) => {
  test.setTimeout(60_000);
  const runId = "11111111-1111-4111-8111-111111111111";
  const question = "Uzun süren bir konsey çalışmasının sonucu beklenirken ilerleme izleme sürmeli mi?";
  const running: RunRecord = {
    runId,
    idempotencyKey: "browser-fixture",
    requestHash: "browser-fixture",
    question,
    promptVersion: "council-v1",
    promptFingerprint: "a".repeat(64),
    riskProfile: "standard",
    snapshotId: "browser-fixture",
    memberCount: 2,
    memoryEntryCount: 0,
    attachmentCount: 0,
    toolResultCount: 0,
    createdAt: new Date().toISOString(),
    status: "running",
    report: null,
  };
  let completed = false;
  let pollCount = 0;

  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", { value: undefined });
  });
  await page.route("**/api/provider-connections", async (route) => {
    await route.fulfill({ json: { connections: [{
      id: "browser-connection",
      provider: "openai",
      label: "Tarayıcı bağlantısı",
      defaultModel: "fixture-model",
      configured: true,
      endpointPreset: "custom",
      reasoningProtocol: "openai",
      structuredOutputMode: "json-schema",
    }] } });
  });
  await page.route("**/api/runs/token-preview", async (route) => {
    const body = route.request().postDataJSON() as { members: Array<{ id: string; label: string; model: string }> };
    await route.fulfill({ json: {
      totalTokens: 100,
      questionTokens: 20,
      textTokens: 20,
      imageTokens: 0,
      documentTokens: 0,
      members: body.members.map((member) => ({ ...member, totalTokens: 50, imageTokens: 0, documentTokens: 0 })),
      imageCount: 0,
      documentCount: 0,
      contextEntryCount: 0,
      promptPlan: { version: "council-v1", fingerprint: "a".repeat(64), members: [] },
      riskPreflight: { fingerprint: "b".repeat(64), assessment: { policyVersion: "risk-rules-v1", requestedProfile: "standard", effectiveProfile: "standard", signals: [] } },
    } });
  });
  await page.route("**/api/runs", async (route) => {
    await route.fulfill(route.request().method() === "POST"
      ? { status: 201, json: running }
      : { json: { runs: [], nextCursor: null } });
  });
  await page.route(`**/api/runs/${runId}/events?**`, async (route) => {
    pollCount += 1;
    await route.fulfill({ json: {
      run: completed ? { ...running, status: "completed" } : running,
      events: [],
    } });
  });
  await page.route(`**/api/runs/${runId}/usage`, async (route) => {
    await route.fulfill({ json: {
      runId, operationCount: 0, inputReportCount: 0, outputReportCount: 0,
      reportedInputTokens: 0, reportedOutputTokens: 0, uncertainUsageCount: 0,
      tokenDetails: Object.fromEntries(["totalTokens", "cachedInputTokens", "cacheWriteInputTokens", "reasoningTokens", "toolInputTokens"]
        .map((key) => [key, { reportedTokens: null, reportCount: 0 }])),
      recentOperationsTruncated: false, operations: [],
    } });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Konseyi çalıştır" })).toBeEnabled();
  await page.getByLabel("Sorunuz").fill(question);
  await expect(page.getByRole("button", { name: "Konseyi çalıştır" })).toBeEnabled();
  await page.getByRole("button", { name: "Konseyi çalıştır" }).click();
  await expect(page.getByText("Konsey çalışıyor", { exact: true })).toBeVisible();

  // The old fallback stopped after 120 quarter-second polls (about 30 seconds).
  await page.waitForTimeout(31_500);
  expect(pollCount).toBeGreaterThan(1);
  await expect(page.getByText("Konsey çalışıyor", { exact: true })).toBeVisible();
  await expect(page.getByText("Çalışma beklenen sürede tamamlanmadı; daha sonra tekrar açın.")).toHaveCount(0);

  completed = true;
  await expect(page.getByText("Konsey tamamlandı", { exact: true })).toBeVisible({ timeout: 5_000 });
});
