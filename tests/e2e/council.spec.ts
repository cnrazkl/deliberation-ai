import { withOwner } from "@deliberation-ai/persistence";
import { revealCouncilControls, workspaceView } from "./workspace-navigation";
import {expect, test, testOwnerId } from "./authenticated-test";
import {
  closeDatabase,
  fingerprintProviderRequest,
  prepareProviderOperation,
  updateProviderOperation,
} from "@deliberation-ai/persistence";

function textPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

let createdConnectionLabels: string[] = [];

test.afterEach(async ({ request }) => {
  const response = await request.get("/api/provider-connections");
  if (response.ok()) {
    const body = await response.json() as { connections: Array<{ id: string; label: string }> };
    for (const connection of body.connections.filter(({ label }) => createdConnectionLabels.includes(label))) {
      await request.delete(`/api/provider-connections?id=${encodeURIComponent(connection.id)}`);
    }
  }
  createdConnectionLabels = [];
  await closeDatabase();
});

test("shows the selected three-round limit and the saved later-round review trail", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  test.setTimeout(60_000);
  await page.goto("/"); await revealCouncilControls(page);
  const roundChoice = page.getByLabel("Çapraz inceleme turu");
  await expect(roundChoice).toHaveValue("1");
  await roundChoice.selectOption("3");
  await expect(roundChoice).toHaveValue("3");
  const created = await request.post("/api/runs", { data: {
    question: "Üç çapraz inceleme turunda koşullar nasıl karşılaştırılır?",
    idempotencyKey: crypto.randomUUID(),
    providerMode: "fake",
    reviewRounds: 3,
  } });
  expect(created.status()).toBe(201);
  const { runId } = await created.json() as { runId: string };
  await expect.poll(async () => {
    const response = await request.get(`/api/runs/${runId}`);
    return (await response.json() as { status: string }).status;
  }, { timeout: 20_000 }).toBe("completed");
  await page.locator(".run-history").getByRole("button", { name: "Listeyi yenile" }).click();
  const entry = page.locator(`.run-history [data-run-id="${runId}"]`);
  await entry.getByRole("button", { name: "Çalışmayı aç" }).click();
  const review = page.getByRole("region", { name: "Çapraz incelemeler" });
  await expect(review).toContainText("6 tamamlanan inceleme");
  await expect(review).toContainText("eksiksiz tamamlanan tur: 3");
  await expect(review).toContainText("Tur 3 · Analist");
  await review.locator(".review-prompt-plan summary").click();
  await expect(review.locator(".review-prompt-plan")).toContainText("cross-review-v2");
  const persisted = await (await request.get(`/api/runs/${runId}`)).json() as { report: {
    reviewExecution: { requestedRounds: number; completedRounds: number };
    reviews: Array<{ round: number }>;
    reviewPromptPlans: Array<{ round: number; input: string }>;
  } };
  expect(persisted.report.reviewExecution).toMatchObject({ requestedRounds: 3, completedRounds: 3 });
  expect(persisted.report.reviews.map((item) => item.round)).toEqual([1, 1, 2, 2, 3, 3]);
  expect(persisted.report.reviewPromptPlans[4]?.input).toContain('"previousRound":2');
}));

test("shows opt-in self-revision proposals beside unchanged initial claims", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  test.setTimeout(60_000);
  await page.goto("/"); await revealCouncilControls(page);
  const option = page.getByRole("checkbox", { name: "Üyelerin kendi ilk iddiaları için düzeltme önerisi üretmesine izin ver" });
  await expect(option).not.toBeChecked();
  await option.check();
  await expect(option).toBeChecked();
  const created = await request.post("/api/runs", { data: {
    question: "Özgün iddialar ve üyelerin düzeltme önerileri nasıl gösterilir?",
    idempotencyKey: crypto.randomUUID(), providerMode: "fake", reviewRounds: 1, selfRevisionEnabled: true,
  } });
  expect(created.status()).toBe(201);
  const { runId } = await created.json() as { runId: string };
  await expect.poll(async () => (await (await request.get(`/api/runs/${runId}`)).json() as { status: string }).status,
    { timeout: 20_000 }).toBe("completed");
  await page.locator(".run-history").getByRole("button", { name: "Listeyi yenile" }).click();
  await page.locator(`.run-history [data-run-id="${runId}"]`).getByRole("button", { name: "Çalışmayı aç" }).click();
  const review = page.getByRole("region", { name: "Çapraz incelemeler" });
  await expect(review).toContainText("Öz düzeltme önerileri · ilk iddialar korunur");
  await expect(review).toContainText("İlk iddia 1:");
  await expect(review).toContainText("Niteleme önerisi:");
  await review.locator(".review-prompt-plan summary").click();
  await expect(review.locator(".review-prompt-plan")).toContainText("cross-review-v3");
}));

test("runs a durable council and exposes a partial member failure", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  test.setTimeout(60_000);
  let failNextRun = false;
  const submittedRunIds: string[] = [];
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const submitted = route.request().postDataJSON() as { expectedPreflightFingerprint?: string; expectedRiskFingerprint?: string; members: Array<{ id: string; label: string; role: string; councilRole: "analyst" | "red-team" }> };
    expect(submitted.expectedPreflightFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(submitted.expectedRiskFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const response = await route.fetch({
      postData: JSON.stringify({
        ...submitted,
        expectedPreflightFingerprint: undefined,
        expectedRiskFingerprint: undefined,
        providerMode: "fake",
        scenario: failNextRun ? "member-b-fails" : "success",
        members: submitted.members.map((member, index) => ({
          id: member.id,
          label: member.label,
          role: member.role,
          councilRole: member.councilRole,
          provider: "fake",
          model: "deterministic-fixture-v1",
          perspective: (["procedural", "risk", "evidence", "assumptions", "alternatives", "implementation"] as const)[index],
        })),
      }),
    });
    failNextRun = false;
    if (response.ok()) {
      const body = await response.json() as { runId: string };
      submittedRunIds.push(body.runId);
    }
    await route.fulfill({ response });
  });
  const priorDecisionConnections = await request.get("/api/decision-connections");
  if (priorDecisionConnections.ok()) {
    const body = (await priorDecisionConnections.json()) as {
      connections: Array<{ id: string; label: string }>;
    };
    for (const connection of body.connections.filter(({ label }) => label.startsWith("E2E TypeSafe "))) {
      await request.delete(`/api/decision-connections?id=${encodeURIComponent(connection.id)}`);
    }
  }
  const blocked = await request.post("/api/runs", {
    headers: { origin: "https://untrusted.example" },
    data: {
      question: "Kaynağı eşleşmeyen tarayıcı isteği reddedilmeli",
      idempotencyKey: crypto.randomUUID(),
      scenario: "success",
      providerMode: "fake",
    },
  });
  expect(blocked.status()).toBe(403);
  const invalidHighRisk = await request.post("/api/runs", { data: {
    question: "Yüksek risk kontrolleri eksikken istek reddediliyor mu?",
    idempotencyKey: crypto.randomUUID(),
    providerMode: "fake",
    riskProfile: "high",
    reviewRounds: 0,
  } });
  expect(invalidHighRisk.status()).toBe(422);
  expect((await invalidHighRisk.json() as { error: string }).error).toContain("Yüksek riskte");
  const stalePreflight = await request.post("/api/runs", { data: {
    question: "Önizleme izi değişirse model çağrısından önce reddediliyor mu?",
    idempotencyKey: crypto.randomUUID(),
    providerMode: "fake",
    expectedPreflightFingerprint: "0".repeat(64),
  } });
  expect(stalePreflight.status()).toBe(409);
  expect((await stalePreflight.json() as { error: string }).error).toContain("Önizleme değişti");

  await page.goto("/"); await revealCouncilControls(page);
  await expect(
    page.getByRole("heading", { name: "Birlikte düşünelim." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Yerel deneme" })).toHaveCount(0);
  const initialQuestion = await page.getByRole("textbox", { name: "Sorunuz", exact: true }).inputValue();
  await page.getByRole("textbox", { name: "Sorunuz", exact: true }).fill("");
  await expect(page.locator(".token-preview")).toContainText("Sorunuz ve ekleriniz: 0 token");
  await page.getByRole("textbox", { name: "Sorunuz", exact: true }).fill(initialQuestion);

  const connectionSuffix = Date.now();
  const firstConnection = `E2E bağlantı A ${connectionSuffix}`;
  const secondConnection = `E2E bağlantı B ${connectionSuffix}`;
  const providerSettings = page.locator("details").filter({ hasText: "Yerel sağlayıcı bağlantıları" });
  await workspaceView(page, "Ayarlar");
  await providerSettings.locator("summary").click();
  for (const [label, model] of [
    [firstConnection, "e2e-model-a"],
    [secondConnection, "e2e-model-b"],
  ]) {
    await providerSettings.getByLabel("Bağlantı adı").fill(label);
    await page.getByLabel("API anahtarı").fill(`sk-test-${label}-1234567890`);
    await page.getByLabel("Başlangıç modeli (görev sırasında değiştirilebilir)").fill(model);
    await page.getByRole("button", { name: "Yeni bağlantıyı şifrele" }).click();
    await expect(page.locator(".connection-list")).toContainText(label);
  }
  const localConnection = `E2E Ollama ${connectionSuffix}`;
  await page.getByLabel("Sağlayıcı ailesi").selectOption("openai-compatible");
  await page.getByLabel("Uç nokta türü").selectOption("ollama");
  await providerSettings.getByLabel("Bağlantı adı").fill(localConnection);
  await page.getByLabel("Başlangıç modeli (görev sırasında değiştirilebilir)").fill("qwen3");
  await page.getByRole("button", { name: "Yeni bağlantıyı şifrele" }).click();
  await expect(page.locator(".connection-list")).toContainText(localConnection);
  const openRouterConnection = `E2E OpenRouter ${connectionSuffix}`;
  createdConnectionLabels = [firstConnection, secondConnection, localConnection, openRouterConnection];
  await page.getByLabel("Uç nokta türü").selectOption("openrouter");
  await providerSettings.getByLabel("Bağlantı adı").fill(openRouterConnection);
  await page.getByLabel("API anahtarı").fill("sk-or-test-only-never-sent-1234567890");
  await page
    .getByLabel("Başlangıç modeli (görev sırasında değiştirilebilir)")
    .fill("openai/gpt-5.6-sol");
  await page.getByRole("button", { name: "Yeni bağlantıyı şifrele" }).click();
  const openRouterCard = page.locator(".connection-status").filter({ hasText: openRouterConnection });
  await expect(openRouterCard).toContainText("Hazırda · bu görevde kullanılmıyor");

  await workspaceView(page, "Sohbet");
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  const attachmentInput = page.getByLabel("Görev ekleri (isteğe bağlı)");
  await attachmentInput.setInputFiles({ name: "e2e-diagram.png", mimeType: "image/png", buffer: tinyPng });
  await expect(page.locator(".attachment-list")).toContainText("e2e-diagram.png");
  await attachmentInput.setInputFiles({ name: "sahte.pdf", mimeType: "application/pdf", buffer: Buffer.from("not-a-pdf") });
  await expect(page.locator(".attachment-picker [role=alert]")).toContainText("dosya biçimi içerikle eşleşmiyor");
  await expect(page.locator(".attachment-list")).toContainText("e2e-diagram.png");
  await attachmentInput.setInputFiles({ name: "karar.pdf", mimeType: "application/pdf", buffer: textPdf("Contract condition is documented") });
  await expect(page.locator(".attachment-list")).toContainText("karar.pdf");
  await expect(page.locator(".attachment-list span")).toHaveCount(2);
  await expect(page.getByLabel("Üye 1 görev eklerini alsın")).toBeChecked();
  await expect(page.getByText(/Konseyin ilk turu/)).toBeVisible();
  await expect(page.locator(".token-preview")).toContainText("görseller ≈");
  await expect(page.locator(".token-preview")).toContainText("PDF metni ≈");
  await page.getByText("Üyelere gönderilecek metni incele · council-v1").click();
  await expect(page.locator(".prompt-plan-preview")).toContainText("Sistem yönergesi");
  await expect(page.locator(".prompt-plan-preview")).toContainText("Contract condition is documented");
  const firstEstimate = await page.locator(".token-preview strong").first().innerText();
  const questionField = page.getByLabel("Sorunuz");
  const originalQuestion = await questionField.inputValue();
  await questionField.fill(`${originalQuestion} Ayrıca başarısızlık koşullarını ve alternatif planları ayrıntılı değerlendir.`);
  await expect(page.locator(".token-preview strong").first()).not.toHaveText(firstEstimate);
  await questionField.fill(originalQuestion);

  const firstConnectionCard = page.locator(".connection-status").filter({ hasText: firstConnection });
  await workspaceView(page, "Ayarlar");
  await firstConnectionCard.getByRole("button", { name: "Düzenle" }).click();
  await page
    .getByLabel("Başlangıç modeli (görev sırasında değiştirilebilir)")
    .fill("e2e-model-a-updated");
  await page.getByRole("button", { name: "Bağlantıyı güncelle" }).click();
  await expect(firstConnectionCard).toContainText("e2e-model-a-updated");

  await workspaceView(page, "Sohbet");
  await page.getByLabel("Üye 1 bağlantısı").selectOption({ label: `${secondConnection} · OpenAI` });
  await expect(page.getByLabel("Üye 1 modeli")).toHaveValue("e2e-model-b");
  await page.getByLabel("Üye 1 modeli").fill("gpt-5-pro");
  await expect(page.getByText(/GPT-5 Pro yalnızca yüksek düşünme seviyesini/)).toBeVisible();
  await page.getByLabel("Üye 1 modeli").fill("gpt-5.6-sol");
  await page.getByLabel("Üye 1 düşünme seviyesi").selectOption("max");
  await page.getByLabel("Üye 1 web erişimi").selectOption("auto");
  await expect(
    page.locator(".connection-status").filter({ hasText: secondConnection }),
  ).toContainText("Bu görevde 1 üye");
  await page.getByLabel("Üye sayısı").selectOption("3");
  await page.getByLabel("Üye 3 adı").fill("Kanıt Uzmanı");
  await page.getByLabel("Üye 3 rolü").fill("Kaynak ve kanıt denetçisi");
  await page.getByLabel("Red-team karşılaştırmasını etkinleştir").check();
  await expect(page.getByLabel("Üye sayısı")).toHaveValue("4");
  await expect(page.getByLabel("Üye 4 konsey görevi")).toHaveValue("red-team");
  const templateName = `E2E dört üye ${Date.now()}`;
  await page.getByLabel("Şablon adı").fill(templateName);
  await page.getByRole("button", { name: "Şablonu kaydet" }).click();
  await expect(page.locator(".template-button").filter({ hasText: templateName })).toBeVisible();
  await page.getByLabel("Üye sayısı").selectOption("2");
  await page.locator(".template-button").filter({ hasText: templateName }).click();
  await expect(page.getByLabel("Üye sayısı")).toHaveValue("4");
  await expect(page.getByLabel("Üye 3 adı")).toHaveValue("Kanıt Uzmanı");

  await workspaceView(page, "Sohbet");
  await page.getByLabel("Sorunuz").fill(
    "Tarayıcıdan başlatılan konsey çalışması kalıcı kuyrukta doğru şekilde sonuçlanıyor mu?",
  );
  await page.getByLabel("Değerlendirme profili").selectOption("high");
  await expect(page.getByLabel("Red-team karşılaştırmasını etkinleştir")).toBeDisabled();
  await expect(page.getByLabel("Çapraz inceleme turu")).toHaveValue("1");
  await expect(page.getByLabel("Çapraz inceleme turu").locator('option[value="0"]')).toHaveAttribute("disabled", "");
  const scheduleName = `E2E zamanlama ${connectionSuffix}`;
  const scheduleRegion = page.getByRole("region", { name: "Yerel zamanlamalar" });
  await workspaceView(page, "Zamanlayıcı");
  await scheduleRegion.getByLabel("Zamanlama adı").fill(scheduleName);
  await scheduleRegion.getByRole("button", { name: "Duraklatılmış zamanlama oluştur" }).click();
  const scheduleCard = scheduleRegion.locator("article").filter({ hasText: scheduleName });
  await expect(scheduleCard).toContainText("Duraklatıldı");
  await expect(scheduleCard).toContainText("yüksek risk");
  let failSchedulePatch = true;
  let failScheduleDelete = true;
  await page.route(/\/api\/local-schedules(?:\?id=|\/[^/]+\/deletion)/, async (route) => {
    if (route.request().method() === "PATCH" && failSchedulePatch) {
      failSchedulePatch = false;
      await route.fulfill({ status: 503, json: { error: "E2E zamanlama güncelleme hatası" } });
      return;
    }
    if (route.request().method() === "POST" && failScheduleDelete) {
      failScheduleDelete = false;
      await route.fulfill({ status: 503, json: { error: "E2E zamanlama silme hatası" } });
      return;
    }
    await route.continue();
  });
  await scheduleCard.getByRole("button", { name: "Etkinleştir" }).click();
  await expect(scheduleRegion).toContainText("E2E zamanlama güncelleme hatası");
  await expect(scheduleCard).toContainText("Duraklatıldı");
  await expect(scheduleCard.getByRole("button", { name: "Etkinleştir" })).toBeEnabled();
  await scheduleCard.getByRole("button", { name: "Etkinleştir" }).click();
  await expect(scheduleCard).toContainText("Etkin");
  await scheduleCard.getByRole("button", { name: "Duraklat" }).click();
  await expect(scheduleCard).toContainText("Duraklatıldı");

  await workspaceView(page, "Ayarlar");
  const mcpRegion = page.getByRole("region", { name: "Yerel MCP araçları" });
  const mcpName = `E2E MCP ${connectionSuffix}`;
  await mcpRegion.getByLabel("Bağlantı adı").fill(mcpName);
  await mcpRegion.getByLabel("Yerel MCP adresi").fill("http://127.0.0.1:39999/mcp");
  await mcpRegion.getByRole("button", { name: "Bağlantıyı kaydet" }).click();
  await expect(mcpRegion).toContainText(mcpName);
  let failMcpDelete = true;
  await page.route(/\/api\/mcp-connections\?id=/, async (route) => {
    if (route.request().method() === "DELETE" && failMcpDelete) {
      failMcpDelete = false;
      await route.fulfill({ status: 503, json: { error: "E2E MCP silme hatası" } });
      return;
    }
    await route.continue();
  });
  await mcpRegion.getByRole("button", { name: "Bağlantıyı kaldır" }).click();
  await expect(mcpRegion).toContainText("E2E MCP silme hatası");
  await expect(mcpRegion).toContainText(mcpName);
  await expect(mcpRegion.getByRole("button", { name: "Bağlantıyı kaldır" })).toBeEnabled();
  await mcpRegion.getByRole("button", { name: "Bağlantıyı kaldır" }).click();
  await expect(mcpRegion).not.toContainText(mcpName);

  await workspaceView(page, "Sohbet");
  await page.getByRole("button", { name: "Konseyi çalıştır" }).click();
  await expect(page.getByText("Konsey tamamlandı", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".status-card")).toContainText("Değerlendirme profili: Yüksek risk");
  await expect(page.locator(".status-card")).toContainText("red-team tamamlandı; çapraz inceleme tamamlandı");
  const reportQuality = page.getByLabel("Rapor kalite değerlendirmesi");
  await expect(reportQuality).toContainText("Mekanik iddia dökümü");
  await expect(reportQuality).toContainText("Anlamsal doğrulama yapılmadı");
  await expect(reportQuality).toContainText("dış kaynak desteği işaretli değil");
  await expect(page.getByRole("region", { name: "Sağlayıcının bildirdiği token kullanımı" })).toContainText("Bu çalışma için sağlayıcı token sayımı bildirilmedi.");
  expect((await (await request.get(`/api/runs/${submittedRunIds[0]}`)).json() as { attachmentCount: number }).attachmentCount).toBe(2);
  expect((await request.post(`/api/runs/${submittedRunIds[0]}/export`, {
    headers: { origin: "https://external.example" },
  })).status()).toBe(403);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Raporu indir (JSON)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`deliberationai-report-${submittedRunIds[0]}.json`);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const exported = JSON.parse(await (await import("node:fs/promises")).readFile(downloadPath!, "utf8")) as {
    schemaVersion: string; question: string; attachmentCount: number;
    report: { status: string; memberResults: Array<{ rawText: string }>;
      reportQuality?: { version: string; mechanicalIntegrity: boolean; semanticValidation: string };
      reviewPromptPlans?: Array<{ reviewerMemberId: string; peerMemberIds: string[]; input: string }> };
    idempotencyKey?: string; requestHash?: string; snapshotId?: string; attachments?: unknown;
  };
  expect(exported.schemaVersion).toBe("deliberationai-run-export-v1");
  expect(exported.question).toBe("Tarayıcıdan başlatılan konsey çalışması kalıcı kuyrukta doğru şekilde sonuçlanıyor mu?");
  expect(exported.attachmentCount).toBe(2);
  expect(exported.report.status).toBe("completed");
  expect(exported.report.reportQuality).toMatchObject({ version: "report-quality-v1", mechanicalIntegrity: true, semanticValidation: "not_run" });
  expect(exported.report.memberResults.length).toBeGreaterThan(0);
  expect(exported.report.memberResults[0]?.rawText.length).toBeGreaterThan(0);
  expect(exported.report.reviewPromptPlans).toHaveLength(4);
  expect(exported.report.reviewPromptPlans?.every((plan) => !plan.peerMemberIds.includes(plan.reviewerMemberId))).toBe(true);
  expect(exported.idempotencyKey).toBeUndefined();
  expect(exported.requestHash).toBeUndefined();
  expect(exported.snapshotId).toBeUndefined();
  expect(exported.attachments).toBeUndefined();
  await expect(page.getByText("ORTAK ZEMİN")).toBeVisible();
  // Responsive acceptance must also cover a populated report, not only empty forms.
  const desktopViewport = page.viewportSize()!;
  for (const width of [320, 820]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator("#council-result").screenshot({ path: `test-results/da112-report-${width}.png` });
  }
  await page.setViewportSize(desktopViewport);
  await expect(page.getByText("FARKLI GÖRÜŞLER")).toBeVisible();
  await expect(page.getByRole("region", { name: "Model ayrıntıları" })).toContainText("Analist A");
  await expect(page.getByRole("region", { name: "Model ayrıntıları" })).toContainText("Analist B");
  await expect(page.getByRole("region", { name: "Model ayrıntıları" })).toContainText("Kanıt Uzmanı");
  await expect(page.getByRole("region", { name: "Model ayrıntıları" })).toContainText("Red-team");
  await expect(page.getByRole("region", { name: "Çapraz incelemeler" })).toContainText(
    "4 tamamlanan inceleme",
  );
  const reviewPrompt = page.locator(".review-prompt-plan");
  await reviewPrompt.locator("summary").click();
  await expect(reviewPrompt).toContainText("Tur 1 için oluşturulan istemleri");
  await expect(reviewPrompt).toContainText(exported.question);
  await expect(reviewPrompt).not.toContainText("Contract condition is documented");
  await expect(page.getByRole("region", { name: "Çapraz incelemeler" })).toContainText(
    "koşula bağlıyor",
  );
  await expect(page.getByRole("region", { name: "Red-team karşı argümanları" })).toContainText(
    "geri dönüşü olmayan",
  );
  await expect(page.getByRole("region", { name: "Red-team karşı argümanları" })).toContainText(
    "ANALİST ZEMİNİ",
  );
  await expect(page.getByRole("region", { name: "Red-team karşı argümanları" })).toContainText(
    "RED-TEAM BASINCI",
  );
  await expect(page.getByRole("region", { name: "Çapraz incelemeler" })).toContainText(
    "itiraz ediyor",
  );
  await expect(page.getByText("Ortak zemin, ayrı sayılan analiz kaynaklarının")).toBeVisible();
  const sharedEvidenceState = page.locator(".report-card.shared .evidence-control select").first();
  await expect(sharedEvidenceState).toHaveValue("unsupported");
  const claimContext = page.getByRole("region", { name: "İddia kapsamı ve ilişkileri" });
  await expect(claimContext).toContainText("raporda izleniyor");
  await expect(claimContext.locator(".claim-coverage")).toContainText("Her yapılandırılmış model iddiası");
  await claimContext.getByLabel("Bu iddianın geçerli olduğu koşullar veya sınırlar").fill("Yalnızca sözleşme koşulu doğrulanırsa.");
  await claimContext.getByRole("button", { name: "Kapsamı kaydet" }).click();
  await expect(claimContext.getByLabel("Bu iddianın geçerli olduğu koşullar veya sınırlar")).toHaveValue("Yalnızca sözleşme koşulu doğrulanırsa.");
  await claimContext.getByLabel("Gerekçeniz").fill("İkinci iddia birinciyi koşula bağlıyor.");
  await claimContext.getByRole("button", { name: "İlişkiyi kaydet" }).click();
  await expect(claimContext.locator(".claim-relation-list")).toContainText("İkinci iddia birinciyi koşula bağlıyor.");
  const persistedContext = await (await request.get(`/api/runs/${submittedRunIds[0]}`)).json() as {
    report: { sharedClaims: Array<{ scopeNote?: string }>; distinctClaims: Array<{ scopeNote?: string }>; claimRelations: Array<{ note: string }> };
  };
  expect([...persistedContext.report.sharedClaims, ...persistedContext.report.distinctClaims].some((claim) => claim.scopeNote === "Yalnızca sözleşme koşulu doğrulanırsa.")).toBe(true);
  expect(persistedContext.report.claimRelations[0]?.note).toBe("İkinci iddia birinciyi koşula bağlıyor.");
  const researchRegion = page.getByRole("region", { name: "Uygulama yönetimli kaynak getirme" });
  await researchRegion.getByLabel("JavaScript ile oluşan metni güvenli tarayıcıda yakala").check();
  await researchRegion.getByLabel("Herkese açık kaynak adresi").fill("http://127.0.0.1/private");
  await researchRegion.getByRole("button", { name: "Kaynağı getir ve mühürle" }).click();
  await expect(researchRegion).toContainText("güvenli olmayan bir ağ adresine çözümlendi");
  await workspaceView(page, "Zamanlayıcı");
  await scheduleCard.getByRole("button", { name: "Zamanlama silmeyi incele" }).click();
  const scheduleDeletion = scheduleRegion.getByRole("region", { name: "Zamanlama silme önizlemesi" });
  await scheduleDeletion.getByRole("checkbox").check();
  await scheduleDeletion.getByRole("button", { name: "Zamanlama içeriğini kalıcı olarak sil" }).click();
  await expect(scheduleRegion).toContainText("E2E zamanlama silme hatası");
  await expect(scheduleCard).toBeVisible();
  await scheduleDeletion.getByRole("button", { name: "Silme önizlemesini yenile" }).click();
  await scheduleDeletion.getByRole("checkbox").check();
  await scheduleDeletion.getByRole("button", { name: "Zamanlama içeriğini kalıcı olarak sil" }).click();
  await expect(scheduleCard).toHaveCount(0);
  await workspaceView(page, "Sohbet");
  const evidenceRegion = page.getByRole("region", { name: "Kaynak bağlantılı kanıtlar" });
  await page.getByLabel("Kaynak başlığı").fill("E2E doğrulama kaynağı");
  await page.getByLabel("Kaynak bağlantısı").fill("https://example.test/e2e-evidence");
  await page.getByLabel("Kaynak yayın tarihi").fill("2026-09-17");
  await page.getByLabel("Kaynaktan değiştirilemez alıntı").fill(
    "Tarayıcı akışında mühürlenen kaynak alıntısı.",
  );
  await page.getByLabel("Kaynak inceleme notu").fill("Tarayıcı akışında kullanıcı tarafından incelendi.");
  await page.getByRole("button", { name: "Kaynak kaydı ekle" }).click();
  const evidenceCard = evidenceRegion.locator(".evidence-source").filter({ hasText: "E2E doğrulama kaynağı" });
  await expect(evidenceCard).toBeVisible();
  await expect(evidenceCard).toContainText("Tarayıcı akışında mühürlenen kaynak alıntısı.");
  const decisionRegion = page.getByRole("region", { name: "Jev kaynak incelemesi" });
  const decisionConnection = `E2E TypeSafe ${connectionSuffix}`;
  await decisionRegion.getByLabel("Bağlantı adı").fill(decisionConnection);
  await decisionRegion.getByLabel("TypeSafe API anahtarı").fill("ts-test-only-never-sent");
  await decisionRegion.getByLabel("Sabit Jev sürümü").fill("jev-1.13.0");
  await decisionRegion.getByRole("button", { name: "TypeSafe bağlantısını kaydet" }).click();
  await expect(decisionRegion).toContainText(`${decisionConnection} · jev-1.13.0`);
  await expect(decisionRegion).toContainText("Karar çağrıları şu anda kapalı");
  await decisionRegion.getByRole("checkbox").check();
  await expect(
    decisionRegion.getByRole("button", { name: "Jev ile gözlem incelemesi" }),
  ).toBeDisabled();
  const reviewStatus = evidenceCard.getByLabel("E2E doğrulama kaynağı inceleme durumu");
  const freshnessStatus = evidenceCard.getByLabel("E2E doğrulama kaynağı güncellik durumu");
  await reviewStatus.selectOption("verified");
  await expect(reviewStatus).toHaveValue("verified");
  await freshnessStatus.selectOption("current");
  await expect(freshnessStatus).toHaveValue("current");
  await sharedEvidenceState.selectOption("externally-verified");
  await expect(sharedEvidenceState).toHaveValue("externally-verified");
  await expect(reportQuality).not.toContainText("dış kaynak desteği işaretli değil");
  const synthesisRegion = page.getByRole("region", { name: "Sentez kapsamı" });
  await expect(synthesisRegion).toContainText("hiçbir azınlık görüşü otomatik silinmez");
  const includedCoverage = synthesisRegion.locator(".synthesis-column.included select").first();
  await expect(includedCoverage).toHaveValue("included");
  await includedCoverage.selectOption("omitted");
  await expect(reportQuality).toContainText("sentez dışında");
  await expect(synthesisRegion.locator(".synthesis-column.omitted")).toContainText(
    "Karar vermeden önce sorunun kapsamını ve geçerli koşulları doğrula.",
  );
  const sharedMemoryText = "Karar vermeden önce sorunun kapsamını ve geçerli koşulları doğrula.";
  await page.locator(".report-card.shared .memory-button").first().click();
  const memoryRegion = page.getByRole("region", { name: "Ortak konuşma belleği" });
  const selectedMemory = memoryRegion.locator(".memory-entry")
    .filter({ hasText: sharedMemoryText })
    .filter({ has: page.locator('input[type="checkbox"]:checked') });
  await expect(selectedMemory).toHaveCount(1);
  const selectedMemoryId = await selectedMemory.getAttribute("data-memory-id");
  expect(selectedMemoryId).toBeTruthy();
  const savedMemory = memoryRegion.locator(`.memory-entry[data-memory-id="${selectedMemoryId}"]`);
  await expect(savedMemory).toBeVisible();
  await expect(savedMemory.locator('input[type="checkbox"]')).toBeChecked();
  await sharedEvidenceState.selectOption("unsupported");
  await decisionRegion.getByRole("button", { name: "TypeSafe bağlantısını kaldır" }).click();
  await expect(decisionRegion.getByLabel("TypeSafe API anahtarı")).toBeVisible();
  await evidenceCard.getByRole("button", { name: "Kaydı sil" }).click();
  await expect(evidenceCard).toHaveCount(0);

  failNextRun = true;
  await page.getByRole("button", { name: "Konseyi çalıştır" }).click();
  await expect(page.getByText("Kısmi sonuç", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Bu çalışma kullanıcı tarafından seçilen 1 bellek kaydını kullandı.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Model ayrıntıları" })).toContainText(
    "1 geçmiş bağlam kaydı",
  );
  await expect(page.getByText("Analist B", { exact: true })).toBeVisible();
  await expect(page.getByText("Deneme üyesi planlanan hata senaryosunu tetikledi.")).toBeVisible();

  await workspaceView(page, "Sohbet");
  await page.getByRole("button", { name: `${templateName} şablonunu silmeyi incele` }).click();
  const templateDeletion = page.getByRole("region", { name: "Şablon silme önizlemesi" });
  await templateDeletion.getByRole("checkbox").check();
  await templateDeletion.getByRole("button", { name: "Şablon içeriğini kalıcı olarak sil" }).click();
  await expect(page.locator(".template-button").filter({ hasText: templateName })).toHaveCount(0);

  await workspaceView(page, "Ayarlar");
  for (const label of [firstConnection, secondConnection, localConnection, openRouterConnection]) {
    await page.locator(".connection-status").filter({ hasText: label }).getByRole("button", { name: "Bağlantıyı kaldır" }).click();
    await expect(page.locator(".connection-status").filter({ hasText: label })).toHaveCount(0);
  }
  await workspaceView(page, "Sohbet");
  await savedMemory.getByRole("button", { name: "Bellekten kaldır" }).click();
  await expect(savedMemory).toHaveCount(0);

  const operatorRunResponse = await request.post("/api/runs", {
    data: {
      question: "Operatör kararı akışı güvenli biçimde test ediliyor mu?",
      idempotencyKey: crypto.randomUUID(),
      scenario: "success",
      providerMode: "fake",
    },
  });
  expect(operatorRunResponse.ok()).toBe(true);
  const operatorRun = (await operatorRunResponse.json()) as { runId: string; status: string };
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await request.get(`/api/runs/${operatorRun.runId}`);
    const body = (await response.json()) as { status: string };
    if (["completed", "partially_completed", "failed"].includes(body.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const discardOperation = await prepareProviderOperation({
    runId: operatorRun.runId,
    memberId: "operator-ui-discard",
    provider: "openai",
    model: "fixture-model",
    requestFingerprint: fingerprintProviderRequest({ fixture: "ui-discard" }),
  });
  await updateProviderOperation(discardOperation.id, {
    status: "outcome_unknown",
    errorCode: "fixture_unknown",
  });
  await page.reload();
  await workspaceView(page, "Ayarlar");
  const discardCard = page.locator(".operator-list article").filter({ hasText: "operator-ui-discard" });
  await expect(discardCard).toBeVisible();
  await discardCard.getByRole("button", { name: "Başarısız say ve kapat" }).click();
  await expect(discardCard).toHaveCount(0);

  const retryOperation = await prepareProviderOperation({
    runId: operatorRun.runId,
    memberId: "operator-ui-retry",
    provider: "openai",
    model: "fixture-model",
    requestFingerprint: fingerprintProviderRequest({ fixture: "ui-retry" }),
  });
  await updateProviderOperation(retryOperation.id, {
    status: "outcome_unknown",
    errorCode: "fixture_unknown",
  });
  await page.reload();
  await workspaceView(page, "Ayarlar");
  const retryCard = page.locator(".operator-list article").filter({ hasText: "operator-ui-retry" });
  await expect(retryCard).toBeVisible();
  await retryCard.getByRole("button", { name: "Yeni denemeye izin ver" }).click();
  await expect(retryCard).toHaveCount(0);
  await workspaceView(page, "Sohbet");
  await expect(page.getByText("Konsey tamamlandı", { exact: true })).toBeVisible({ timeout: 10_000 });

  expect((await request.get("/api/runs?before=invalid-cursor")).status()).toBe(400);
  await page.reload();
  const currentQuestion = await page.getByLabel("Sorunuz").inputValue();
  const savedRun = page.locator(`.run-history-list article[data-run-id="${submittedRunIds[0]}"]`);
  await expect(savedRun).toBeVisible();
  await savedRun.getByRole("button", { name: "Çalışmayı aç" }).click();
  await expect(page.locator(".status-card")).toContainText("Çalışma sorusu: Tarayıcıdan başlatılan konsey çalışması kalıcı kuyrukta doğru şekilde sonuçlanıyor mu?");
  await expect(page.getByRole("button", { name: "Raporu indir (JSON)" })).toBeVisible();
  await expect(page.getByLabel("Sorunuz")).toHaveValue(currentQuestion);
}));
