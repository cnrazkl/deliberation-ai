import { createServer } from "node:http";
import { getPool } from "@deliberation-ai/persistence";
import { expect, test } from "./authenticated-test";
import { workspaceView } from "./workspace-navigation";
import { addConnectionModels, openConnectionPanel } from "./connection-model-selection";
const settings = { provider: "openai-compatible", apiKey: "", endpointPreset: "ollama", reasoningProtocol: "none", structuredOutputMode: "json-object", selectedModels: ["chat-fixture"] };

test("save-and-test creates a connection, returns plain text and preserves the council draft", async ({ page, request }) => {
  let calls = 0;
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls++; expect(body.model).toBe("chat-fixture"); expect(body.max_tokens).toBe(512);
    expect(body.messages).toHaveLength(2); expect(body.messages[1]).toEqual({ role: "user", content: "Short test question" });
    expect(body.tools).toBeUndefined(); expect(body.response_format).toBeUndefined(); expect(JSON.stringify(body)).not.toContain("Keep my council draft");
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ model: "chat-fixture", choices: [{ message: { role: "assistant", content: "Short fixture reply" }, finish_reason: "stop" }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture bind failed");
  const label = `Chat save fixture ${crypto.randomUUID()}`;
  let id: string | undefined;
  try {
    await page.goto("/"); await page.getByLabel("Sorunuz", { exact: true }).fill("Keep my council draft"); await workspaceView(page, "Ayarlar");
    await page.getByRole("button", { name: "Yeni Bağlantı Ekle", exact: true }).click();
    const dialog = page.getByRole("dialog"), form = dialog.locator(".connection-form"), chat = dialog.getByRole("region", { name: "Kısa bağlantı sohbeti" });
    await form.getByLabel("Sağlayıcı ailesi").selectOption("openai-compatible"); await form.getByLabel("Uç nokta türü").selectOption("ollama");
    await form.getByLabel("Bağlantı adı").fill(label); await form.getByLabel("Temel URL").fill(`http://127.0.0.1:${address.port}/v1`);
    await addConnectionModels(form, ["chat-fixture"]); await chat.getByLabel("Test mesajı").fill("Short test question");
    await expect(chat.getByRole("button", { name: "Kaydet Ve Test Et" })).toBeDisabled();
    await chat.getByRole("checkbox", { name: /Bu mesajı ve modeli/ }).check(); await chat.getByRole("button", { name: "Kaydet Ve Test Et" }).click();
    await expect(chat).toContainText("Short fixture reply"); expect(calls).toBe(1); await expect(dialog).toBeVisible();
    id = (await (await request.get("/api/provider-connections")).json()).connections.find((item: { label: string }) => item.label === label)?.id;
    expect(id).toBeTruthy(); await page.keyboard.press("Escape");
    await workspaceView(page, "Sohbet"); await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Keep my council draft");
    await workspaceView(page, "Ayarlar"); await openConnectionPanel(page, page.locator(".connection-card").filter({ hasText: label }));
    await expect(chat).toContainText("Short fixture reply"); expect(calls).toBe(1);
    await chat.getByRole("button", { name: "Sonucu Kontrol Et" }).click(); expect(calls).toBe(1);
    await page.keyboard.press("Escape");
  } finally { if (id) await request.delete(`/api/provider-connections?id=${id}`); await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const theme of ["light", "dark"]) for (const width of [320, 1110]) {
  test(`populated connection chat fits ${width}px in ${theme} and edits revoke approval`, async ({ page, request }, info) => {
    const created = await request.post("/api/provider-connections", { data: { ...settings, label: `Chat layout fixture ${crypto.randomUUID()}`, baseUrl: "http://127.0.0.1:11434/v1", selectedModels: ["chat-fixture", "second-fixture"] } });
    const connection = await created.json(); let calls = 0;
    try {
      await page.route(`**/${connection.id}/chat-check`, route => {
        if (route.request().method() !== "GET") { calls++; return route.abort(); }
        return route.fulfill({ json: { observations: { generationChecks: [{ version: "connection-generation-v1", id: "33333333-3333-4333-8333-333333333333", revision: 1,
          model: "chat-fixture", provider: "openai-compatible", endpointPreset: "ollama", fingerprint: "a".repeat(64), status: "succeeded",
          startedAt: "2026-10-10T00:00:00.000Z", finishedAt: "2026-10-10T00:00:01.000Z", acknowledgedAt: null, failure: null, httpStatus: null,
          returnedModel: "chat-fixture", remoteResponseId: null, inputTokens: null, outputTokens: null, elapsedMs: 1000,
          kind: "chat", message: "Merhaba, bu bağlantı çalışıyor mu?", reply: "Evet, bağlantı kısa sohbet yanıtını döndürüyor.\n" + "uzun-satır-".repeat(36),
        }] } } });
      });
      await page.setViewportSize({ width, height: 1066 }); await page.goto("/");
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme); await workspaceView(page, "Ayarlar");
      const dialog = await openConnectionPanel(page, page.locator(".connection-card").filter({ hasText: connection.label }));
      const chat = dialog.getByRole("region", { name: "Kısa bağlantı sohbeti" }); await expect(chat).toContainText("bağlantı kısa sohbet yanıtını");
      const acknowledgement = chat.getByRole("checkbox", { name: /Bu mesajı ve modeli/ }); await acknowledgement.check();
      await chat.getByLabel("Test modeli").selectOption("second-fixture"); await expect(acknowledgement).not.toBeChecked();
      await acknowledgement.check(); await dialog.locator(".connection-form").getByLabel("Bağlantı adı").fill("Changed fixture name");
      await expect(acknowledgement).not.toBeChecked(); await expect(chat.getByRole("button", { name: "Kaydet Ve Test Et" })).toBeDisabled();
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await chat.screenshot({ path: info.outputPath(`chat-${theme}-${width}.png`) }); expect(calls).toBe(0);
      await page.keyboard.press("Escape");
    } finally { await request.delete(`/api/provider-connections?id=${connection.id}`); }
  });
}

test("chat displays HTTP error codes immediately and lost responses never resend", async ({ page, request }) => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const server = createServer(async (incoming, outgoing) => {
    for await (const _chunk of incoming) { /* Discard synthetic request content. */ }
    calls++; await gate; outgoing.writeHead(429, { "content-type": "application/json" }); outgoing.end(JSON.stringify({ error: "PRIVATE ERROR BODY" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture bind failed");
  const created = await request.post("/api/provider-connections", { data: { ...settings, label: `Chat failure fixture ${crypto.randomUUID()}`, baseUrl: `http://127.0.0.1:${address.port}/v1` } });
  const connection = await created.json(); let lost = true;
  try {
    await page.route(`**/${connection.id}/chat-check`, async route => {
      if (route.request().method() !== "POST" || route.request().postDataJSON().action !== "send" || !lost) return route.continue();
      lost = false; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort();
    });
    await page.goto("/"); await workspaceView(page, "Ayarlar"); const dialog = await openConnectionPanel(page, page.locator(".connection-card").filter({ hasText: connection.label }));
    const chat = dialog.getByRole("region", { name: "Kısa bağlantı sohbeti" });
    await chat.getByRole("checkbox", { name: /Bu mesajı ve modeli/ }).check(); await chat.getByRole("button", { name: "Mesajı Gönder" }).click();
    await expect.poll(() => calls).toBe(1); await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Bağlantı panelini kapat" })).toBeDisabled();
    release(); await expect(chat.getByRole("alert")).toBeVisible(); await expect(chat.getByRole("button", { name: "Mesajı Gönder" })).toBeDisabled();
    await chat.getByRole("button", { name: "Sonucu Kontrol Et" }).click(); await expect(chat).toContainText("provider_http_429"); await expect(chat).toContainText("HTTP 429");
    expect(await chat.locator("code").last().evaluate(element => {
      const code = element.getBoundingClientRect(), log = element.closest('[role="log"]')!.getBoundingClientRect();
      return code.top >= log.top && code.bottom <= log.bottom;
    })).toBe(true);
    await expect(chat).not.toContainText("PRIVATE ERROR BODY"); expect(calls).toBe(1);
    await page.keyboard.press("Escape");
  } finally { release(); await request.delete(`/api/provider-connections?id=${connection.id}`); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("chat rejects foreign-origin, missing approval, stale message and oversized input before dispatch", async ({ request }) => {
  const empty = await (await request.post("/api/provider-connections", { data: { ...settings, label: `Chat empty fixture ${crypto.randomUUID()}`, baseUrl: "http://127.0.0.1:11434/v1", selectedModels: [] } })).json();
  try {
    const history = await request.get(`/api/provider-connections/${empty.id}/chat-check`);
    expect(history.status()).toBe(200); expect((await history.json()).observations.generationChecks).toEqual([]);
  } finally { await request.delete(`/api/provider-connections?id=${empty.id}`); }
  const unbound = createServer(); await new Promise<void>(resolve => unbound.listen(0, "127.0.0.1", resolve));
  const address = unbound.address(); if (!address || typeof address === "string") throw new Error("Fixture bind failed");
  await new Promise<void>(resolve => unbound.close(() => resolve()));
  const created = await request.post("/api/provider-connections", { data: { ...settings, label: `Chat guard fixture ${crypto.randomUUID()}`, baseUrl: `http://127.0.0.1:${address.port}/v1` } });
  const connection = await created.json(), endpoint = `/api/provider-connections/${connection.id}/chat-check`;
  try {
    const preview = await (await request.post(endpoint, { data: { action: "review", model: "chat-fixture", message: "Fixture" } })).json();
    const input = { action: "send", requestId: crypto.randomUUID(), model: "chat-fixture", message: "Fixture", fingerprint: preview.fingerprint, acknowledge: true };
    expect((await request.post(endpoint, { headers: { origin: "https://foreign.example" }, data: input })).status()).toBe(403);
    expect((await request.post(endpoint, { data: { ...input, acknowledge: false } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { ...input, message: "Changed" } })).status()).toBe(409);
    expect((await request.post(endpoint, { data: { ...input, message: "x".repeat(1201) } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: "x".repeat(8193) })).status()).toBe(413);
    const check = await (await request.post(endpoint, { data: input })).json(); expect(check.errorCode).toBe("provider_connection_refused");
    expect((await request.post(endpoint, { data: input })).headers()["cache-control"]).toBe("no-store");
    await request.patch(`/api/provider-connections/${connection.id}/generation-check`, { data: { id: check.id, fingerprint: check.fingerprint, acknowledgeUnknown: true } });
    // The unknown receipt is younger than the deadline; deletion remains guarded.
  } finally {
    await getPool().query("DELETE FROM provider_connections WHERE id=$1", [connection.id]);
  }
});
