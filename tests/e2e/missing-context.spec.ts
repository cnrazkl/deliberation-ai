import { withOwner } from "@deliberation-ai/persistence";
import { revealCouncilControls } from "./workspace-navigation";
import {expect, test, testOwnerId } from "./authenticated-test";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { getDatabase, preflightDrafts, closeDatabase } from "@deliberation-ai/persistence";
import { eq } from "drizzle-orm";

test("restores a pending clarification after reload and previews both owner choices without a model call", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  const question = `Bu sözleşmeyi feshetmeli miyim? E2E ${crypto.randomUUID()}`;
  const created = await request.post("/api/runs", { data: {
    question, idempotencyKey: crypto.randomUUID(), scenario: "success", providerMode: "fake",
    riskProfile: "high", reviewRounds: 1, memoryEntryIds: [],
    members: [defaultFakeCouncilMembers[0], { ...defaultFakeCouncilMembers[1], councilRole: "red-team" }],
  } });
  expect(created.status()).toBe(202);
  const body = await created.json() as { preflightDraft: { id: string } };
  const draftId = body.preflightDraft.id;
  expect(draftId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const directPreview = await request.post(`/api/preflight-drafts/${draftId}/preview`, { data: { choice: "original" } });
  expect(directPreview.status()).toBe(200);
  try {
    await page.goto("/"); await revealCouncilControls(page);
    const panel = page.getByRole("region", { name: "Yanıt bekleyen ön değerlendirmeler" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: question }).click();
    await expect(panel).toContainText("Hangi ülke veya eyaletin hukuku geçerli?");
    await page.reload();
    await panel.getByRole("button", { name: question }).click();
    await panel.getByRole("textbox", { name: "Eksik bilgilere yanıt" }).fill("Türkiye'de, 1 Eylül 2026 tarihinde.");
    await panel.getByRole("button", { name: "Yanıt ve istem önizlemesini göster" }).click();
    await expect(panel).toContainText("Kullanıcının ek açıklaması");
    await expect(panel).toContainText("Üyelere gönderilecek metinleri incele");
    await expect(panel).toContainText("Uygulanacak profil: Yüksek risk");
    await panel.getByRole("radio", { name: "Orijinal soruyla devam et" }).check();
    await expect(panel.getByRole("button", { name: "Bu önizlemeyle konseyi çalıştır" })).toHaveCount(0);
    await panel.getByRole("button", { name: "Yanıt ve istem önizlemesini göster" }).click();
    await expect(panel).toContainText("Bu önizlemeyle konseyi çalıştır");
    await panel.getByRole("button", { name: "Taslak silmeyi incele" }).click();
    const deletion = panel.getByRole("region", { name: "Ön kontrol taslağı silme önizlemesi" });
    await deletion.getByRole("checkbox").check();
    await deletion.getByRole("button", { name: "Taslak içeriğini kalıcı olarak sil" }).click();
    await expect(panel.getByRole("button", { name: question })).toHaveCount(0);
    expect((await request.get(`/api/preflight-drafts/${draftId}`)).status()).toBe(404);
  } finally {
    await getDatabase().delete(preflightDrafts).where(eq(preflightDrafts.id, draftId));
    await closeDatabase();
  }
}));
