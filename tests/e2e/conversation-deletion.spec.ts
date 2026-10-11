import { withOwner } from "@deliberation-ai/persistence";
import { revealConversationOptions } from "./workspace-navigation";
import { randomUUID } from "node:crypto";
import { expect, test, testOwnerId } from "./authenticated-test";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDatabase, conversations, conversationRuns, getDatabase } from "@deliberation-ai/persistence";

test("reviews deletion of generated empty metadata, rejects invalid confirmations and preserves other conversations and the draft", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  const target = randomUUID(); const neighbor = randomUUID(); const foreign = randomUUID();
  const source = randomUUID(); const member = randomUUID();
  let generations = 0;
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generations += 1; });
  try {
    await getDatabase().insert(conversations).values([
      { id: target, ownerId: testOwnerId(), anchorRunId: source, origin: "native", createdAt: sql`'2400-01-03'::timestamptz` },
      { id: neighbor, ownerId: testOwnerId(), anchorRunId: randomUUID(), origin: "native", createdAt: sql`'2400-01-02'::timestamptz` },
      { id: foreign, ownerId: "foreign-deletion-fixture", anchorRunId: randomUUID(), origin: "native" },
    ]);
    await getDatabase().insert(conversationRuns).values({ ownerId: testOwnerId(), conversationId: target, runId: member,
      sourceRunId: source, kind: "continuation-full", createdAt: new Date() });
    const endpoint = "/api/conversations/" + target + "/deletion";
    const previewResponse = await request.get(endpoint);
    expect(previewResponse.status()).toBe(200);
    expect(previewResponse.headers()["cache-control"]).toBe("no-store");
    const preview = await previewResponse.json() as { fingerprint: string; eligible: boolean };
    expect(preview.eligible).toBe(true);
    const body = { conversationId: target, fingerprint: preview.fingerprint, confirmMetadataDeletion: true };
    const contentPreview = await (await request.get(endpoint + "?scope=content")).json();
    const contentBody = { conversationId: target, fingerprint: contentPreview.fingerprint, confirmContentDeletion: true };
    expect((await request.post(endpoint, { data: contentBody, headers: { origin: "https://external.example" } })).status()).toBe(403);
    expect((await request.post(endpoint, { data: { ...contentBody, confirmContentDeletion: false } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { ...contentBody, extra: true } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: body, headers: { origin: "https://external.example" } })).status()).toBe(403);
    expect((await request.post(endpoint, { data: { ...body, conversationId: neighbor } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { ...body, confirmMetadataDeletion: false } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { ...body, fingerprint: "0".repeat(64) } })).status()).toBe(409);
    expect((await request.post(endpoint, { data: "x".repeat(4_097), headers: { "Content-Type": "application/json" } })).status()).toBe(413);
    expect((await request.get("/api/conversations/" + foreign + "/deletion")).status()).toBe(404);
    expect((await request.post("/api/conversations/" + foreign + "/deletion", { data: { ...body, conversationId: foreign } })).status()).toBe(404);
    expect((await request.get("/api/conversations/invalid/deletion")).status()).toBe(404);
    await page.goto("/");
    const library = page.getByRole("region", { name: "Kayıtlı konuşmalar", exact: true });
    const card = library.locator('[data-conversation-id="' + target + '"]');
    // The API-loaded fixture card establishes client readiness before editing
    // the server-rendered controlled textarea during a cold development load.
    await revealConversationOptions(page);
    await expect(card.getByRole("button", { name: "Konuşmayı Sil", exact: true })).toBeVisible();
    await page.getByLabel("Sorunuz", { exact: true }).fill("Silme önizlemesinde korunacak soru taslağı");
    await revealConversationOptions(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await card.getByRole("button", { name: "Konuşmayı Sil", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Konuşmayı Sil", exact: true });
    await expect(panel).toHaveCount(1);
    await expect(panel).toContainText("emin misiniz");
    await expect(panel).toContainText("yedeklerdeki kopyalar korunur");
    await expect(panel.getByRole("button", { name: "Evet, Konuşmayı Sil" })).toBeEnabled();
    await expect(panel.getByRole("checkbox")).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0);
    await panel.getByRole("button", { name: "Vazgeç", exact: true }).click();
    expect((await request.get(endpoint)).status()).toBe(200);
    await revealConversationOptions(page);
    await card.getByRole("button", { name: "Konuşmayı Sil", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Evet, Konuşmayı Sil" })).toBeEnabled();
    // Server state changes after review, while remaining eligible.
    await getDatabase().update(conversationRuns).set({ createdAt: sql`created_at + interval '1 microsecond'` }).where(eq(conversationRuns.conversationId, target));
    await panel.getByRole("button", { name: "Evet, Konuşmayı Sil" }).click();
    await expect(panel.getByRole("alert")).toContainText("Konuşma kaydı değişti");
    expect((await request.get(endpoint)).status()).toBe(200);
    await panel.getByRole("button", { name: "Durumu Yenile" }).click();
    await expect(panel.getByRole("button", { name: "Evet, Konuşmayı Sil" })).toBeEnabled();
    await page.route(`**${endpoint}`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort();
    });
    await panel.getByRole("button", { name: "Evet, Konuşmayı Sil" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await panel.getByRole("button", { name: "Durumu Yenile" }).click();
    await expect(panel).toHaveCount(0);
    await expect(card).toHaveCount(0);
    expect((await request.get(endpoint)).status()).toBe(404);
    expect((await request.post(endpoint, { data: body })).status()).toBe(404);
    expect((await request.get("/api/conversations/" + neighbor + "/deletion")).status()).toBe(200);
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Silme önizlemesinde korunacak soru taslağı");
    expect(generations).toBe(0);
  } finally {
    // Only the three explicitly generated identities are cleaned; no run bodies exist.
    await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.conversationId, [target, neighbor, foreign]));
    await getDatabase().delete(conversations).where(inArray(conversations.id, [target, neighbor, foreign]));
    await closeDatabase();
  }
}));

test("failed previews allow retry and a blocked preview cannot delete", async ({ page }) => withOwner(testOwnerId(), async () => {
  const conversationId = randomUUID(); let fail = true; let deleteCalls = 0;
  await page.route("**/api/conversations", (route) => route.fulfill({ json: { conversations: [{ conversationId,
    createdAt: new Date().toISOString(), origin: "native", recordedRunCount: 1, availableRunCount: 0,
    unavailableRunCount: 1, latestAvailableRun: null }], nextCursor: null } }));
  await page.route("**/api/conversations/*/deletion**", (route) => {
    if (route.request().method() === "POST") { deleteCalls += 1; return route.fulfill({ status: 409, json: { error: "Silme engellendi." } }); }
    return fail ? route.fulfill({ status: 500, json: { error: "Önizleme geçici olarak erişilemiyor." } }) :
      route.fulfill({ json: { version: "conversation-content-deletion-v1", conversationId, runIds: [], privateBranchIds: [], membershipCount: 1,
        dependencies: [], knowledgeRecordCount: 0, eligible: false, blockedReasons: ["pending_operations"], fingerprint: null } });
  });
  await page.goto("/");
  await revealConversationOptions(page);
    await page.getByRole("button", { name: "Konuşmayı Sil", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Konuşmayı Sil", exact: true });
  await expect(panel.getByRole("alert")).toContainText("Önizleme geçici olarak erişilemiyor.");
  fail = false; await panel.getByRole("button", { name: "Durumu Yenile" }).click();
  await expect(panel).toContainText("belirsiz bir işlem var");
  await expect(panel.getByRole("button", { name: "Evet, Konuşmayı Sil" })).toBeDisabled();
  await panel.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(deleteCalls).toBe(0);
}));
