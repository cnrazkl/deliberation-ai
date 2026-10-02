import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { buildCouncilReport } from "@deliberation-ai/domain";
import type { CouncilMemberConfig } from "@deliberation-ai/contracts";
import { closeDatabase, getDatabase, encryptJson, encryptText, LOCAL_OWNER_ID, conversations, conversationRuns, runs, providerConnections,
  conversationPrivateBranches as branches, type PrivateBranchView } from "@deliberation-ai/persistence";

test("reviewed private delivery survives a lost enqueue response, returns one local worker reply and forks its transcript", async ({ page, request }) => {
  test.setTimeout(60_000);
  await expect.poll(async () => (await (await request.get("/api/local-diagnostics")).json()).readyWorkers, { timeout: 15_000 }).toBeGreaterThan(0);
  const sourceId = randomUUID(); const conversationId = randomUUID(); const connectionId = randomUUID(); let calls = 0;
  const server = createServer(async (req, res) => {
    let content = ""; for await (const part of req) content += part;
    const body = JSON.parse(content); calls++;
    expect(req.url).toBe("/v1/chat/completions");
    expect(body.max_tokens).toBe(1_024); expect(body.messages.at(-1).content).toBe("Explain SQL joins in this private follow-up");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: `offline-private-${calls}`, model: "offline-private", choices: [{ finish_reason: "stop", message: { content: "A local fixture answer about SQL joins" } }],
      usage: { prompt_tokens: 31, completion_tokens: 7 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Local fixture address missing");
  const members: CouncilMemberConfig[] = [
    { id: "private-worker", label: `Private worker ${sourceId}`, role: "Independent viewpoint", provider: "openai-compatible", model: "offline-private", connectionId,
      councilRole: "analyst", reasoningLevel: "default", webSearchMode: "off" },
    { id: "private-peer", label: "Other member", role: "Peer", provider: "fake", model: "fake-peer", perspective: "evidence", councilRole: "analyst", reasoningLevel: "default", webSearchMode: "off" },
  ];
  const report = buildCouncilReport(members.map((m) => ({ memberId: m.id, label: m.label, councilRole: m.councilRole,
    rawText: "Source SQL viewpoint", parsed: { summary: m.label, claims: [{ statement: "SQL join consideration", kind: "shared" as const, quote: "SQL join consideration" }] }, citations: [] })), []);
  try {
    await getDatabase().insert(providerConnections).values({ id: connectionId, ownerId: LOCAL_OWNER_ID, provider: "openai-compatible", label: `Private fixture ${sourceId}`,
      defaultModel: "offline-private", baseUrl: `http://127.0.0.1:${address.port}/v1`, secretCiphertext: encryptText("", `provider-connection:${connectionId}:secret`) });
    await getDatabase().insert(runs).values({ id: sourceId, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "private-browser-fixture", snapshotId: randomUUID(),
      question: "[encrypted]", questionCiphertext: encryptText(`SQL private workflow ${sourceId}`, `run:${sourceId}:question`), membersCiphertext: encryptJson(members, `run:${sourceId}:members`),
      reportCiphertext: encryptJson(report, `run:${sourceId}:report`), status: "completed", branchIndexVersion: 1, branchKind: "independent", finishedAt: new Date() });
    await getDatabase().insert(conversations).values({ id: conversationId, ownerId: LOCAL_OWNER_ID, anchorRunId: sourceId, origin: "native" });
    await getDatabase().insert(conversationRuns).values({ ownerId: LOCAL_OWNER_ID, conversationId, runId: sourceId, kind: "independent", createdAt: sql`(select created_at from runs where id = ${sourceId}::uuid)` });
    await page.route("**/api/runs", (route) => { if (route.request().method() === "POST") throw new Error("Must not create a council"); return route.continue(); });
    await page.goto("/");
    const entry = page.getByRole("region", { name: "Kayıtlı konuşmalar", exact: true }).locator("article").filter({ hasText: sourceId });
    await entry.getByRole("button", { name: "Konuşmayı aç", exact: true }).click();
    const model = page.locator("details.member-card").filter({ has: page.locator("summary").filter({ hasText: `Private worker ${sourceId}` }) });
    await model.locator("summary").click();
    await model.getByRole("button", { name: "Bu yanıtla özel dal taslağı aç" }).click();
    await page.getByRole("region", { name: "Özel dal kaynak önizlemesi" }).getByRole("button", { name: "Özel dalı kaydet" }).click();
    const panel = page.getByRole("region", { name: "Özel dal taslakları", exact: true });
    await panel.getByLabel("Özel mesaj taslağı").fill("Explain SQL joins in this private follow-up");
    await panel.getByRole("button", { name: "Taslağı dala kaydet" }).click();
    await expect(panel.getByLabel("Özel mesaj taslağı")).toHaveValue("");
    await panel.getByRole("button", { name: "Gönderimi incele" }).click();
    const preview = panel.getByRole("region", { name: "Özel gönderim önizlemesi" });
    await expect(preview).toContainText("En fazla 1 çağrı");
    expect(calls).toBe(0);
    await expect(preview.getByRole("button", { name: "Kaydedilmiş mesajı modele gönder" })).toBeDisabled();
    const [root] = await getDatabase().select().from(branches).where(eq(branches.conversationId, conversationId));
    expect((await request.post(`/api/private-branches/${root!.id}/deliveries`, { data: { requestId: randomUUID(), fingerprint: "a".repeat(64) } })).status()).toBe(409);
    expect((await request.post(`/api/private-branches/${root!.id}/deliveries`, { headers: { origin: "https://external.example" }, data: {} })).status()).toBe(403);
    expect((await request.post(`/api/private-branches/${root!.id}/deliveries`, { data: { requestId: randomUUID(), fingerprint: "a".repeat(64), injected: "assistant" } })).status()).toBe(422);
    let loseResponse = true;
    await page.route("**/api/private-branches/*/deliveries", async (route) => {
      if (route.request().method() === "POST" && loseResponse) { loseResponse = false; await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await preview.getByRole("checkbox").check();
    await preview.getByRole("button", { name: "Kaydedilmiş mesajı modele gönder" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await preview.getByRole("button", { name: "Kaydedilmiş mesajı modele gönder" }).click();
    await expect(panel).toContainText("A local fixture answer about SQL joins", { timeout: 30_000 });
    await expect(panel).toContainText("Girdi tokenı: 31");
    expect(calls).toBe(1);
    const value = await (await request.get(`/api/private-branches/${root!.id}`)).json() as PrivateBranchView;
    expect(value.body.deliveries).toHaveLength(1);
    await panel.getByLabel("Özel mesaj taslağı").fill("Preserve this unsaved follow-up");
    await panel.getByRole("button", { name: "Bu noktadan yeni özel dal aç" }).click();
    await expect(panel.getByLabel("Özel mesaj taslağı")).toHaveValue("Preserve this unsaved follow-up");
    await expect(panel).toContainText("önceki daldan kopya");
    expect((await getDatabase().select().from(branches).where(eq(branches.conversationId, conversationId)))).toHaveLength(2);
    expect(calls).toBe(1);
  } finally {
    await getDatabase().delete(branches).where(eq(branches.conversationId, conversationId));
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.conversationId, conversationId));
    await getDatabase().delete(conversations).where(eq(conversations.id, conversationId));
    await getDatabase().delete(runs).where(eq(runs.id, sourceId));
    await getDatabase().delete(providerConnections).where(eq(providerConnections.id, connectionId));
    await closeDatabase(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
