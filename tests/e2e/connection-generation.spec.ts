import { deleteGeneratedConnection } from "./connection-cleanup";
import { withOwner } from "@deliberation-ai/persistence";
import { createServer } from "node:http";
import {expect, test, testOwnerId } from "./authenticated-test";
import { workspaceView } from "./workspace-navigation";
import { openConnectionPanel } from "./connection-model-selection";

test("debug test accepts small image/audio/PDF, shows provider errors and retains aliases without saving bodies", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  let calls = 0;
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); calls++;
    expect(body.max_tokens).toBe(512); expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content.map((part: { type: string }) => part.type)).toEqual(["text", "image_url", "input_audio", "file"]);
    expect(body.messages[0].content[0].text).toBe("Describe my synthetic files.");
    expect(JSON.stringify(body)).not.toContain("KEEP MY DRAFT");
    outgoing.setHeader("content-type", "application/json");
    if (body.model === "no-vision") {
      outgoing.writeHead(400); outgoing.end(JSON.stringify({ error: { code: 400, message: "Image input unsupported SENSITIVE ERROR BODY", metadata: { error_type: "unsupported_modality" } } }));
    } else outgoing.end(JSON.stringify({ model: "local-check", choices: [{ message: { role: "assistant", content: "Synthetic media accepted." }, finish_reason: "stop" }], usage: { prompt_tokens: 15, completion_tokens: 30 } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture bind failed.");
  let id: string | undefined;
  try {
    const created = await request.post("/api/provider-connections", { data: { provider: "openai-compatible", label: `E2E debug ${crypto.randomUUID()}`,
      apiKey: "", selectedModels: ["local-check", "no-vision"], baseUrl: `http://127.0.0.1:${address.port}/v1`, endpointPreset: "ollama", reasoningProtocol: "none", structuredOutputMode: "json-object" } });
    expect(created.ok()).toBe(true); id = (await created.json()).id;
    await page.goto("/"); await page.getByLabel("Sorunuz", { exact: true }).fill("KEEP MY DRAFT"); await workspaceView(page, "Ayarlar");
    const tile = page.locator(".connection-card").filter({ hasText: "E2E debug" });
    const card = await openConnectionPanel(page, tile, "Modeller");
    const models = card.locator(".saved-connection-models").filter({ visible: true });
    await models.getByLabel("local-check takma adı", { exact: true }).fill("Kolay Ad");
    await models.getByRole("button", { name: "Model Seçimini Kaydet", exact: true }).click(); await expect(models.getByRole("status")).toContainText("kaydedildi");
    const saved = (await (await request.get("/api/provider-connections")).json()).connections.find((entry: { id: string }) => entry.id === id);
    expect(saved.revision).toBe(1); expect(saved.modelAliases).toEqual({ "local-check": "Kolay Ad" });
    await card.getByRole("tab", { name: "Test Ve Hata Ayıklama", exact: true }).click();
    const chat = card.getByRole("region", { name: "Model test ve hata ayıklama alanı" });
    await expect(chat).toBeVisible(); await expect(chat.getByRole("checkbox")).toHaveCount(0);
    await expect(chat.getByLabel("Test modeli").locator('option[value="local-check"]')).toHaveText("Kolay Ad · local-check");
    await chat.getByLabel("Test mesajı").fill("Describe my synthetic files.");
    await chat.getByLabel("Test dosyası ekle").setInputFiles([
      { name: "tiny.png", mimeType: "image/png", buffer: Buffer.from([137,80,78,71,13,10,26,10]) },
      { name: "tiny.wav", mimeType: "audio/wav", buffer: Buffer.from("RIFF1234WAVEfixture") },
      { name: "tiny.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nfixture") },
    ]);
    await chat.getByRole("button", { name: "Mesajı Gönder", exact: true }).click();
    await expect(chat).toContainText("Synthetic media accepted."); expect(calls).toBe(1);
    await chat.getByLabel("Test modeli").selectOption("no-vision"); await chat.getByRole("button", { name: "Mesajı Gönder", exact: true }).click();
    await expect(chat).toContainText("HTTP 400"); await expect(chat).toContainText("unsupported_modality"); await expect(chat).toContainText("görsel girdisini reddetti");
    await expect(chat.getByRole("log")).not.toContainText("SENSITIVE ERROR BODY"); await expect(chat.getByRole("region", { name: "Mevcut testin teknik ayrıntıları" })).toBeVisible(); expect(calls).toBe(2);
    const history = (await (await request.get(`/api/provider-connections/${id}/chat-check`)).json()).observations.generationChecks;
    expect(history).toHaveLength(2); expect(JSON.stringify(history)).not.toMatch(/Describe my|Synthetic media|tiny\.png/u);
    await page.keyboard.press("Escape"); await openConnectionPanel(page, tile, "Test Ve Hata Ayıklama");
    await expect(chat).not.toContainText("Synthetic media accepted."); await expect(chat).not.toContainText("HTTP 400");
    await expect(chat.getByRole("region", { name: "Mevcut testin teknik ayrıntıları" })).toContainText("Bir mesaj gönderdiğinizde"); expect(calls).toBe(2);
    await page.keyboard.press("Escape"); await workspaceView(page, "Sohbet"); await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("KEEP MY DRAFT");
    await workspaceView(page, "Konseyler");
    await page.getByLabel("Üye 1 bağlantısı", { exact: true }).selectOption(id!);
    await expect(page.getByLabel("Üye 1 modeli").locator('option[value="local-check"]')).toHaveText("Kolay Ad · local-check");
  } finally { if (id) await deleteGeneratedConnection(request, `/api/provider-connections?id=${id}`); await new Promise<void>(resolve => server.close(() => resolve())); }
}));
test("rejects stale, foreign-origin, unacknowledged and oversized checks before dispatch", async ({ request }) => withOwner(testOwnerId(), async () => {
  const created = await request.post("/api/provider-connections", { data: { provider: "openai-compatible", label: `E2E guards ${crypto.randomUUID()}`,
    apiKey: "", defaultModel: "local-check", baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "ollama", reasoningProtocol: "none", structuredOutputMode: "json-object" } });
  const connection = await created.json(); const endpoint = `/api/provider-connections/${connection.id}/generation-check`;
  try {
    const review = await (await request.get(endpoint)).json();
    const input = { requestId: crypto.randomUUID(), model: review.model, fingerprint: review.fingerprint, acknowledge: true };
    expect((await request.post(endpoint, { headers: { origin: "https://foreign.example" }, data: input })).status()).toBe(403);
    expect((await request.post(endpoint, { data: { ...input, acknowledge: false } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { ...input, extra: true } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: "x".repeat(2049) })).status()).toBe(413);
    expect((await request.post(endpoint, { data: { ...input, fingerprint: "0".repeat(64) } })).status()).toBe(409);
    await request.post("/api/provider-connections", { data: { ...connection, configured: undefined, updatedAt: undefined, revision: undefined, catalogCheck: undefined,
      apiKey: "", defaultModel: "edited-check" } });
    expect((await request.post(endpoint, { data: input })).status()).toBe(409);
    const updated = await (await request.get(endpoint)).json(); expect(updated.observations.generationChecks).toEqual([]);
    expect((await request.patch(endpoint, { data: { id: input.requestId, fingerprint: input.fingerprint, acknowledgeUnknown: true } })).status()).toBe(409);
    expect((await request.get(endpoint)).headers()["cache-control"]).toBe("no-store");
  } finally { await deleteGeneratedConnection(request, `/api/provider-connections?id=${connection.id}`); }
}));
