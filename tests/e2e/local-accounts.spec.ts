import { withOwner } from "@deliberation-ai/persistence";
import { randomBytes } from "node:crypto";
import {expect, test, testOrigin, testOwnerId } from "./authenticated-test";

test("account entry has visible fields across themes and screen sizes, keyboard access and a reversible password reveal", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testOrigin, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Giriş yap", exact: true })).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        for (const name of ["Kullanıcı adı", "Parola"]) {
          const input = page.getByLabel(name, { exact: true });
          await expect(input).toBeVisible();
          const appearance = await input.evaluate(element => {
            const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
            return { height: bounds.height, width: bounds.width, border: parseFloat(style.borderTopWidth), borderColor: style.borderTopColor, background: style.backgroundColor };
          });
          expect(appearance.height).toBeGreaterThanOrEqual(44);
          expect(appearance.width).toBeGreaterThan(180);
          expect(appearance.border).toBeGreaterThanOrEqual(1);
          expect(appearance.borderColor).not.toBe(appearance.background);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width !== 320) await page.screenshot({ path: testInfo.outputPath(`login-${theme}-${width}.png`), fullPage: true });
      }
    }
    const username = page.getByLabel("Kullanıcı adı", { exact: true }), password = page.getByLabel("Parola", { exact: true });
    await username.focus(); await page.keyboard.press("Tab"); await expect(password).toBeFocused();
    await password.fill("offline-visibility-check"); await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Parolayı göster", exact: true })).toBeFocused();
    await page.keyboard.press("Enter"); await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("offline-visibility-check");
    await page.getByRole("button", { name: "Parolayı gizle", exact: true }).click(); await expect(password).toHaveAttribute("type", "password");
    await username.fill(`missing_${randomBytes(8).toString("hex")}`);
    const card = page.getByRole("region", { name: "Giriş yap", exact: true });
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click(); await expect(card.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Yeni hesap oluştur", exact: true }).click(); await expect(page.getByRole("region", { name: "Hesap oluştur", exact: true }).getByRole("alert")).toHaveCount(0);
    await expect(password).toHaveAttribute("type", "password"); await expect(password).toHaveAttribute("minlength", "8");
    await expect(username).toHaveAccessibleDescription(/3–32 karakter/);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("button", { name: "Hesap oluştur", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("register-dark-320.png"), fullPage: true });
  } finally { await context.close(); }
});

test("registration only needs a chosen username/password; self deletion removes connections and revokes all sessions", async ({ browser }) => withOwner(testOwnerId(), async () => {
  const context = await browser.newContext({ baseURL: testOrigin, viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} });
  const page = await context.newPage(), username = `mobile_${randomBytes(5).toString("hex")}`, password = randomBytes(16).toString("hex");
  try {
    expect((await context.request.get("/api/runs")).status()).toBe(401);
    await page.goto("/"); await page.getByRole("button", { name: "Yeni hesap oluştur", exact: true }).click();
    await page.getByLabel("Kullanıcı adı", { exact: true }).fill(username); await page.getByLabel("Parola", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Hesap oluştur", exact: true }).click(); await expect(page.getByRole("status")).toContainText("oluşturuldu");
    await page.getByLabel("Kullanıcı adı", { exact: true }).fill(username); await page.getByLabel("Parola", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Giriş yap", exact: true }).click(); await expect(page.getByRole("banner", { name: "Hesap" })).toContainText(username);
    const session = (await (await context.request.get("/api/auth/session")).json()).session;
    const saved = await context.request.post("/api/provider-connections", { headers: { "X-Deliberation-Owner": session.scope.ownerId }, data: {
      provider: "openai", label: "Generated personal connection", defaultModel: "offline", apiKey: "offline-generated-key", endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema" } });
    expect(saved.ok()).toBe(true);
    await page.getByRole("button", { name: "Hesabımı sil", exact: true }).click();
    const panel = page.getByRole("region", { name: "Hesap silme" }); await expect(panel).toContainText("1 bağlantı");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.getByRole("button", { name: "Vazgeç" }).click(); expect((await context.request.get("/api/provider-connections")).ok()).toBe(true);
    await page.getByRole("button", { name: "Hesabımı sil", exact: true }).click();
    await panel.getByLabel("Silinecek kullanıcı adı").fill(username); await panel.getByLabel("Mevcut parolanız").fill("wrong");
    await panel.getByRole("checkbox").check(); await panel.getByRole("button", { name: "Hesabı silmeyi onayla" }).click();
    await expect(panel.getByRole("alert")).toContainText("parola geçersiz");
    await panel.getByLabel("Mevcut parolanız").fill(password); await panel.getByRole("button", { name: "Hesabı silmeyi onayla" }).click();
    await expect(page.getByRole("heading", { name: "Giriş yap" })).toBeVisible();
    expect((await context.request.get("/api/provider-connections")).status()).toBe(401);
    expect((await context.request.post("/api/auth/login", { data: { username, password } })).status()).toBe(401);
  } finally { await context.close(); }
}));

test("root has only administration, manages connections, resets passwords and deletes an existing user", async ({ browser, request }) => withOwner(testOwnerId(), async () => {
  test.setTimeout(90_000);
  const username = `member_${randomBytes(5).toString("hex")}`, password = randomBytes(16).toString("hex"), newPassword = randomBytes(16).toString("hex");
  const created = await request.post("/api/auth/register", { data: { username, password } }); expect(created.status()).toBe(201);
  const { user } = await created.json();
  const member = await browser.newContext({ baseURL: testOrigin, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} });
  const admin = await browser.newContext({ baseURL: testOrigin, viewport: { width: 390, height: 844 }, storageState: ".local/e2e/root-session.json", extraHTTPHeaders: {} });
  const page = await admin.newPage();
  try {
    expect((await member.request.post("/api/auth/login", { data: { username, password } })).status()).toBe(200);
    expect((await member.request.get("/api/auth/users")).status()).toBe(403);
    expect((await member.request.get(`/api/auth/users/${user.id}/deletion`)).status()).toBe(403);
    expect((await member.request.post("/api/provider-connections", { headers: { "X-Deliberation-Owner": user.ownerId }, data: {
      provider: "openai", label: "Member private API", defaultModel: "offline", apiKey: "offline-generated-key", endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema" } })).ok()).toBe(true);
    await page.goto("/"); await expect(page.getByRole("heading", { name: "Kullanıcı yönetimi", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hesabımı sil", exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Çalışma alanları" })).toHaveCount(0);
    for (const path of ["runs", "conversations"])
      expect((await admin.request.get(`/api/${path}`)).status()).toBe(403);
    expect((await admin.request.post("/api/private-branches", { data: {} })).status()).toBe(403);
    expect((await admin.request.post("/api/knowledge", { data: { operation: "state" } })).status()).toBe(403);
    const row = page.locator(".account-user-list article").filter({ hasText: username });
    await row.getByRole("button", { name: "Bağlantıları yönet" }).click();
    const connections = page.getByRole("region", { name: `${username} bağlantıları` }); await expect(connections).toContainText("Member private API");
    expect((await admin.request.post("/api/runs", { headers: { "X-Deliberation-Owner": user.ownerId }, data: {} })).status()).toBe(403);
    await connections.getByRole("button", { name: "Bağlantıyı düzenle" }).click();
    await connections.getByLabel("Bağlantı adı").fill("Admin renamed connection"); await connections.getByRole("button", { name: "Bağlantıyı kaydet" }).click();
    await expect(connections).toContainText("Admin renamed connection");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await row.getByRole("button", { name: "Kullanıcıyı düzenle" }).click();
    const edit = page.getByRole("region", { name: "Kullanıcı düzenleme" }); await edit.getByLabel("Yeni parola").fill(newPassword);
    await edit.getByRole("button", { name: "Kullanıcıyı kaydet" }).click(); await expect(edit).toHaveCount(0);
    expect((await member.request.get("/api/provider-connections")).status()).toBe(401);
    expect((await member.request.post("/api/auth/login", { data: { username, password: newPassword } })).status()).toBe(200);
    await row.getByRole("button", { name: "Kullanıcıyı sil" }).click();
    const deletion = page.getByRole("region", { name: "Hesap silme" }); await deletion.getByLabel("Silinecek kullanıcı adı").fill(username);
    await deletion.getByLabel("Root parolanız").fill(process.env.DELIBERATION_TEST_PASSWORD!); await deletion.getByRole("checkbox").check();
    await deletion.getByRole("button", { name: "Hesabı silmeyi onayla" }).click(); await expect(row).toHaveCount(0);
    expect((await member.request.get("/api/provider-connections")).status()).toBe(401);
    expect((await request.get("/api/runs")).ok()).toBe(true); // unrelated ordinary-user session survives
  } finally {
    const current = (await (await admin.request.get("/api/auth/session")).json()).session;
    if (current) await admin.request.post("/api/auth/scope", { data: { userId: current.user.id } });
    await admin.close(); await member.close();
  }
}));
