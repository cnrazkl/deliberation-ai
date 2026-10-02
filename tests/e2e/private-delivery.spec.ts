import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { buildCouncilReport } from "@deliberation-ai/domain";
import type { CouncilMemberConfig } from "@deliberation-ai/contracts";
import { closeDatabase, getDatabase, encryptJson, encryptText, LOCAL_OWNER_ID, conversations, conversationRuns, runs, providerConnections,
  conversationPrivateBranches as branches, type PrivateBranchView } from "@deliberation-ai/persistence";

for (const provider of ["openai-compatible", "anthropic", "openai"] as const) {
test(`${provider} reviewed private delivery survives a lost enqueue response, returns a local worker reply and forks its transcript`, async ({ page, request }) => {
  test.setTimeout(60_000);
  await expect.poll(async () => (await (await request.get("/api/local-diagnostics")).json()).readyWorkers, { timeout: 15_000 }).toBeGreaterThan(0);
  const sourceId = randomUUID(); const conversationId = randomUUID(); const connectionId = randomUUID(); let calls = 0;
  const received: { url: string | undefined; headers: Record<string, string | string[] | undefined>; body: { model: string; system?: string;
    messages?: { role: string; content: string }[]; input?: { role: string; content: string; phase?: string }[]; max_tokens?: number; max_output_tokens?: number } }[] = [];
  const server = createServer(async (req, res) => {
    let content = ""; for await (const part of req) content += part;
    const body = JSON.parse(content); calls++;
    received.push({ url: req.url, headers: req.headers, body });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(provider === "openai"
      ? { object: "response", id: `offline-private-${calls}`, model: "offline-private", error: null,
        status: calls === 4 ? "queued" : calls === 1 || calls === 3 ? "incomplete" : "completed",
        incomplete_details: calls === 1 || calls === 3 ? { reason: "max_output_tokens" } : null,
        output: calls === 4 ? [] : [{ type: "reasoning", summary: [], encrypted_content: "opaque-browser-fixture-state" },
          ...(calls === 3 ? [] : [{ type: "message", role: "assistant", phase: "final_answer", status: calls === 1 ? "incomplete" : "completed",
            content: [{ type: "output_text", text: "A local fixture answer ", annotations: [] }, { type: "output_text", text: "about SQL joins", annotations: [] }] }])],
        usage: calls === 4 ? null : calls === 3 ? { input_tokens: 41, output_tokens: 1_024, output_tokens_details: { reasoning_tokens: 1_024 } }
          : { input_tokens: 31, output_tokens: 7, input_tokens_details: { cached_tokens: 12 }, output_tokens_details: { reasoning_tokens: 3 } } }
      : provider === "anthropic"
      ? { type: "message", role: "assistant", id: `offline-private-${calls}`, model: "offline-private",
        content: [{ type: "text", text: "A local fixture answer " }, { type: "text", text: "about SQL joins" }], stop_reason: calls === 1 ? "max_tokens" : "end_turn",
        usage: { input_tokens: 31, output_tokens: 7, cache_read_input_tokens: 12, cache_creation_input_tokens: 3 } }
      : { id: `offline-private-${calls}`, model: "offline-private", choices: [{ finish_reason: "stop", message: { content: "A local fixture answer about SQL joins" } }],
        usage: { prompt_tokens: 31, completion_tokens: 7 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Local fixture address missing");
  const members: CouncilMemberConfig[] = [
    { id: "private-worker", label: `Private worker ${sourceId}`, role: "Independent viewpoint", provider, model: "offline-private", connectionId,
      councilRole: "analyst", reasoningLevel: "default", webSearchMode: "off" },
    { id: "private-peer", label: "Other member", role: "Peer", provider: "fake", model: "fake-peer", perspective: "evidence", councilRole: "analyst", reasoningLevel: "default", webSearchMode: "off" },
  ];
  const report = buildCouncilReport(members.map((m) => ({ memberId: m.id, label: m.label, councilRole: m.councilRole,
    rawText: "Source SQL viewpoint", parsed: { summary: m.label, claims: [{ statement: "SQL join consideration", kind: "shared" as const, quote: "SQL join consideration" }] }, citations: [] })), []);
  try {
    await getDatabase().insert(providerConnections).values({ id: connectionId, ownerId: LOCAL_OWNER_ID, provider, label: `Private fixture ${sourceId}`,
      defaultModel: "offline-private", baseUrl: `http://127.0.0.1:${address.port}${provider === "anthropic" ? "" : "/v1"}`,
      secretCiphertext: encryptText(provider === "openai-compatible" ? "" : "offline-browser-key", `provider-connection:${connectionId}:secret`) });
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
    await expect(preview).toContainText(provider);
    if (provider === "openai") await expect(preview).toContainText("1024 çıktı sınırına reasoning tokenları da dahildir");
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
    expect(received[0]!.url).toBe(provider === "anthropic" ? "/v1/messages" : provider === "openai" ? "/v1/responses" : "/v1/chat/completions");
    expect(provider === "openai" ? received[0]!.body.max_output_tokens : received[0]!.body.max_tokens).toBe(1_024);
    expect((received[0]!.body.input ?? received[0]!.body.messages)!.at(-1)!.content).toBe("Explain SQL joins in this private follow-up");
    const value = await (await request.get(`/api/private-branches/${root!.id}`)).json() as PrivateBranchView;
    expect(value.body.deliveries).toHaveLength(1);
    if (provider === "anthropic") {
      const sent = value.body.deliveries![0]!.request;
      expect(received[0]!.body).toEqual({ model: sent.model, system: sent.messages[0]!.content, messages: sent.messages.slice(1), max_tokens: 1_024 });
      expect(received[0]!.headers["x-api-key"]).toBe("offline-browser-key");
      expect(received[0]!.headers["anthropic-version"]).toBe("2023-06-01");
      expect(received[0]!.headers.authorization).toBeUndefined();
      await expect(panel).toContainText("31 (önbellek hariç)");
      await expect(panel).toContainText("Önbellekten okunan token: 12");
      await expect(panel).toContainText("Önbelleğe yazılan token: 3");
    }
    if (provider === "openai") {
      const sent = value.body.deliveries![0]!.request;
      expect(received[0]!.body).toEqual({ model: sent.model, input: sent.messages.map((item) => item.role === "assistant" ? { ...item, phase: "final_answer" } : item),
        max_output_tokens: 1_024, store: false, background: false, stream: false, truncation: "disabled", text: { format: { type: "text" } } });
      expect(received[0]!.headers.authorization).toBe("Bearer offline-browser-key");
      expect(received[0]!.headers["anthropic-version"]).toBeUndefined();
      expect(JSON.stringify(value)).not.toContain("opaque-browser-fixture-state");
      await expect(panel).toContainText("Girdi sayacına dahil önbellek tokenı: 12");
      await expect(panel).toContainText("Çıktı sayacına dahil reasoning tokenı: 3");
    }
    if (provider !== "openai-compatible") {
      await expect(panel).toContainText("Yanıt çıktı sınırına ulaştı");
      await panel.getByLabel("Özel mesaj taslağı").fill("Explain a second SQL follow-up");
      await panel.getByRole("button", { name: "Taslağı dala kaydet" }).click();
      await expect(panel.getByLabel("Özel mesaj taslağı")).toHaveValue("");
      await panel.getByRole("button", { name: "Gönderimi incele" }).click();
      await preview.getByRole("checkbox").check();
      await preview.getByRole("button", { name: "Kaydedilmiş mesajı modele gönder" }).click();
      await expect(panel.getByRole("article", { name: "Özel gönderim kaydı" })).toHaveCount(2);
      await expect.poll(async () => (await (await request.get(`/api/private-branches/${root!.id}`)).json()).body.deliveries[1].status).toBe("succeeded");
      expect(calls).toBe(2);
      expect((received[1]!.body.input ?? received[1]!.body.messages)!.slice(-2)).toEqual([
        { role: "assistant", content: "A local fixture answer about SQL joins", ...(provider === "openai" ? { phase: "final_answer" } : {}) },
        { role: "user", content: "Explain a second SQL follow-up" },
      ]);
    }
    if (provider === "openai") {
      for (const [message, expectedStatus] of [["Explain an output-limited SQL reply", "failed"], ["Explain a remotely pending SQL reply", "outcome_unknown"]] as const) {
        await panel.getByLabel("Özel mesaj taslağı").fill(message);
        await panel.getByRole("button", { name: "Taslağı dala kaydet" }).click();
        await expect(panel.getByLabel("Özel mesaj taslağı")).toHaveValue("");
        await panel.getByRole("button", { name: "Gönderimi incele" }).click();
        await preview.getByRole("checkbox").check();
        await preview.getByRole("button", { name: "Kaydedilmiş mesajı modele gönder" }).click();
        await expect.poll(async () => (await (await request.get(`/api/private-branches/${root!.id}`)).json()).body.deliveries.at(-1).status).toBe(expectedStatus);
      }
      await expect(panel).toContainText("Çıktı sınırı görünür yanıt oluşmadan doldu");
      await expect(panel).toContainText("Girdi tokenı: 41");
      await expect(panel.getByRole("button", { name: "Taslağı dala kaydet" })).toBeDisabled();
      await expect(panel.getByRole("button", { name: "Bu noktadan yeni özel dal aç" })).toBeDisabled();
      const pending = panel.getByRole("article", { name: "Özel gönderim kaydı" }).filter({ hasText: "private_remote_pending" });
      await expect(pending).toContainText("Sonuç belirsiz");
      await pending.getByRole("checkbox").check();
      await pending.getByRole("button", { name: "Belirsiz kaydı kapat" }).click();
      await expect(pending).toContainText("Belirsiz kayıt kapatıldı");
      expect(calls).toBe(4);
      const saved = await (await request.get(`/api/private-branches/${root!.id}`)).json() as PrivateBranchView;
      expect(saved.body.deliveries![2]).toMatchObject({ result: null, usage: { inputTokens: 41, outputTokens: 1_024 } });
      expect(saved.body.deliveries![3]).toMatchObject({ result: null, usage: { inputTokens: null, outputTokens: null } });
      expect(JSON.stringify(received[3]!.body)).not.toContain("opaque-browser-fixture-state");
    }
    await panel.getByLabel("Özel mesaj taslağı").fill("Preserve this unsaved follow-up");
    await panel.getByRole("button", { name: "Bu noktadan yeni özel dal aç" }).click();
    await expect(panel.getByLabel("Özel mesaj taslağı")).toHaveValue("Preserve this unsaved follow-up");
    await expect(panel).toContainText("önceki daldan kopya");
    expect((await getDatabase().select().from(branches).where(eq(branches.conversationId, conversationId)))).toHaveLength(2);
    expect(calls).toBe(provider === "openai" ? 4 : provider === "anthropic" ? 2 : 1);
  } finally {
    await getDatabase().delete(branches).where(eq(branches.conversationId, conversationId));
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.conversationId, conversationId));
    await getDatabase().delete(conversations).where(eq(conversations.id, conversationId));
    await getDatabase().delete(runs).where(eq(runs.id, sourceId));
    await getDatabase().delete(providerConnections).where(eq(providerConnections.id, connectionId));
    await closeDatabase(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
}
