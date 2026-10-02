import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import type { ExecutionLimits } from "@deliberation-ai/contracts";
import { cancelDurableRun, closeDatabase, deleteProviderConnection, getDatabase, getProviderBilling, recordProviderPrice, recordProviderBilling, recordProviderBillingChange, recordBillingReallocation } from "@deliberation-ai/persistence";
import { eq, inArray, or } from "drizzle-orm";
import { providerBillingChanges, providerBillingClaims, providerBillingReallocations, providerBillingRecords, providerOperations, providerPriceSnapshots, runs } from "../../packages/persistence/src/schema";

test("reruns only the selected member against a local mock endpoint", async ({ page, request }) => {
  let calls = 0;
  const sentMaxOutputTokens: Array<number | undefined> = [];
  const executionLimits: ExecutionLimits = { version: "dispatch-limits-v1", maxProviderCalls: 2,
    maxOutputTokensPerCall: 1_024, maxReservedOutputTokens: 2_048 };
  const server: Server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { max_tokens?: number };
    sentMaxOutputTokens.push(body.max_tokens);
    calls += 1;
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ id: `offline-${calls}`, model: "offline-rerun",
      choices: [{ message: { content: JSON.stringify({ summary: `Yerel yanıt ${calls}`,
        claims: [{ statement: `Yerel iddia ${calls}`, kind: "recommendation", quote: `Yerel iddia ${calls}` }] }) } }],
      usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 2 } } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local fixture server did not bind.");
  let connectionId: string | undefined;
  let question: string | undefined;
  const runIds: string[] = [];
  try {
    const saved = await request.post("/api/provider-connections", { data: {
      provider: "openai-compatible", label: `E2E rerun ${crypto.randomUUID()}`, apiKey: "",
      defaultModel: "offline-rerun", baseUrl: `http://127.0.0.1:${address.port}/v1`,
      endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object",
    } });
    expect(saved.ok()).toBe(true);
    connectionId = (await saved.json() as { id: string }).id;
    const observation = { version: "token-price-v1" as const, connectionId, model: "offline-rerun", sourceUrl: "https://example.com/offline-pricing",
      observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 86_400_000).toISOString(), currency: "USD" as const,
      inputBasis: "inclusive" as const, outputBasis: "inclusive" as const, maxInputTokens: 200_000,
      inputUsdPerMillion: "2", outputUsdPerMillion: "8", cachedInputUsdPerMillion: "0.5" };
    await recordProviderPrice(observation);
    question = `Yerel tekrar akışı hangi iddiaları koruyor ${crypto.randomUUID()}?`;
    const created = await request.post("/api/runs", { data: {
      question, idempotencyKey: crypto.randomUUID(), providerMode: "remote", reviewRounds: 0, executionLimits,
      members: ["member-a", "member-b"].map((id) => ({ id, label: id, role: "Analist",
        provider: "openai-compatible", connectionId, model: "offline-rerun",
        reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst" })),
    } });
    expect(created.status()).toBe(201);
    const sourceRunId = (await created.json() as { runId: string }).runId;
    runIds.push(sourceRunId);
    await expect.poll(async () => (await request.get(`/api/runs/${sourceRunId}`)).json()
      .then((body: { status: string }) => body.status), { timeout: 20_000 }).toBe("completed");
    expect(calls).toBe(2);
    expect(sentMaxOutputTokens).toEqual([1_024, 1_024]);
    const sourceUsage = await (await request.get(`/api/runs/${sourceRunId}/usage`)).json() as { executionBudget: unknown };
    expect(sourceUsage.executionBudget).toEqual({ limits: executionLimits, submittedCalls: 2,
      reservedOutputTokens: 2_048, remainingCalls: 0, remainingOutputTokens: 0 });

    await page.goto("/");
    await page.locator(`[data-run-id="${sourceRunId}"]`).getByRole("button", { name: "Çalışmayı aç" }).click();
    await expect(page.getByRole("region", { name: "Gönderim rezervasyonu" })).toContainText("2 çağrı için 2.048 yanıt tokenı ayrıldı.");
    await expect(page.getByRole("region", { name: "Token maliyet tahmini", exact: true })).toContainText("0.000132000000 USD");
    await expect(page.getByRole("region", { name: "Gözden geçirilmiş fatura kayıtları" })).toContainText("Eşleştirilmiş fatura tutarı yok");
    const [receipt] = await getDatabase().select().from(providerOperations).where(eq(providerOperations.runId, sourceRunId));
    const bill = await recordProviderBilling({ version: "provider-billing-v1", operationId: receipt!.id, connectionId, provider: "openai-compatible",
      model: "offline-rerun", remoteResponseId: receipt!.remoteResponseId!, statementId: "offline-browser-statement", lineId: "1",
      documentSha256: "a".repeat(64), billedAt: new Date(Date.now() - 1000).toISOString(), reviewedAt: new Date().toISOString(),
      attribution: "exact_remote_response", scope: "all_charges_for_this_attempt", currency: "USD", totalUsd: "0.01",
      components: [{ kind: "tokens", amountUsd: "0.001" }, { kind: "tools", amountUsd: "0.009" }] }, "a".repeat(64));
    await page.getByRole("button", { name: "Kullanımı yenile" }).click();
    const billingPanel = page.getByRole("region", { name: "Gözden geçirilmiş fatura kayıtları" });
    await expect(billingPanel).toContainText("0.010000000000 USD");
    await expect(billingPanel).toContainText("1 çağrı için kayıt bekleniyor");
    const voided = await recordProviderBillingChange({ version: "provider-billing-change-v1", recordId: bill.id,
      expectedFingerprint: bill.currentFingerprint, documentSha256: bill.documentSha256, reviewedAt: new Date().toISOString(),
      reason: "Withdraw synthetic browser evidence", action: "void" }, bill.documentSha256);
    await page.getByRole("button", { name: "Kullanımı yenile" }).click();
    await expect(billingPanel).toContainText("Eşleştirilmiş fatura tutarı yok");
    await expect(billingPanel).toContainText("2 çağrı için kayıt bekleniyor");
    await expect(billingPanel).toContainText("1 kayıt iptal edildi");
    await expect(billingPanel).toContainText("sağlayıcı ücretini sıfırlamaz");
    const reviewedAt = new Date().toISOString();
    await recordProviderBillingChange({ version: "provider-billing-change-v1", recordId: bill.id, expectedFingerprint: voided.fingerprint,
      documentSha256: bill.documentSha256, reviewedAt, reason: "Correct synthetic browser amount", action: "replace",
      replacement: { version: bill.version, operationId: bill.operationId, connectionId: bill.connectionId, provider: bill.provider,
        model: bill.model, remoteResponseId: bill.remoteResponseId, statementId: bill.statementId, lineId: bill.lineId,
        documentSha256: bill.documentSha256, billedAt: bill.billedAt, reviewedAt, attribution: bill.attribution, scope: bill.scope,
        currency: "USD", totalUsd: "0.015", components: [{ kind: "tokens", amountUsd: "0.001" }, { kind: "tools", amountUsd: "0.014" }] } }, bill.documentSha256);
    await page.getByRole("button", { name: "Kullanımı yenile" }).click();
    await expect(billingPanel).toContainText("0.015000000000 USD");
    await expect(billingPanel).toContainText("0 kayıt iptal edildi");
    await page.getByText("İşlem ayrıntıları (2)", { exact: true }).click();
    await page.getByText("Fatura eşleştirmesi: 0.015 USD", { exact: true }).click();
    await page.getByText("Düzeltme geçmişi (2)", { exact: true }).click();
    await expect(page.getByText(/Withdraw synthetic browser evidence/)).toBeVisible();
    await expect(page.getByText(/İlk kayıt: 0.01 USD/)).toBeVisible();
    const corrected = (await getProviderBilling(bill.id))!;
    const receipts = await getDatabase().select().from(providerOperations).where(eq(providerOperations.runId, sourceRunId));
    const target = receipts.find((item) => item.id !== bill.operationId)!;
    const transferReview = new Date().toISOString();
    await recordBillingReallocation({ version: "provider-billing-reallocation-v1", sourceRecordId: bill.id, expectedFingerprint: corrected.currentFingerprint,
      documentSha256: bill.documentSha256, reviewedAt: transferReview, reason: "Correct synthetic browser receipt attribution", replacement: {
        version: bill.version, operationId: target.id, connectionId: bill.connectionId, provider: target.provider, model: target.model, remoteResponseId: target.remoteResponseId!,
        statementId: bill.statementId, lineId: bill.lineId, documentSha256: bill.documentSha256, billedAt: bill.billedAt, reviewedAt: transferReview,
        attribution: bill.attribution, scope: bill.scope, currency: bill.currency, totalUsd: corrected.totalUsd, components: corrected.components } }, bill.documentSha256);
    await page.getByRole("button", { name: "Kullanımı yenile" }).click();
    await expect(billingPanel).toContainText("0.015000000000 USD");
    await expect(billingPanel).toContainText("1 eski eşleştirme başka kayda taşındı");
    await expect(billingPanel).toContainText("Eski çağrının ücreti sıfır kabul edilmez");
    const operationsSummary = page.getByText("İşlem ayrıntıları (2)", { exact: true });
    if (await operationsSummary.locator("..").getAttribute("open") === null) await operationsSummary.click();
    const movedSummary = page.getByText("Fatura eşleştirmesi: başka kayda taşındı", { exact: true });
    if (await movedSummary.locator("..").getAttribute("open") === null) await movedSummary.click();
    await expect(page.getByText(/Eski eşleştirme ara toplama katılmaz/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Token maliyet tahmini", exact: true })).toContainText("0.000132000000 USD");
    await recordProviderPrice({ ...observation, inputUsdPerMillion: "4" });
    await expect(page.getByText("en fazla 1 yeni sağlayıcı çağrısı", { exact: false })).toBeVisible();
    const firstMember = page.locator(".member-card").first();
    await firstMember.locator("summary").click();
    const attemptKeys: string[] = [];
    await page.route(`**/api/runs/${sourceRunId}/member-rerun`, async (route) => {
      attemptKeys.push((route.request().postDataJSON() as { idempotencyKey: string }).idempotencyKey);
      const response = await route.fetch();
      if (attemptKeys.length === 1) await route.abort("failed"); // server committed, browser lost its response
      else await route.fulfill({ response });
    });
    await firstMember.getByRole("button", { name: "Bu üyeyi yeniden çalıştır (API çağrısı)" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await firstMember.getByRole("button", { name: "Bu üyeyi yeniden çalıştır (API çağrısı)" }).click();
    await expect(page.getByText(/Takip çalışması:/)).toBeVisible();
    await expect(page.getByText("Konsey tamamlandı")).toBeVisible({ timeout: 20_000 });
    expect(calls).toBe(3);
    expect(sentMaxOutputTokens).toEqual([1_024, 1_024, 1_024]);
    expect(attemptKeys).toHaveLength(2);
    expect(attemptKeys[0]).toBe(attemptKeys[1]);
    const usagePanel = page.getByRole("region", { name: "Sağlayıcının bildirdiği token kullanımı" });
    await expect(usagePanel.getByRole("region", { name: "Token maliyet tahmini", exact: true })).toContainText("0.000084000000 USD");
    await expect(usagePanel.getByRole("region", { name: "Gözden geçirilmiş fatura kayıtları" })).toContainText("Eşleştirilmiş fatura tutarı yok");
    await expect(usagePanel.getByText("Sağlayıcı toplamı: 15 · 1/1 işlem bildirdi", { exact: true })).toBeVisible();
    await expect(usagePanel.getByText("Düşünme: 2 · 1/1 işlem bildirdi", { exact: true })).toBeVisible();
    await expect(usagePanel.getByRole("region", { name: "Gönderim rezervasyonu" })).toContainText("1 çağrı için 1.024 yanıt tokenı ayrıldı.");
    const history = await (await request.get("/api/runs")).json() as { runs: Array<{ runId: string; question: string }> };
    const childId = history.runs.find((item) => item.question === question && item.runId !== sourceRunId)?.runId;
    expect(history.runs.filter((item) => item.question === question)).toHaveLength(2);
    expect(childId).toBeTruthy();
    runIds.push(childId!);
    const child = await (await request.get(`/api/runs/${childId}`)).json() as {
      executionLimits: ExecutionLimits; followUp: { sourceRunId: string }; report: { memberResults: Array<{ reusedFromRunId?: string }> };
    };
    expect(child.followUp.sourceRunId).toBe(sourceRunId);
    expect(child.executionLimits).toEqual(executionLimits);
    expect(child.report.memberResults.filter((item) => item.reusedFromRunId === sourceRunId)).toHaveLength(1);
    const source = await (await request.get(`/api/runs/${sourceRunId}`)).json() as {
      executionLimits: ExecutionLimits; report: { memberResults: Array<{ reusedFromRunId?: string }> };
    };
    expect(source.report.memberResults.every((item) => !item.reusedFromRunId)).toBe(true);
    expect(source.executionLimits).toEqual(executionLimits);
    const childUsage = await (await request.get(`/api/runs/${childId}/usage`)).json() as { executionBudget: unknown };
    expect(childUsage.executionBudget).toEqual({ limits: executionLimits, submittedCalls: 1,
      reservedOutputTokens: 1_024, remainingCalls: 1, remainingOutputTokens: 1_024 });
    const reopenedSourceUsage = await (await request.get(`/api/runs/${sourceRunId}/usage`)).json() as { executionBudget: unknown };
    expect(reopenedSourceUsage.executionBudget).toEqual(sourceUsage.executionBudget);
  } finally {
    if (question) {
      const historyResponse = await request.get("/api/runs").catch(() => null);
      if (historyResponse?.ok()) {
        const history = await historyResponse.json() as { runs: Array<{ runId: string; question: string }> };
        runIds.push(...history.runs.filter((item) => item.question === question).map((item) => item.runId));
      }
    }
    const fixtureIds = [...new Set(runIds)];
    for (const id of fixtureIds) await cancelDurableRun(id);
    if (fixtureIds.length > 0) {
      const bills = await getDatabase().select({ id: providerBillingRecords.id }).from(providerBillingRecords).where(inArray(providerBillingRecords.runId, fixtureIds));
      if (bills.length) await getDatabase().delete(providerBillingReallocations).where(or(inArray(providerBillingReallocations.sourceRecordId, bills.map((item) => item.id)), inArray(providerBillingReallocations.targetRecordId, bills.map((item) => item.id))));
      if (bills.length) await getDatabase().delete(providerBillingChanges).where(inArray(providerBillingChanges.recordId, bills.map((item) => item.id)));
      if (bills.length) await getDatabase().delete(providerBillingClaims).where(inArray(providerBillingClaims.recordId, bills.map((item) => item.id)));
      await getDatabase().delete(providerBillingRecords).where(inArray(providerBillingRecords.runId, fixtureIds));
      await getDatabase().delete(runs).where(inArray(runs.id, fixtureIds));
    }
    if (connectionId) {
      await getDatabase().delete(providerPriceSnapshots).where(eq(providerPriceSnapshots.connectionId, connectionId));
      await deleteProviderConnection(connectionId);
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closeDatabase();
  }
});

test("keeps limits optional and blocks an insufficient plan before any dispatch", async ({ page }) => {
  let runSubmissions = 0;
  let scheduleSubmissions = 0;
  // Browser-only connection metadata enables the form; no credential or connection is saved.
  await page.route("**/api/provider-connections", async (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    await route.fulfill({ json: { connections: [{ id: crypto.randomUUID(), provider: "openai-compatible",
      label: "E2E limits browser-only", defaultModel: "offline-ui", configured: true,
      baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "litellm", reasoningProtocol: "none",
      structuredOutputMode: "json-object" }] } });
  });
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    runSubmissions += 1;
    await route.abort("blockedbyclient");
  });
  await page.route("**/api/local-schedules", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    scheduleSubmissions += 1;
    await route.abort("blockedbyclient");
  });
  await page.goto("/");
  const option = page.getByRole("checkbox", { name: "Bu çalışma için çağrı ve yanıt kotası sınırı uygula", exact: true });
  const limitPanel = page.getByRole("region", { name: "Çağrı ve yanıt kotası sınırları", exact: true });
  const start = page.getByRole("button", { name: "Konseyi çalıştır", exact: true });
  const schedulePanel = page.getByRole("region", { name: "Yerel zamanlamalar", exact: true });
  const createSchedule = schedulePanel.getByRole("button", { name: "Duraklatılmış zamanlama oluştur", exact: true });
  await expect(option).not.toBeChecked();
  await expect(page.getByLabel("En fazla API çağrısı", { exact: true })).toHaveCount(0);
  await expect(start).toBeEnabled();
  await schedulePanel.getByLabel("Zamanlama adı", { exact: true }).fill("E2E limits no dispatch");
  await expect(createSchedule).toBeEnabled();
  await option.check();
  const callLimit = page.getByLabel("En fazla API çağrısı", { exact: true });
  const perCall = page.getByLabel("Çağrı başına yanıt tokenı kotası", { exact: true });
  const quota = page.getByLabel("Toplam yanıt tokenı rezervasyon kotası", { exact: true });
  await expect(page.getByText("Seçili üyeler ve inceleme turları için planlanan tam çalışma: 4 API çağrısı.", { exact: false })).toBeVisible();
  await expect(start).toBeEnabled();
  await callLimit.fill("3");
  await expect(limitPanel.getByRole("alert")).toContainText("en az 4 çağrı gerekir");
  await expect(start).toBeDisabled();
  await expect(createSchedule).toBeDisabled();
  await page.getByLabel("Sorunuz", { exact: true }).press("Control+Enter");
  await callLimit.fill("4");
  await perCall.fill("1024");
  await quota.fill("4095");
  await expect(limitPanel.getByRole("alert")).toContainText("en az 4.096 yanıt tokenı");
  await expect(start).toBeDisabled();
  await expect(createSchedule).toBeDisabled();
  await quota.fill("4096");
  await expect(start).toBeEnabled();
  await expect(createSchedule).toBeEnabled();
  await page.getByRole("combobox", { name: "Çapraz inceleme turu", exact: true }).selectOption("3");
  await expect(limitPanel.getByRole("alert")).toContainText("en az 8 çağrı gerekir");
  await expect(start).toBeDisabled();
  await expect(createSchedule).toBeDisabled();
  await option.uncheck();
  await expect(start).toBeEnabled();
  await expect(createSchedule).toBeEnabled();
  expect(runSubmissions).toBe(0);
  expect(scheduleSubmissions).toBe(0);
});
