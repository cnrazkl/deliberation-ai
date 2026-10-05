import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { KnowledgePacket } from "@deliberation-ai/contracts";
import type { RunRecord } from "@deliberation-ai/application";
import { revealCouncilControls } from "./workspace-navigation";
import { cancelDurableRun, closeDatabase, deleteProviderConnection, getDatabase } from "@deliberation-ai/persistence";
import { eq, inArray } from "drizzle-orm";
import * as s from "../../packages/persistence/src/schema";

test("selected files produce reviewed frozen citations through real routes and local provider calls", async ({ page, request }) => {
  test.setTimeout(90_000);
  const sent: string[] = [];
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    sent.push(body.messages.find((item: { role: string }) => item.role === "user").content);
    const statement = "Yerel bağımsız kaynak değerlendirmesi";
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ id: `offline-knowledge-${sent.length}`, model: "offline-knowledge", choices: [{ message: { content: JSON.stringify({ summary: statement, claims: [{ statement, quote: statement, kind: "recommendation" }] }) } }], usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture server unavailable");
  let connectionId: string | undefined, collectionId: string | undefined, conversationId: string | undefined, runId: string | undefined, draftId: string | undefined;
  try {
    const saved = await request.post("/api/provider-connections", { data: { provider: "openai-compatible", label: `Offline knowledge ${randomUUID()}`, apiKey: "", defaultModel: "offline-knowledge", baseUrl: `http://127.0.0.1:${address.port}/v1`, endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object" } });
    expect(saved.ok()).toBe(true); connectionId = (await saved.json()).id;
    expect((await request.post("/api/knowledge", { data: { operation: "tools", url: "https://foreign.example" } })).status()).toBe(422);
    expect((await request.post("/api/knowledge", { headers: { origin: "https://foreign.example" }, data: { operation: "conversation" } })).status()).toBe(403);
    await page.goto("/"); await revealCouncilControls(page);
    for (const index of [1, 2]) await page.getByRole("combobox", { name: `Üye ${index} bağlantısı`, exact: true }).selectOption(connectionId);
    await page.getByRole("combobox", { name: "Çapraz inceleme turu", exact: true }).selectOption("0");
    await page.getByLabel("Sorunuz", { exact: true }).fill("Sentetik destek tablosundaki sürümler nasıl ayrılır?");
    const panel = page.locator(".knowledge-panel"); await panel.locator("summary").click();
    const title = `Offline knowledge ${randomUUID()}`;
    await panel.getByLabel("Koleksiyon adı", { exact: true }).fill(title);
    const creatingCollection = page.waitForResponse((response) => response.url().endsWith("/api/knowledge") && response.request().postDataJSON().operation === "collection");
    await panel.getByRole("button", { name: "Koleksiyon oluştur", exact: true }).click();
    collectionId = (await (await creatingCollection).json()).id;
    await panel.getByRole("button", { name: "Okuma izni ver", exact: true }).click();
    const creatingConversation = page.waitForResponse((response) => response.url().endsWith("/api/knowledge") && response.request().postDataJSON().operation === "conversation");
    await panel.getByRole("button", { name: "Yeni kaynak sohbeti", exact: true }).click();
    conversationId = (await (await creatingConversation).json()).conversationId;
    await panel.getByRole("checkbox", { name: `${title} · Okuma izni açık`, exact: true }).check();
    await panel.getByLabel("Sohbet konusu", { exact: true }).fill("Sentetik destek örneği");
    await panel.getByRole("button", { name: "Seçimi kaydet", exact: true }).click();
    await panel.getByRole("combobox", { name: "Dosyaların kaydedileceği koleksiyon", exact: true }).selectOption({ label: title });
    await panel.getByLabel("Yerel kütüphaneye dosya seç", { exact: true }).setInputFiles(["docs/evaluation/knowledge-fixtures/support-table.pdf", "docs/evaluation/knowledge-fixtures/scanned-support.pdf", "docs/evaluation/knowledge-fixtures/ambiguous-support.png"]);
    await expect(panel).toContainText("support-table.pdf · Metin çıkarıldı", { timeout: 20_000 });
    await expect(panel).toContainText("missing_text_pages"); await expect(panel).toContainText("image_unverified");
    await panel.getByLabel("Arama sözcükleri", { exact: true }).fill("destek");
    const preparing = page.waitForResponse((response) => response.url().endsWith("/api/knowledge") && response.request().postDataJSON().operation === "prepare");
    await panel.getByRole("button", { name: "Kanıt paketini hazırla", exact: true }).click();
    const prepared = await preparing; expect(prepared.status()).toBe(200); expect(prepared.headers()["cache-control"]).toBe("no-store");
    const packet = await prepared.json() as KnowledgePacket;
    expect(packet.excerpts).toHaveLength(1); expect(packet.excerpts[0]!.page).toBe(1); expect(packet.coverage[0]!.unavailable).toBe(2);
    const start = page.getByRole("button", { name: "Konseyi çalıştır", exact: true }); await expect(start).toBeDisabled();
    await panel.getByRole("checkbox", { name: "Alıntıları, eksikleri ve bütün ilk tur üyelerine gönderimi inceledim", exact: true }).check();
    await expect(start).toBeEnabled();
    await expect(page.getByRole("button", { name: "Duraklatılmış zamanlama oluştur", exact: true, includeHidden: true })).toBeDisabled();
    const posted = page.waitForResponse((response) => response.url().endsWith("/api/runs") && response.request().method() === "POST"); await start.click();
    const runResponse = await posted; expect(runResponse.status()).toBe(201); const run = await runResponse.json() as RunRecord;
    runId = run.runId;
    await expect.poll(async () => (await (await request.get(`/api/runs/${run.runId}`)).json() as RunRecord).status, { timeout: 25_000 }).toBe("completed");
    expect(sent).toHaveLength(2);
    const projected = sent.map((text) => JSON.parse(text).knowledgePacket);
    expect(projected[0]).toEqual(projected[1]); expect(projected[0].excerpts).toEqual(packet.excerpts);
    expect(projected[0]).not.toHaveProperty("inventory"); expect(projected[0]).not.toHaveProperty("omissions");
    expect(sent.join(" ")).not.toContain("dataBase64"); expect(sent.join(" ")).not.toContain("scanned-support.pdf");
    const exported = await (await request.post(`/api/runs/${run.runId}/export`)).json(); expect(exported.knowledgePacket).toEqual(packet);
    const conversation = await (await request.get(`/api/runs/${run.runId}/conversation`)).json(); expect(conversation.conversationId).toBe(packet.conversationId);
    const full = await (await request.post(`/api/conversations/${packet.conversationId}/export`)).json(); expect(full.runs[0].payload.knowledgePacket).toEqual(packet);
    const markdown = await (await request.post(`/api/runs/${run.runId}/export?format=md`)).text(); expect(markdown).toContain(packet.fingerprint); expect(markdown).toContain(packet.excerpts[0]!.source.versionId);
    const originalRequest = runResponse.request().postDataJSON();
    const heldQuestion = "Bu sözleşmeyi feshetmeli miyim?";
    const heldMembers = originalRequest.members.map((member: object, index: number) => ({ ...member, councilRole: index === 1 ? "red-team" : "analyst" }));
    const heldPreviewResponse = await request.post("/api/runs/token-preview", { data: { question: heldQuestion, members: heldMembers, providerMode: "remote", retrieveToolContext: false, images: [], documents: [], memoryEntryIds: [], toolResultIds: [], reviewRounds: 1, riskProfile: "high", knowledgePacket: originalRequest.knowledgePacket } });
    expect(heldPreviewResponse.status()).toBe(200); const heldPreview = await heldPreviewResponse.json();
    const held = await request.post("/api/runs", { data: { question: heldQuestion, members: heldMembers, providerMode: "remote", reviewRounds: 1, riskProfile: "high", memoryEntryIds: [], idempotencyKey: randomUUID(), knowledgePacket: originalRequest.knowledgePacket, expectedPreflightFingerprint: heldPreview.promptPlan.fingerprint, expectedRiskFingerprint: heldPreview.riskPreflight.fingerprint } });
    expect(held.status()).toBe(202); const heldBody = await held.json(); draftId = heldBody.preflightDraft.id;
    const resumed = await request.post(`/api/preflight-drafts/${draftId}/preview`, { data: { choice: "original" } });
    expect(resumed.status()).toBe(200); const resumedBody = await resumed.json();
    expect(resumedBody.preview.promptPlan.version).toBe("council-knowledge-v1");
    expect(JSON.parse(resumedBody.preview.promptPlan.members[0].userInput).knowledgePacket.fingerprint).toBe(packet.fingerprint);
    await panel.getByRole("button", { name: "İzni iptal et", exact: true }).click();
    await expect(start).toBeDisabled();
    expect((await request.post("/api/knowledge", { data: { operation: "prepare", id: randomUUID(), conversationId: packet.conversationId, selectionRevision: packet.selectionRevision, query: "destek", allowWithoutEvidence: false } })).status()).toBe(422);
    expect(sent).toHaveLength(2);
  } finally {
    if (draftId) await getDatabase().delete(s.preflightDrafts).where(eq(s.preflightDrafts.id, draftId));
    if (runId) { await cancelDurableRun(runId); await getDatabase().delete(s.conversationRuns).where(eq(s.conversationRuns.runId, runId)); await getDatabase().delete(s.runs).where(eq(s.runs.id, runId)); }
    if (conversationId) {
      await getDatabase().delete(s.knowledgePreparations).where(eq(s.knowledgePreparations.conversationId, conversationId));
      await getDatabase().delete(s.conversationKnowledgeSelections).where(eq(s.conversationKnowledgeSelections.conversationId, conversationId));
      await getDatabase().delete(s.conversationKnowledge).where(eq(s.conversationKnowledge.conversationId, conversationId));
      await getDatabase().delete(s.conversations).where(eq(s.conversations.id, conversationId));
    }
    if (collectionId) {
      const sources = await getDatabase().select({ id: s.knowledgeSources.id }).from(s.knowledgeSources).where(eq(s.knowledgeSources.collectionId, collectionId));
      if (sources.length) { await getDatabase().delete(s.knowledgeSourceVersions).where(inArray(s.knowledgeSourceVersions.sourceId, sources.map((item) => item.id))); await getDatabase().delete(s.knowledgeSources).where(eq(s.knowledgeSources.collectionId, collectionId)); }
      await getDatabase().delete(s.knowledgeGrants).where(eq(s.knowledgeGrants.collectionId, collectionId)); await getDatabase().delete(s.knowledgeCollections).where(eq(s.knowledgeCollections.id, collectionId));
    }
    if (connectionId) await deleteProviderConnection(connectionId);
    await closeDatabase(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
