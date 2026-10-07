import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { workspaceView } from "./workspace-navigation";

test("reviews one bounded generation, preserves the draft and replays its receipt without another call", async ({ page, request }) => {
  let calls = 0;
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    outgoing.setHeader("content-type", "application/json");
    if (incoming.url === "/v1/models") { outgoing.end(JSON.stringify({ data: [{ id: "local-check" }] })); return; }
    calls++;
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(body.model).toBe("local-check"); expect(body.max_tokens).toBe(512); expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("KEEP MY DRAFT");
    outgoing.end(JSON.stringify({ id: "fixture-response", model: "local-check", choices: [{ message: { content: JSON.stringify({
      summary: "Dört.", claims: [{ statement: "2 + 2 = 4", kind: "shared", quote: "2 + 2 = 4" }],
    }) }, finish_reason: "stop" }], usage: { prompt_tokens: 15, completion_tokens: 700 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture bind failed.");
  let id: string | undefined;
  try {
    const created = await request.post("/api/provider-connections", { data: { provider: "openai-compatible", label: `E2E generation ${crypto.randomUUID()}`,
      apiKey: "", defaultModel: "local-check", baseUrl: `http://127.0.0.1:${address.port}/v1`, endpointPreset: "ollama", reasoningProtocol: "none", structuredOutputMode: "json-object" } });
    expect(created.ok()).toBe(true); id = (await created.json()).id;
    await page.goto("/");
    const draft = page.getByLabel("Sorunuz", { exact: true });
    await draft.fill("KEEP MY DRAFT");
    await workspaceView(page, "Ayarlar"); await page.getByText(/Yerel sağlayıcı bağlantıları/).click();
    const card = page.locator(".connection-card").filter({ hasText: "E2E generation" });
    await card.getByRole("button", { name: "Üretim testi ve model geçmişi" }).click();
    await expect(card.getByRole("button", { name: /Onaylanan denemeyi/ })).toBeDisabled();
    expect(calls).toBe(0);
    await card.getByRole("button", { name: "Model listesini kontrol et" }).click();
    await expect(card.getByRole("status")).toContainText("1 model kimliği listelendi");
    await card.getByRole("button", { name: "Kayıtları yenile" }).click();
    await expect(card).toContainText("Model listede"); expect(calls).toBe(0);
    await card.getByLabel("Tam denemeyi inceledim; tek ücretlenebilir çağrıyı onaylıyorum.").check();
    await card.getByRole("button", { name: /Onaylanan denemeyi/ }).click();
    await expect(card).toContainText("Yapılandırılmış üretim başarılı"); expect(calls).toBe(1);
    await expect(card.getByRole("alert")).toContainText("bildirdiği çıktı istenen sınırı aştı");
    await card.getByLabel("Tam denemeyi inceledim; tek ücretlenebilir çağrıyı onaylıyorum.").check();
    await card.getByRole("button", { name: /Onaylanan denemeyi/ }).click();
    await expect(card).toContainText("Yapılandırılmış üretim başarılı"); expect(calls).toBe(1);
    await workspaceView(page, "Sohbet"); await expect(draft).toHaveValue("KEEP MY DRAFT");
    await page.reload(); await workspaceView(page, "Ayarlar"); await page.getByText(/Yerel sağlayıcı bağlantıları/).click();
    await card.getByRole("button", { name: "Üretim testi ve model geçmişi" }).click();
    await expect(card).toContainText("Yapılandırılmış üretim başarılı"); expect(calls).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await card.boundingBox(); expect(box!.width).toBeLessThanOrEqual(390);
    await card.getByLabel("Denenecek model").fill(" local-check ");
    await card.getByRole("button", { name: "Kayıtları yenile" }).click();
    await expect(card).toContainText("Yapılandırılmış üretim başarılı"); expect(calls).toBe(1);
    await card.getByLabel("Denenecek model").fill("changed-model");
    await expect(card.getByRole("button", { name: /Onaylanan denemeyi/ })).toHaveCount(0); expect(calls).toBe(1);
  } finally {
    if (id) await request.delete(`/api/provider-connections?id=${id}`);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("rejects stale, foreign-origin, unacknowledged and oversized checks before dispatch", async ({ request }) => {
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
  } finally { await request.delete(`/api/provider-connections?id=${connection.id}`); }
});
