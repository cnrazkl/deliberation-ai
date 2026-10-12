import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { closeDatabase, getDatabase, withOwner, encryptJson, encryptText, runs, conversations, conversationRuns, providerOperations, runDeletions } from "@deliberation-ai/persistence";
import { expect, test, testOwnerId } from "./authenticated-test";
import { workspaceView } from "./workspace-navigation";
import { deleteGeneratedConnection } from "./connection-cleanup";

test("compact council cards edit and warn on selected deletion; creation stays below configuration", async ({ page, request }) => {
  const connection = await (await request.post("/api/provider-connections", { data: { provider: "openai-compatible", label: `Library ${randomUUID()}`, apiKey: "", endpointPreset: "ollama", baseUrl: "http://127.0.0.1:1/v1", selectedModels: ["offline-model"], reasoningProtocol: "none", structuredOutputMode: "json-object" } })).json();
  const members = defaultFakeCouncilMembers.map(member => ({ ...member, provider: "openai-compatible", model: "offline-model", connectionId: connection.id }));
  const template = await (await request.post("/api/council-templates", { data: { requestId: randomUUID(), name: `Compact ${randomUUID()}`, members, settings: { reviewRounds: 0, selfRevisionEnabled: false } } })).json();
  try {
    await page.goto("/"); await page.getByRole("region", { name: "Konsey Havuzu", exact: true }).getByLabel("Kayıtlı Konsey").selectOption(template.id);
    await workspaceView(page, "Konseyler");
    const card = page.locator(`[data-template-id="${template.id}"]`); await expect(card).toContainText("Sohbette Seçili");
    await expect(page.locator(".template-list")).toHaveCount(0);
    await card.getByRole("button", { name: `${template.name} konseyini düzenle`, exact: true }).click();
    const editor = page.getByRole("region", { name: "Konsey kaydı", exact: true });
    await expect(editor.getByLabel("Şablon adı")).toHaveValue(template.name);
    expect((await editor.boundingBox())!.y).toBeGreaterThan((await page.locator(".member-editor-grid").boundingBox())!.y);
    await editor.getByLabel("Şablon adı").fill(`${template.name} edited`); await editor.getByRole("button", { name: "Değişiklikleri Kaydet", exact: true }).click();
    await expect(editor.getByRole("status")).toContainText("kaydedildi");
    await card.getByRole("button", { name: `${template.name} edited konseyini sil`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Konsey Şablonunu Sil" }); await expect(dialog).toContainText("şu anda sohbette seçili");
    await dialog.getByRole("button", { name: "Silme incelemesini kapat" }).click(); await expect(card).toBeVisible();
    await card.getByRole("button", { name: `${template.name} edited konseyini sil`, exact: true }).click();
    await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Sil", exact: true }).click(); await expect(card).toHaveCount(0);
  } finally { const preview = await (await request.get(`/api/council-templates/${template.id}/deletion`)).json(); if (!preview.alreadyDeleted) await request.post(`/api/council-templates/${template.id}/deletion`, { data: { templateId: template.id, fingerprint: preview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedCopies: true } }); await deleteGeneratedConnection(request, `/api/provider-connections?id=${connection.id}`); }
});

for (const pending of [false, true]) test(`conversation deletion ${pending ? "shows and resolves a real unknown call" : "ignores consumed retry permissions"} without another API generation`, async ({ page, request }) => withOwner(testOwnerId(), async () => {
  const runId = randomUUID(), conversationId = randomUUID(), operationId = randomUUID(); let generation = 0;
  page.on("request", value => { if (value.method() === "POST" && /\/api\/runs$/.test(new URL(value.url()).pathname)) generation++; });
  try {
    await getDatabase().insert(runs).values({ id: runId, ownerId: testOwnerId(), idempotencyKey: randomUUID(), requestHash: "refinement", snapshotId: randomUUID(), question: "[encrypted]", questionCiphertext: encryptText("Generated retry cleanup fixture", `run:${runId}:question`), membersCiphertext: encryptJson(defaultFakeCouncilMembers, `run:${runId}:members`), status: "failed", branchIndexVersion: 1, branchKind: "independent" });
    await getDatabase().insert(conversations).values({ id: conversationId, ownerId: testOwnerId(), anchorRunId: runId, origin: "native" });
    await getDatabase().insert(conversationRuns).values({ ownerId: testOwnerId(), conversationId, runId, kind: "independent", createdAt: new Date() });
    await getDatabase().insert(providerOperations).values([
      { id: operationId, runId, memberId: "member-a", provider: "fake", model: "offline-debug-model", status: pending ? "outcome_unknown" : "retry_authorized", attempt: 1, requestFingerprint: "fixture", errorCode: "remote_outcome_unknown" },
      { id: randomUUID(), runId, memberId: "member-a", provider: "fake", model: "offline-debug-model", status: "discarded", attempt: 2, requestFingerprint: "fixture" },
    ]);
    await page.goto("/"); const history = page.locator(`.run-history-list [data-run-id="${runId}"]`); await expect(history).toBeVisible();
    await expect(history.locator("small")).toHaveCount(0); await history.getByRole("button", { name: "Çalışmayı aç", exact: true }).click(); await expect(page.locator("#council-result")).toBeVisible();
    await history.getByRole("button", { name: "Çalışmayı Sil", exact: true }).click(); await expect(page.locator(".sidebar-history [aria-label='Çalışma içeriği silme önizlemesi']")).toHaveCount(0);
    await page.getByRole("dialog", { name: "Çalışmayı Sil" }).getByRole("button", { name: "Silmeden vazgeç" }).click();
    const card = page.locator(`[data-conversation-id="${conversationId}"]`); await expect(card.locator(".conversation-options")).toHaveCount(0); await expect(card.getByRole("button", { name: "Özel dal taslaklarını göster", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Konuşmayı Sil", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Konuşmayı Sil", exact: true });
    if (pending) { await expect(dialog).toContainText("offline-debug-model"); await expect(dialog).toContainText("remote_outcome_unknown"); await expect(dialog.getByRole("button", { name: "Evet, Konuşmayı Sil", exact: true })).toBeDisabled(); await dialog.getByRole("button", { name: "İşlemi Kapat", exact: true }).click(); }
    await expect(dialog.getByRole("button", { name: "Evet, Konuşmayı Sil", exact: true })).toBeEnabled(); await dialog.getByRole("button", { name: "Evet, Konuşmayı Sil", exact: true }).click();
    await expect(card).toHaveCount(0); expect((await request.get(`/api/runs/${runId}`)).status()).toBe(404); expect(generation).toBe(0);
  } finally { await getDatabase().delete(runDeletions).where(eq(runDeletions.id, runId)); await getDatabase().delete(conversationRuns).where(eq(conversationRuns.conversationId, conversationId)); await getDatabase().delete(conversations).where(eq(conversations.id, conversationId)); await getDatabase().delete(runs).where(inArray(runs.id, [runId])); await closeDatabase(); }
}));
