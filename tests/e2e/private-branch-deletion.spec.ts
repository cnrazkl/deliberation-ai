import { withOwner } from "@deliberation-ai/persistence";
import { revealConversationOptions } from "./workspace-navigation";
import { randomUUID } from "node:crypto";
import {test, expect, testOwnerId } from "./authenticated-test";
import { eq, sql } from "drizzle-orm";
import type { PrivateBranchBody } from "@deliberation-ai/contracts";
import { renderPrivateDelivery } from "@deliberation-ai/domain";
import { getDatabase, closeDatabase, encryptJson, conversations,
  conversationPrivateBranches as branches, privateBranchDeletions } from "@deliberation-ai/persistence";

test("reviews leaf-first private deletion, keeps usage/drafts, rejects stale confirmation and replays a lost committed response", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  const conversationId = randomUUID(); const rootId = randomUUID(); const sourceId = randomUUID(); let generations = 0;
  const body: PrivateBranchBody = { version: "private-branch-drafts-v1", forkedFrom: null, deliveryVersion: 1,
    seed: { version: "selected-member-private-seed-v1", conversationId, sourceRunId: sourceId, sourceStateVersion: 1,
      sourceRiskProfile: "standard", sourcePromptVersion: "offline-fixture", sourcePromptFingerprint: null, reusedFromRunId: null,
      question: "Private deletion fixture question", rawText: "Private deletion fixture source reply",
      member: { id: "private-delete", label: "Deletion fixture", role: "Independent viewpoint", provider: "fake", model: "fake-one",
        perspective: "risk", councilRole: "analyst", reasoningLevel: "default", webSearchMode: "off" } },
    messages: [{ id: randomUUID(), kind: "owner-draft", text: "Private saved owner message", createdAt: new Date().toISOString(), originBranchId: rootId, acceptedRevision: 2 }] };
  body.deliveries = [{ id: randomUUID(), originBranchId: rootId, messageId: body.messages[0]!.id, fingerprint: "a".repeat(64),
    connectionId: randomUUID(), connectionFingerprint: "b".repeat(64), request: renderPrivateDelivery(body), status: "succeeded", errorCode: null,
    createdAt: new Date().toISOString(), submittedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    result: { text: "Private generated reply to erase", model: "offline-model", remoteResponseId: "offline-receipt", inputTokens: 21, outputTokens: 7, tokenDetails: null, finishReason: "stop" },
    usage: { model: "offline-model", remoteResponseId: "offline-receipt", inputTokens: 21, outputTokens: 7, tokenDetails: null } }];
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generations++; });
  try {
    await getDatabase().insert(conversations).values({ id: conversationId, ownerId: testOwnerId(), anchorRunId: sourceId, origin: "native", createdAt: sql`'2400-01-06'::timestamptz` });
    await getDatabase().insert(branches).values({ id: rootId, ownerId: testOwnerId(), conversationId, sourceRunId: sourceId, sourceMemberId: "private-delete",
      revision: 2, messageCount: 1, requestId: randomUUID(), requestHash: "private-delete-fixture", bodyCiphertext: encryptJson(body, `private-branch:${rootId}:body`) });
    const childResponse = await request.post("/api/private-branches", { data: { action: "fork", parentBranchId: rootId, expectedRevision: 2, expectedDeliveryVersion: 1, requestId: randomUUID() } });
    expect(childResponse.status()).toBe(200); const child = await childResponse.json() as { id: string };
    const endpoint = `/api/private-branches/${rootId}/deletion`;
    expect((await request.get(endpoint)).headers()["cache-control"]).toBe("no-store");
    const confirmation = { branchId: rootId, fingerprint: "a".repeat(64), confirmContentDeletion: true, acknowledgeRetainedMetadata: true };
    expect((await request.post(endpoint, { data: confirmation, headers: { origin: "https://external.example" } })).status()).toBe(403);
    expect((await request.post(endpoint, { data: { ...confirmation, branchId: child.id } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { ...confirmation, confirmContentDeletion: false } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { ...confirmation, injected: "content" } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: "x".repeat(4_097), headers: { "Content-Type": "application/json" } })).status()).toBe(413);
    expect((await request.post(endpoint, { data: confirmation })).status()).toBe(409);
    await page.goto("/");
    const card = page.locator(`[data-conversation-id="${conversationId}"]`);
    await revealConversationOptions(page);
    await expect(card.getByRole("button", { name: "Özel dal taslaklarını göster" })).toBeVisible();
    await page.getByLabel("Sorunuz", { exact: true }).fill("Council draft preserved during private deletion");
    await revealConversationOptions(page);
    await card.getByRole("button", { name: "Özel dal taslaklarını göster" }).click();
    const panel = page.getByRole("region", { name: "Özel dal taslakları", exact: true });
    const open = async (id: string) => {
      await panel.locator(`[data-private-branch-id="${id}"]`).getByRole("button").click();
      await expect(panel.getByText(`Dal: ${id} · Kaynak çalışma: ${sourceId}`, { exact: true })).toBeVisible();
    };
    await open(rootId); await panel.getByRole("textbox", { name: "Özel mesaj taslağı", exact: true }).fill("Unsaved root draft");
    await panel.getByRole("button", { name: "Dal içeriğini silmeyi incele" }).click();
    const preview = panel.getByRole("region", { name: "Özel dal silme önizlemesi" });
    await expect(preview).toContainText("Bu daldan kopyalanmış dallar var");
    await expect(preview).toContainText(child.id);
    await expect(preview.getByRole("button", { name: "Özel dal içeriğini kalıcı olarak sil" })).toHaveCount(0);
    await preview.getByRole("button", { name: "Silmeden vazgeç" }).click();
    await expect(panel.getByRole("textbox", { name: "Özel mesaj taslağı", exact: true })).toHaveValue("Unsaved root draft");
    await open(child.id); await panel.getByRole("textbox", { name: "Özel mesaj taslağı", exact: true }).fill("Unsaved child draft");
    await panel.getByRole("button", { name: "Dal içeriğini silmeyi incele" }).click();
    await expect(preview).toContainText("kullanım sayaçları");
    await expect(preview.getByRole("button", { name: "Özel dal içeriğini kalıcı olarak sil" })).toBeDisabled();
    await preview.getByRole("checkbox").check(); await preview.getByRole("button", { name: "Özel dal içeriğini kalıcı olarak sil" }).click();
    await expect(panel.locator(`[data-private-branch-id="${child.id}"]`)).toHaveCount(0);
    await expect(panel.getByLabel("Silinen dalın kaydedilmemiş taslağı")).toHaveValue("Unsaved child draft");
    await open(rootId); await expect(panel.getByRole("textbox", { name: "Özel mesaj taslağı", exact: true })).toHaveValue("Unsaved root draft");
    await panel.getByRole("button", { name: "Dal içeriğini silmeyi incele" }).click();
    await preview.getByRole("checkbox").check();
    expect((await request.post(`/api/private-branches/${rootId}/messages`, { data: { requestId: randomUUID(), expectedRevision: 2, text: "Concurrent saved owner draft" } })).status()).toBe(200);
    await preview.getByRole("button", { name: "Özel dal içeriğini kalıcı olarak sil" }).click();
    await expect(preview.getByRole("alert")).toContainText("Dal değişti");
    expect((await request.get(`/api/private-branches/${rootId}`)).status()).toBe(200);
    await preview.getByRole("button", { name: "Silme önizlemesini yenile" }).click();
    await expect(preview).toContainText("2 kaydedilmiş mesajın");
    let loseResponse = true;
    await page.route(`**${endpoint}`, async (route) => {
      if (route.request().method() === "POST" && loseResponse) { loseResponse = false; await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await preview.getByRole("checkbox").check(); await preview.getByRole("button", { name: "Özel dal içeriğini kalıcı olarak sil" }).click();
    await expect(preview.getByRole("alert")).toBeVisible();
    await preview.getByRole("button", { name: "Özel dal içeriğini kalıcı olarak sil" }).click();
    await expect(panel).toContainText("Henüz özel dal yok");
    const auditResponse = await request.get(`/api/private-branches/${rootId}/deletion-receipt`);
    expect(auditResponse.status()).toBe(200); const audit = await auditResponse.json();
    expect(audit.receipts[0]).toMatchObject({ originBranchId: rootId, usage: { inputTokens: 21, outputTokens: 7 } });
    expect(JSON.stringify(audit)).not.toMatch(/Private generated reply|Private saved owner|Private deletion fixture|Concurrent saved owner|Unsaved/);
    expect((await request.get(`/api/private-branches/${rootId}`)).status()).toBe(404);
    expect((await request.post(`/api/private-branches/${rootId}/export`)).status()).toBe(404);
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Council draft preserved during private deletion");
    expect(generations).toBe(0);
  } finally {
    await getDatabase().delete(branches).where(eq(branches.conversationId, conversationId));
    await getDatabase().delete(privateBranchDeletions).where(eq(privateBranchDeletions.conversationId, conversationId));
    await getDatabase().delete(conversations).where(eq(conversations.id, conversationId));
    await closeDatabase();
  }
}));
