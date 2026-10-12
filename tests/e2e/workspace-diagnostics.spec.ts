import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { expect, test } from "./authenticated-test";
import { workspaceView } from "./workspace-navigation";
import { openConnectionPanel } from "./connection-model-selection";
import { deleteGeneratedConnection } from "./connection-cleanup";
const settings = { provider: "openai-compatible", apiKey: "fixture-key-secret", endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object", selectedModels: ["model-a", "model-b"] };

test("chat runs the selected saved council through the worker and exposes both independent replies in Results", async ({ page, request }) => {
  test.setTimeout(60000); let calls = 0;
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); calls++;
    expect(body.messages.find((message: { role: string }) => message.role === "user").content).toContain("Compare two ways to organize project notes briefly.");
    const statement = `Independent synthetic reply from ${body.model}`;
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ id: `council-fixture-${calls}`, model: body.model, choices: [{ message: { content: JSON.stringify({ summary: statement, claims: [{ statement, quote: statement, kind: "recommendation" }] }) }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 6 } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture bind failed");
  const connection = await (await request.post("/api/provider-connections", { data: { ...settings, label: `Worker fixture ${randomUUID()}`, baseUrl: `http://127.0.0.1:${address.port}/v1` } })).json();
  const members = defaultFakeCouncilMembers.map((member, index) => ({ ...member, provider: "openai-compatible", connectionId: connection.id, model: index ? "model-b" : "model-a" }));
  const template = await (await request.post("/api/council-templates", { data: { requestId: randomUUID(), name: `Worker council ${randomUUID()}`, members, settings: { reviewRounds: 0, selfRevisionEnabled: false } } })).json();
  try {
    await page.goto("/"); await page.getByRole("region", { name: "Konsey Havuzu", exact: true }).getByLabel("Kayıtlı Konsey").selectOption(template.id);
    await page.getByLabel("Sorunuz", { exact: true }).fill("Compare two ways to organize project notes briefly.");
    const start = page.getByRole("button", { name: "Konseyi çalıştır", exact: true }); await expect(start).toBeEnabled(); await start.click();
    await expect(page.getByText("Konsey tamamlandı", { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("tab", { name: "Sonuçlar", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#council-result")).toContainText("model-a"); await expect(page.locator("#council-result")).toContainText("model-b"); expect(calls).toBe(2);
    await page.getByRole("tab", { name: "Soru", exact: true }).click(); await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Compare two ways to organize project notes briefly.");
  } finally {
    const preview = await (await request.get(`/api/council-templates/${template.id}/deletion`)).json();
    await request.post(`/api/council-templates/${template.id}/deletion`, { data: { templateId: template.id, fingerprint: preview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedCopies: true } });
    await deleteGeneratedConnection(request, `/api/provider-connections?id=${connection.id}`); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("file cancellation and a text-selection drag outside the modal preserve it; a genuine backdrop click closes it", async ({ page, request }) => {
  const connection = await (await request.post("/api/provider-connections", { data: { ...settings, label: `Modal fixture ${randomUUID()}`, baseUrl: "http://127.0.0.1:1/v1" } })).json();
  try {
    await page.goto("/"); await page.getByLabel("Sorunuz", { exact: true }).fill("My council question stays unchanged.");
    await workspaceView(page, "Ayarlar"); const tile = page.locator(".connection-card").filter({ hasText: connection.label });
    const dialog = await openConnectionPanel(page, tile, "Test Ve Hata Ayıklama");
    const input = dialog.getByLabel("Test dosyası ekle");
    await expect(dialog.getByRole("button", { name: "Dosya Seç", exact: true })).toBeVisible();
    await input.evaluate(element => element.dispatchEvent(new Event("cancel", { bubbles: true })));
    await expect(dialog).toBeVisible();
    const message = dialog.getByRole("region", { name: "Model test ve hata ayıklama alanı" }).getByLabel("Test mesajı"); await message.fill("Select this text and drag beyond the popup.");
    const box = (await message.boundingBox())!, popup = (await dialog.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(popup.x - 20, box.y + 20); await page.mouse.up();
    await expect(dialog).toBeVisible(); await expect(message).toHaveValue("Select this text and drag beyond the popup.");
    await page.mouse.click(popup.x - 20, popup.y + 40); await expect(dialog).not.toBeVisible();
    await workspaceView(page, "Müzakere"); await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("My council question stays unchanged.");
  } finally { await deleteGeneratedConnection(request, `/api/provider-connections?id=${connection.id}`); }
});

test("debug displays and exports only the current unprimed request, provider response and redacted transfer details", async ({ page, request }, info) => {
  let calls = 0;
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); calls++;
    expect(body.messages).toEqual([{ role: "user", content: calls === 1 ? "  Exact first message\n" : "Exact second message" }]);
    outgoing.setHeader("content-type", "application/json"); outgoing.setHeader("x-request-id", `fixture-${calls}`);
    if (calls === 1) outgoing.end(JSON.stringify({ model: "model-a", choices: [{ message: { role: "assistant", content: "FIRST RESPONSE" }, finish_reason: "stop" }], usage: { prompt_tokens: 6, completion_tokens: 3 } }));
    else { outgoing.writeHead(402); outgoing.end(JSON.stringify({ error: { code: 402, message: "fixture-key-secret insufficient credits" } })); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture bind failed");
  const connection = await (await request.post("/api/provider-connections", { data: { ...settings, label: `Trace fixture ${randomUUID()}`, baseUrl: `http://127.0.0.1:${address.port}/v1` } })).json();
  try {
    await page.goto("/"); await workspaceView(page, "Ayarlar"); const tile = page.locator(".connection-card").filter({ hasText: connection.label });
    const dialog = await openConnectionPanel(page, tile, "Test Ve Hata Ayıklama");
    const chat = dialog.getByRole("region", { name: "Model test ve hata ayıklama alanı" });
    const send = chat.getByRole("button", { name: "Mesajı Gönder", exact: true });
    await expect(send).toHaveAttribute("title", /Ek sistem talimatı göndermez/);
    await expect(chat.getByRole("button", { name: "Sonucu Kontrol Et", exact: true })).toHaveAttribute("title", /yeniden istek göndermez/);
    await chat.getByLabel("Test mesajı").fill("  Exact first message\n"); await send.click(); await expect(chat.getByRole("log")).toContainText("FIRST RESPONSE");
    await chat.getByLabel("Test mesajı").fill("Exact second message"); await send.click(); await expect(chat.getByRole("log")).toContainText("HTTP 402"); await expect(chat.getByRole("log")).not.toContainText("FIRST RESPONSE");
    const details = chat.getByRole("region", { name: "Mevcut testin teknik ayrıntıları" });
    await details.getByRole("tab", { name: "İstek", exact: true }).click(); await expect(details.locator("pre")).toContainText("Exact second message"); await expect(details.locator("pre")).not.toContainText('"system"');
    await details.getByRole("tab", { name: "Yanıt", exact: true }).click(); await expect(details.locator("pre")).toContainText("insufficient credits"); await expect(details.locator("pre")).toContainText("[REDACTED]");
    const downloaded = page.waitForEvent("download"); await details.getByRole("button", { name: "JSON İndir", exact: true }).click(); const file = await downloaded; const target = info.outputPath("current-test.json"); await file.saveAs(target);
    const record = JSON.parse(await readFile(target, "utf8")); expect(record.result.trace.response.status).toBe(402); expect(record.result.trace.response.headers["x-request-id"]).toBe("fixture-2");
    expect(JSON.stringify(record)).not.toContain("fixture-key-secret"); expect(JSON.stringify(record)).not.toContain("FIRST RESPONSE");
    await chat.getByRole("button", { name: "Sonucu Kontrol Et", exact: true }).click(); expect(calls).toBe(2);
    const history = (await (await request.get(`/api/provider-connections/${connection.id}/chat-check`)).json()).observations.generationChecks;
    expect(JSON.stringify(history)).not.toMatch(/Exact second|FIRST RESPONSE|trace|insufficient credits/u);
    await page.keyboard.press("Escape"); await openConnectionPanel(page, tile, "Test Ve Hata Ayıklama");
    await expect(details.getByRole("button", { name: "JSON İndir", exact: true })).toBeDisabled(); await expect(chat).not.toContainText("HTTP 402");
  } finally { await deleteGeneratedConnection(request, `/api/provider-connections?id=${connection.id}`); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("model removal reviews dependencies, invalidates chat selection and is repaired in the separate council menu", async ({ page, request }) => {
  const connection = await (await request.post("/api/provider-connections", { data: { ...settings, label: `Dependency fixture ${randomUUID()}`, baseUrl: "http://127.0.0.1:1/v1" } })).json();
  const members = defaultFakeCouncilMembers.map(member => ({ ...member, provider: "openai-compatible", connectionId: connection.id, model: "model-a" }));
  const template = await (await request.post("/api/council-templates", { data: { requestId: randomUUID(), name: `Dependency council ${randomUUID()}`, members, settings: { reviewRounds: 0, selfRevisionEnabled: false } } })).json();
  try {
    await page.goto("/"); const pool = page.getByRole("region", { name: "Konsey Havuzu", exact: true });
    await pool.getByLabel("Kayıtlı Konsey").selectOption(template.id); await page.getByLabel("Sorunuz", { exact: true }).fill("Compare two ways to organize notes briefly.");
    await expect(pool.getByLabel("Şablon adı")).toHaveCount(0); await expect(page.getByRole("region", { name: "Konsey yapılandırması", exact: true })).toHaveCount(0);
    await workspaceView(page, "Ayarlar"); const dialog = await openConnectionPanel(page, page.locator(".connection-card").filter({ hasText: connection.label }), "Modeller");
    const models = dialog.locator(".saved-connection-models").filter({ visible: true });
    const dropdown = models.locator(".connection-model-dropdown"); if (await dropdown.getAttribute("open") === null) await dropdown.locator(":scope > summary").click(); await dropdown.getByRole("checkbox", { name: "model-a", exact: true }).uncheck();
    await dialog.getByRole("button", { name: "Model Seçimini Kaydet", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Bağlı Kayıtları İnceleyin", exact: true }); await expect(review).toContainText(template.name);
    await review.getByRole("button", { name: "Vazgeç", exact: true }).click();
    expect((await (await request.get("/api/provider-connections")).json()).connections.find((item: { id: string }) => item.id === connection.id).selectedModels).toContain("model-a");
    await dialog.getByRole("button", { name: "Model Seçimini Kaydet", exact: true }).click(); await review.getByRole("button", { name: "Değişikliği Onayla", exact: true }).click(); await expect(review).not.toBeVisible();
    await expect(models.getByRole("status")).toContainText("kaydedildi"); await page.keyboard.press("Escape"); await workspaceView(page, "Müzakere");
    await expect(pool.getByLabel("Kayıtlı Konsey").locator(`option[value="${template.id}"]`)).toHaveJSProperty("disabled", true); await expect(page.getByRole("button", { name: "Konseyi çalıştır", exact: true })).toBeDisabled();
    const rejected = await request.post("/api/runs", { data: { idempotencyKey: randomUUID(), question: "Compare two ways to organize notes briefly.", members, reviewRounds: 0, providerMode: "remote" } }); expect(rejected.status()).toBe(422); expect((await rejected.json()).code).toBe("council_model_unavailable");
    await workspaceView(page, "Konseyler"); await page.getByLabel("Üye 1 modeli", { exact: true }).selectOption("model-b"); await page.getByLabel("Üye 2 modeli", { exact: true }).selectOption("model-b");
    const editor = page.getByRole("region", { name: "Konsey kaydı", exact: true });
    await editor.getByRole("button", { name: "Değişiklikleri Kaydet", exact: true }).click(); await expect(editor.getByRole("status")).toContainText("kaydedildi");
    const saved = (await (await request.get("/api/council-templates")).json()).templates.find((item: { id: string }) => item.id === template.id); expect(saved.members.every((member: { model: string }) => member.model === "model-b")).toBe(true);
    await workspaceView(page, "Müzakere"); await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Compare two ways to organize notes briefly.");
    for (const name of ["Kaynaklar Ve Dosyalar", "Bağlam Ve Kontroller", "Soru"]) await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Compare two ways to organize notes briefly."); await expect(page.getByRole("button", { name: "Konseyi çalıştır", exact: true })).toBeEnabled();
  } finally {
    const preview = await (await request.get(`/api/council-templates/${template.id}/deletion`)).json();
    await request.post(`/api/council-templates/${template.id}/deletion`, { data: { templateId: template.id, fingerprint: preview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedCopies: true } });
    await deleteGeneratedConnection(request, `/api/provider-connections?id=${connection.id}`);
  }
});
