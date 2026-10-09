import { createServer } from "node:http";
import { expect, test, testOrigin } from "./authenticated-test";
import { workspaceView } from "./workspace-navigation";
import { addConnectionModels } from "./connection-model-selection";

test("new connection lists models on explicit click without persistence or generation", async ({ page, request, playwright }) => {
  const calls: { url: string; authorization?: string }[] = [];
  const server = createServer((incoming, outgoing) => {
    calls.push({ url: incoming.url ?? "", authorization: incoming.headers.authorization });
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ data: [{ id: "local-a" }, { id: "local-b" }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test catalog did not bind.");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const draft = { provider: "openai-compatible", endpointPreset: "litellm", apiKey: "synthetic-catalog-key", baseUrl };
  const before = await (await request.get("/api/provider-connections")).json();
  let savedId: string | undefined;
  const anonymous = await playwright.request.newContext({ baseURL: testOrigin, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} });
  const root = await playwright.request.newContext({ baseURL: testOrigin, storageState: ".local/e2e/root-session.json" });
  try {
    await page.goto("/"); await workspaceView(page, "Ayarlar");
    await page.getByRole("button", { name: "Yeni Bağlantı Ekle", exact: true }).click();
    const form = page.locator(".connection-form");
    await expect(form.getByLabel("Düşünme parametresi")).not.toBeVisible();
    await form.getByLabel("Sağlayıcı ailesi").selectOption("openai-compatible");
    await form.getByLabel("Uç nokta türü").selectOption("litellm");
    await form.getByLabel("Bağlantı adı", { exact: true }).fill("E2E new model catalog");
    await form.getByLabel("API anahtarı", { exact: true }).fill(draft.apiKey);
    await form.getByLabel("Temel URL").fill(baseUrl);
    expect(calls).toHaveLength(0);
    await form.getByRole("button", { name: "Modelleri getir", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("2 model listelendi");
    await expect(form.locator(".connection-model-dropdown")).toBeVisible();
    expect(await (await request.get("/api/provider-connections")).json()).toEqual(before);
    expect(calls).toEqual([{ url: "/v1/models", authorization: "Bearer synthetic-catalog-key" }]);
    await addConnectionModels(form, ["local-a", "local-b"]);
    await expect(form.locator(".connection-selected-models")).toContainText("local-b");
    await expect(form.getByLabel("Başlangıç modeli (görev sırasında değiştirilebilir)")).toHaveCount(0);
    await expect(form.getByLabel("Bağlantı adı", { exact: true })).toHaveValue("E2E new model catalog");

    // The preview obeys the same authenticated owner/origin boundary as saved catalogs.
    expect((await anonymous.post("/api/provider-connections/model-preview", { data: draft })).status()).toBe(401);
    expect((await root.post("/api/provider-connections/model-preview", { data: draft })).status()).toBe(403);
    expect((await request.post("/api/provider-connections/model-preview", { data: draft, headers: { origin: "https://untrusted.example" } })).status()).toBe(403);
    expect((await request.post("/api/provider-connections/model-preview", { data: draft, headers: { "X-Deliberation-Owner": crypto.randomUUID() } })).status()).toBe(409);
    expect((await request.post("/api/provider-connections/model-preview", { data: { ...draft, id: crypto.randomUUID() } })).status()).toBe(400);
    expect((await request.post("/api/provider-connections/model-preview", { data: { ...draft, baseUrl: "http://user:secret@localhost" } })).status()).toBe(400);
    expect((await request.post("/api/provider-connections/model-preview", { data: "x".repeat(8_193), headers: { "content-type": "application/json" } })).status()).toBe(413);
    expect(calls).toHaveLength(1);

    await form.getByText("Gelişmiş uç nokta ayarları", { exact: true }).click();
    await form.getByLabel("Düşünme parametresi").selectOption("openai");
    const savedResponse = page.waitForResponse(response => response.url().endsWith("/api/provider-connections") && response.request().method() === "POST");
    await form.getByRole("button", { name: "Yeni Bağlantı Ekle" }).click();
    const saved = await savedResponse;
    expect(saved.ok()).toBe(true); savedId = (await saved.json() as { id: string }).id;
    await expect(page.locator(".primary-connections .connection-save-notice")).toHaveText("Yeni bağlantı başarıyla şifrelenerek eklenmiştir.");
    expect(calls).toHaveLength(1);
    await workspaceView(page, "Sohbet"); await page.getByRole("button", { name: "Konseyi düzenle", exact: true }).click();
    await page.getByLabel("Üye 1 bağlantısı").selectOption(savedId!);
    await page.getByLabel("Üye 1 modeli").selectOption("local-a");
    await page.getByLabel("Üye 2 bağlantısı").selectOption(savedId!);
    await page.getByLabel("Üye 2 modeli").selectOption("local-b");
    await page.getByLabel("Üye 1 düşünme seviyesi").selectOption("none");
    await expect(page.getByLabel("Üye 2 modeli")).toHaveValue("local-b");
    expect(calls).toHaveLength(1);
  } finally {
    if (savedId) await request.delete(`/api/provider-connections?id=${encodeURIComponent(savedId)}`);
    await anonymous.dispose();
    await root.dispose();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("draft catalog rejects stale results after credentials change and retains manual model fallback", async ({ page }) => {
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const firstReleased = new Promise<void>(resolve => { release = resolve; });
  const requests: string[] = [];
  await page.route("**/api/provider-connections/model-preview", async route => {
    const body = route.request().postDataJSON() as { apiKey: string }; requests.push(body.apiKey);
    if (body.apiKey === "first-synthetic-key") { started!(); await firstReleased; }
    try { await route.fulfill({ json: body.apiKey === "first-synthetic-key"
      ? { status: "available", verification: "authenticated_catalog", models: ["stale-model"], truncated: false }
      : { status: "unsupported", verification: "none", models: [], truncated: false } }); } catch { /* The invalidated fetch is aborted. */ }
  });
  try {
    await page.goto("/"); await workspaceView(page, "Ayarlar"); await page.getByRole("button", { name: "Yeni Bağlantı Ekle", exact: true }).click();
    const form = page.locator(".connection-form");
    await form.getByLabel("API anahtarı", { exact: true }).fill("first-synthetic-key");
    await form.getByRole("button", { name: "Modelleri getir", exact: true }).click(); await firstStarted;
    await form.getByLabel("API anahtarı", { exact: true }).fill("second-synthetic-key");
    await addConnectionModels(form, ["manual-model"]);
    release!();
    await expect(form.getByRole("button", { name: "Modelleri getir", exact: true })).toBeEnabled();
    await form.getByRole("button", { name: "Modelleri getir", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("model listelemeyi desteklemiyor");
    await expect(form.getByRole("checkbox", { name: "stale-model", exact: true })).toHaveCount(0);
    await expect(form).not.toContainText("stale-model");
    await expect(form.locator(".connection-selected-models")).toContainText("manual-model");
    await form.getByLabel("Sağlayıcı ailesi").selectOption("google");
    await expect(form.getByRole("status", { includeHidden: true })).toBeEmpty();
    expect(requests).toEqual(["first-synthetic-key", "second-synthetic-key"]);
  } finally { release?.(); }
});
