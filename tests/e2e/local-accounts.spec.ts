import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { workspaceView } from "./workspace-navigation";

test("anonymous access is denied and registration, login and logout work on mobile", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100", viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} });
  const page = await context.newPage();
  const username = `mobile_${randomBytes(5).toString("hex")}`, password = randomBytes(16).toString("hex");
  try {
    for (const path of ["runs", "conversations", "provider-connections", "local-diagnostics", "mcp-connections"])
      expect((await context.request.get(`/api/${path}`)).status()).toBe(401);
    expect((await context.request.post("/api/knowledge", { data: { operation: "state" } })).status()).toBe(401);
    await page.goto("/"); await expect(page.getByRole("heading", { name: "Giriş yap" })).toBeVisible();
    await page.getByRole("button", { name: "Yeni hesap oluştur", exact: true }).click();
    await page.getByLabel("Adınız").fill("Mobile User"); await page.getByLabel("Kullanıcı adı", { exact: true }).fill(username);
    await page.getByLabel("Parola", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Hesap oluştur", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("oluşturuldu");
    await page.getByLabel("Kullanıcı adı", { exact: true }).fill(username); await page.getByLabel("Parola", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
    await expect(page.getByRole("banner", { name: "Hesap" })).toContainText(username);
    await expect(page.getByRole("button", { name: "Kullanıcı yönetimi", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Giriş yap" })).toBeVisible();
    expect((await context.request.get("/api/provider-connections")).status()).toBe(401);
  } finally { await context.close(); }
});
test("root inspects each user's connections and switches complete workspaces without draft or API leakage", async ({ page, request, browser }) => {
  test.setTimeout(60_000);
  await page.context().setExtraHTTPHeaders({});
  const username = `member_${randomBytes(5).toString("hex")}`, password = randomBytes(16).toString("hex");
  const created = await request.post("/api/auth/users", { data: { username, displayName: "Isolated Member", password } });
  expect(created.status()).toBe(201);
  const { user } = await created.json() as { user: { id: string; ownerId: string } };
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100", storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} });
  try {
    expect((await context.request.post("/api/auth/login", { data: { username, password } })).status()).toBe(200);
    expect((await context.request.get("/api/auth/users")).status()).toBe(403);
    expect((await context.request.post("/api/auth/scope", { data: { userId: user.id } })).status()).toBe(403);
    const label = `private-api-${username}`;
    const saved = await context.request.post("/api/provider-connections", { headers: { "X-Deliberation-Owner": user.ownerId }, data: {
      provider: "openai", label, defaultModel: "offline-only", apiKey: "test-credential-never-send", endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema" } });
    expect(saved.status()).toBe(200);
    expect(await saved.text()).not.toContain("test-credential-never-send");
    expect(await (await request.get("/api/provider-connections")).text()).not.toContain(label);
    const connections = await request.get(`/api/auth/users/${user.id}/connections`);
    expect(await connections.text()).toContain(label); expect(await connections.text()).not.toContain("test-credential-never-send");
    await page.goto("/"); await page.getByRole("button", { name: "Kullanıcı yönetimi", exact: true }).click();
    const row = page.locator(".account-user-list article").filter({ hasText: username });
    await row.getByRole("button", { name: "Bağlantıları gör" }).click();
    await expect(page.getByRole("region", { name: `${username} bağlantıları` })).toContainText(label);
    await row.getByRole("button", { name: "Kullanıcı alanını aç" }).click();
    await expect(page.locator(".account-scope")).toContainText("Isolated Member");
    // Playwright's stale root owner header cannot silently mutate the member's workspace.
    expect((await page.request.post("/api/provider-connections", { data: { label: "stale" } })).status()).toBe(409);
    await workspaceView(page, "Ayarlar");
    await expect(page.locator("main")).toContainText(label);
    await page.getByRole("button", { name: "Root alanına dön", exact: true }).click();
    await expect(page.locator(".account-scope")).toHaveCount(0);
    await workspaceView(page, "Ayarlar");
    await expect(page.locator("main")).not.toContainText(label);
  } finally {
    const current = await (await request.get("/api/auth/session")).json() as { session: { user: { id: string } } };
    await request.post("/api/auth/scope", { data: { userId: current.session.user.id } });
    await context.close();
  }
});
