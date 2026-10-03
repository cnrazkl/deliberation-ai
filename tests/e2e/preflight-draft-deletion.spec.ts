import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createRunRequestSchema, defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { createAwaitingPreflightDraft, getDatabase, preflightDrafts, closeDatabase } from "@deliberation-ai/persistence";

test("reviews draft deletion, preserves unsaved inputs on cancel, rejects stale state and recovers a lost committed response", async ({ page, request }) => {
  const input = createRunRequestSchema.parse({ idempotencyKey: randomUUID(), question: "Bu sözleşmeyi feshetmeli miyim?",
    providerMode: "fake", riskProfile: "high", reviewRounds: 1,
    members: [defaultFakeCouncilMembers[0]!, { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" }] });
  const draft = await createAwaitingPreflightDraft(input); let generations = 0;
  page.on("request", (value) => { if (value.method() === "POST" && /\/api\/(runs|preflight-drafts\/[^/]+\/start)$/.test(new URL(value.url()).pathname)) generations++; });
  try {
    await page.route("**/api/preflight-drafts", (route) => route.fulfill({ json: { drafts: [draft] } }));
    await page.goto("/");
    const question = page.getByRole("textbox", { name: "Sorunuz", exact: true });
    await question.fill("Keep this unrelated owner question unchanged");
    const pending = page.getByRole("region", { name: "Yanıt bekleyen ön değerlendirmeler" });
    await pending.getByRole("button", { name: new RegExp(draft.id.slice(0, 8)) }).click();
    await pending.getByLabel("Eksik bilgilere yanıt").fill("Keep this unsaved clarification on cancel");
    await pending.getByRole("button", { name: "Taslak silmeyi incele" }).click();
    const review = pending.getByRole("region", { name: "Ön kontrol taslağı silme önizlemesi" });
    const confirm = review.getByRole("button", { name: "Taslak içeriğini kalıcı olarak sil" });
    await expect(confirm).toBeDisabled();
    await expect(review).toContainText("yedekler");
    await review.getByRole("button", { name: "Silme incelemesini kapat" }).click();
    await expect(pending.getByLabel("Eksik bilgilere yanıt")).toHaveValue("Keep this unsaved clarification on cancel");
    expect((await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, draft.id)))[0]!.requestCiphertext).not.toBeNull();
    await pending.getByRole("button", { name: "Taslak silmeyi incele" }).click();
    const preview = await request.get(`/api/preflight-drafts/${draft.id}/deletion`);
    expect(preview.headers()["cache-control"]).toBe("no-store");
    const oldReview = await preview.json();
    const confirmation = { draftId: draft.id, fingerprint: oldReview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedRecords: true };
    expect((await request.post(`/api/preflight-drafts/${draft.id}/deletion`, { data: confirmation, headers: { origin: "https://foreign.example" } })).status()).toBe(403);
    expect((await request.post(`/api/preflight-drafts/${draft.id}/deletion`, { data: { ...confirmation, draftId: randomUUID() } })).status()).toBe(422);
    expect((await request.post(`/api/preflight-drafts/${draft.id}/deletion`, { data: { draftId: draft.id, fingerprint: oldReview.fingerprint } })).status()).toBe(422);
    expect((await request.post(`/api/preflight-drafts/${draft.id}/deletion`, { data: { ...confirmation, unregistered: "x".repeat(4_096) } })).status()).toBe(413);
    expect((await request.delete(`/api/preflight-drafts/${draft.id}`)).status()).toBe(409);
    await expect(confirm).toBeVisible();
    await getDatabase().execute(sql`update preflight_drafts set updated_at=updated_at+interval '1 second' where id=${draft.id}::uuid`);
    await review.getByRole("checkbox").check(); await confirm.click();
    await expect(review.getByRole("alert")).toContainText("Taslak değişti");
    await review.getByRole("button", { name: "Silme önizlemesini yenile" }).click();
    await expect(confirm).toBeDisabled();
    const currentReview = await (await request.get(`/api/preflight-drafts/${draft.id}/deletion`)).json();
    await page.route(`**/api/preflight-drafts/${draft.id}/deletion`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort();
    });
    await review.getByRole("checkbox").check(); await confirm.click();
    await expect(review.getByRole("alert")).toBeVisible();
    await review.getByRole("button", { name: "Silme önizlemesini yenile" }).click();
    await expect(pending).toHaveCount(0);
    await expect(question).toHaveValue("Keep this unrelated owner question unchanged");
    const replay = await request.post(`/api/preflight-drafts/${draft.id}/deletion`, { data: { ...confirmation, fingerprint: currentReview.fingerprint } });
    expect(replay.ok()).toBe(true); expect((await replay.json()).receipt.draftId).toBe(draft.id);
    expect((await request.post("/api/runs", { data: input })).status()).toBe(409);
    expect((await request.get(`/api/preflight-drafts/${draft.id}`)).status()).toBe(404);
    expect(generations).toBe(0);
  } finally {
    await getDatabase().delete(preflightDrafts).where(eq(preflightDrafts.id, draft.id)); await closeDatabase();
  }
});
