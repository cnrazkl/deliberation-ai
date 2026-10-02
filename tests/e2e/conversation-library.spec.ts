import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, inArray, sql } from "drizzle-orm";
import { closeBoss, closeDatabase, enqueueDurableRun, executeDurableRun, getDatabase, loadRunConversation, RUN_COUNCIL_QUEUE } from "@deliberation-ai/persistence";
import { LOCAL_OWNER_ID } from "../../packages/persistence/src/owner";
import { conversations, conversationRuns, runs } from "../../packages/persistence/src/schema";

test("discovers saved conversations, paginates and opens a result without changing the draft or starting generation", async ({ page, request }) => {
  const ids: string[] = []; const conversationIds: string[] = [];
  try {
    const value = await enqueueDurableRun({ question: `Kayıtlı konuşma hangi alternatifleri içerir ${randomUUID()}?`, idempotencyKey: randomUUID(), providerMode: "fake", scenario: "success", reviewRounds: 0, memoryEntryIds: [] });
    ids.push(value.runId); await executeDurableRun(value.runId);
    const view = (await loadRunConversation(value.runId))!; conversationIds.push(view.conversationId);
    await getDatabase().update(conversations).set({ createdAt: sql`'2301-01-01 00:00:00+00'::timestamptz` }).where(eq(conversations.id, view.conversationId));
    for (let i = 0; i < 21; i++) {
      const id = randomUUID(); conversationIds.push(id);
      await getDatabase().insert(conversations).values({ id, ownerId: LOCAL_OWNER_ID, anchorRunId: randomUUID(), origin: "native", createdAt: sql`'2300-01-01 00:00:00+00'::timestamptz` });
    }
    expect((await request.get("/api/conversations?before=invalid")).status()).toBe(400);
    expect((await request.get(`/api/conversations?before=${randomUUID()}`)).status()).toBe(404);
    const listing = await request.get("/api/conversations");
    expect(listing.status()).toBe(200); expect(listing.headers()["cache-control"]).toBe("no-store");
    let dispatches = 0;
    page.on("request", (req) => { if (new URL(req.url()).pathname === "/api/runs" && req.method() === "POST") dispatches++; });
    await page.goto("/");
    const library = page.getByRole("region", { name: "Kayıtlı konuşmalar", exact: true });
    await expect(library.locator("[data-conversation-id]")).toHaveCount(20);
    await library.getByRole("button", { name: "Daha eski konuşmaları göster" }).click();
    await expect(library.locator(`[data-conversation-id="${conversationIds.at(-1)}"]`)).toBeVisible();
    const draft = `Konuşmalar arasında korunacak taslak ${randomUUID()}`;
    await page.getByLabel("Sorunuz", { exact: true }).fill(draft);
    const selectedConnection = await page.getByRole("combobox", { name: "Üye 1 bağlantısı", exact: true }).inputValue();
    await library.locator(`[data-conversation-id="${view.conversationId}"]`).getByRole("button", { name: "Konuşmayı aç", exact: true }).click();
    await expect(page.getByRole("region", { name: "Konuşma kaydı", exact: true })).toContainText(view.conversationId);
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue(draft);
    await expect(page.getByRole("combobox", { name: "Üye 1 bağlantısı", exact: true })).toHaveValue(selectedConnection);
    expect(dispatches).toBe(0);
    await library.getByRole("button", { name: "Konuşma listesini yenile" }).click();
    await expect(library.locator("[data-conversation-id]")).toHaveCount(20);
  } finally {
    await closeBoss();
    if (ids.length) {
      await getDatabase().execute(sql`delete from pgboss.job where name = ${RUN_COUNCIL_QUEUE} and data->>'runId' in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
      await getDatabase().delete(runs).where(inArray(runs.id, ids));
    }
    if (conversationIds.length) {
      await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.conversationId, conversationIds));
      await getDatabase().delete(conversations).where(inArray(conversations.id, conversationIds));
    }
    await closeDatabase();
  }
});

test("retrying the list preserves the draft and a refreshed first page rejects a stale older response", async ({ page }) => {
  const currentId = randomUUID(); const staleId = randomUUID(); const freshId = randomUUID();
  const item = (id: string, question: string) => ({ conversationId: id, createdAt: new Date().toISOString(), origin: "native",
    recordedRunCount: 1, availableRunCount: 1, unavailableRunCount: 0,
    latestAvailableRun: { runId: randomUUID(), question, status: "completed" } });
  let listStage: "error" | "current" | "fresh" = "error";
  let releaseOlder!: () => void; let olderArrived!: () => void;
  const olderSeen = new Promise<void>((resolve) => { olderArrived = resolve; });
  const olderRelease = new Promise<void>((resolve) => { releaseOlder = resolve; });
  await page.route("**/api/conversations*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("before")) {
      olderArrived(); await olderRelease;
      await route.fulfill({ json: { conversations: [item(staleId, "Eski isteğin sonucu")], nextCursor: null } }).catch(() => undefined);
      return;
    }
    if (listStage === "error") { await route.fulfill({ status: 503, json: { error: "Liste geçici olarak erişilemiyor." } }); return; }
    await route.fulfill({ json: { conversations: [item(listStage === "current" ? currentId : freshId, listStage === "current" ? "Önceki liste" : "Yenilenen liste")], nextCursor: listStage === "current" ? currentId : null } });
  });
  try {
    await page.goto("/");
    const library = page.getByRole("region", { name: "Kayıtlı konuşmalar", exact: true });
    await expect(library.getByRole("alert")).toHaveText("Liste geçici olarak erişilemiyor.");
    await page.getByLabel("Sorunuz", { exact: true }).fill("Liste yenilenirken korunacak taslak");
    listStage = "current";
    await library.getByRole("button", { name: "Konuşma listesini yenile" }).click();
    await expect(library.locator(`[data-conversation-id="${currentId}"]`)).toBeVisible();
    await library.getByRole("button", { name: "Daha eski konuşmaları göster" }).click();
    await olderSeen;
    listStage = "fresh";
    await library.getByRole("button", { name: "Konuşma listesini yenile" }).click();
    await expect(library.locator(`[data-conversation-id="${freshId}"]`)).toBeVisible();
    releaseOlder();
    await expect(library.locator("[data-conversation-id]")).toHaveCount(1);
    await expect(library).not.toContainText("Eski isteğin sonucu");
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Liste yenilenirken korunacak taslak");
  } finally { releaseOlder(); }
});
