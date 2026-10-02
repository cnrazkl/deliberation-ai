import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { buildCouncilReport } from "@deliberation-ai/domain";
import type { CouncilMemberConfig } from "@deliberation-ai/contracts";
import { closeDatabase, getDatabase, encryptJson, encryptText, LOCAL_OWNER_ID, conversations, conversationRuns, runs,
  conversationPrivateBranches as branches, type PrivateBranchView } from "@deliberation-ai/persistence";

test("private drafts preserve the council draft, retry one committed message, fork separately and survive fixture source deletion", async ({ page, request }) => {
  const sourceId = randomUUID(); const conversationId = randomUUID(); let generationCalls = 0;
  const members: CouncilMemberConfig[] = [
    { id: "private-one", label: "Private selected member", role: "Selected perspective", provider: "fake", model: "fake-one", perspective: "risk", councilRole: "red-team", reasoningLevel: "default", webSearchMode: "off" },
    { id: "private-two", label: "Private excluded peer", role: "Other perspective", provider: "fake", model: "fake-two", perspective: "evidence", councilRole: "analyst", reasoningLevel: "default", webSearchMode: "off" },
  ];
  const report = buildCouncilReport(members.map((member, index) => ({ memberId: member.id, label: member.label, councilRole: member.councilRole,
    rawText: index === 0 ? "Selected private seed output" : "EXCLUDED PRIVATE PEER", parsed: { summary: "Synthetic private-branch fixture",
      claims: [{ statement: member.label, kind: "objection" as const, quote: member.label }] }, citations: [] })), []);
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generationCalls += 1; });
  try {
    await getDatabase().insert(runs).values({ id: sourceId, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "private-e2e-fixture", snapshotId: randomUUID(),
      question: "[encrypted]", questionCiphertext: encryptText("Private branch E2E source question", `run:${sourceId}:question`),
      membersCiphertext: encryptJson(members, `run:${sourceId}:members`), reportCiphertext: encryptJson(report, `run:${sourceId}:report`),
      status: "completed", branchIndexVersion: 1, branchKind: "independent", createdAt: sql`'2400-01-05'::timestamptz`, finishedAt: new Date() });
    await getDatabase().insert(conversations).values({ id: conversationId, ownerId: LOCAL_OWNER_ID, anchorRunId: sourceId, origin: "native", createdAt: sql`'2400-01-05'::timestamptz` });
    await getDatabase().insert(conversationRuns).values({ ownerId: LOCAL_OWNER_ID, runId: sourceId, conversationId, kind: "independent", createdAt: sql`(select created_at from runs where id = ${sourceId}::uuid)` });
    const seedUrl = `/api/runs/${sourceId}/private-branch-seed?member=private-one`;
    const preview = await request.get(seedUrl); expect(preview.status()).toBe(200); expect(preview.headers()["cache-control"]).toBe("no-store");
    const seed = await preview.json() as { sha256: string };
    const create = { action: "create", sourceRunId: sourceId, memberId: "private-one", expectedSeedSha256: seed.sha256, requestId: randomUUID() };
    expect((await request.post("/api/private-branches", { data: create, headers: { origin: "https://external.example" } })).status()).toBe(403);
    expect((await request.post("/api/private-branches", { data: { ...create, seed: "injected" } })).status()).toBe(422);
    expect((await request.post("/api/private-branches", { data: "x".repeat(65_537), headers: { "Content-Type": "application/json" } })).status()).toBe(413);
    expect((await request.get(`/api/private-branches/${randomUUID()}`)).status()).toBe(404);
    await page.goto("/");
    await page.getByLabel("Sorunuz", { exact: true }).fill("Council draft must remain unchanged");
    const card = page.locator(`[data-conversation-id="${conversationId}"]`);
    await card.getByRole("button", { name: "Konuşmayı aç", exact: true }).click();
    const model = page.locator("details.member-card").filter({ has: page.locator("summary").filter({ hasText: "Private selected member" }) });
    await model.locator("summary").click();
    await model.getByRole("button", { name: "Bu yanıtla özel dal taslağı aç" }).click();
    const sourcePreview = page.getByRole("region", { name: "Özel dal kaynak önizlemesi" });
    await expect(sourcePreview).toContainText("Önceki konuşma bağlamı");
    await sourcePreview.getByRole("button", { name: "Vazgeç", exact: true }).click();
    expect(await getDatabase().select().from(branches).where(eq(branches.conversationId, conversationId))).toHaveLength(0);
    await model.getByRole("button", { name: "Bu yanıtla özel dal taslağı aç" }).click();
    await expect(sourcePreview).toBeVisible();
    await getDatabase().update(runs).set({ stateVersion: 2 }).where(eq(runs.id, sourceId));
    await sourcePreview.getByRole("button", { name: "Özel dalı kaydet" }).click();
    await expect(model.getByRole("alert")).toContainText("Kaynak veya dal değişti");
    await model.getByRole("button", { name: "Bu yanıtla özel dal taslağı aç" }).click();
    await sourcePreview.getByRole("button", { name: "Özel dalı kaydet" }).click();
    let panel = page.getByRole("region", { name: "Özel dal taslakları", exact: true });
    await expect(panel).toContainText("Taslaklar modele gönderilmez");
    await expect(panel.getByRole("button", { name: "Taslağı dala kaydet" })).toBeDisabled();
    const [root] = await getDatabase().select().from(branches).where(eq(branches.conversationId, conversationId));
    const draftInput = panel.getByLabel("Özel mesaj taslağı");
    let loseReply = true;
    await page.route("**/api/private-branches/*/messages", async (route) => {
      if (loseReply) { loseReply = false; await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await draftInput.fill("Only one copy despite a lost committed response");
    await panel.getByRole("button", { name: "Taslağı dala kaydet" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await panel.getByRole("button", { name: "Taslağı dala kaydet" }).click();
    await expect(draftInput).toHaveValue("");
    expect((await request.get(`/api/private-branches/${root!.id}`)).status()).toBe(200);
    let rootView = await (await request.get(`/api/private-branches/${root!.id}`)).json() as PrivateBranchView;
    expect(rootView.body.messages).toHaveLength(1);
    const stale = { requestId: randomUUID(), expectedRevision: 1, text: "stale writer" };
    expect((await request.post(`/api/private-branches/${root!.id}/messages`, { data: stale })).status()).toBe(409);
    expect((await request.post(`/api/private-branches/${root!.id}/messages`, { data: { ...stale, expectedRevision: 2, kind: "assistant" } })).status()).toBe(422);
    expect((await request.post(`/api/private-branches/${root!.id}/messages`, { data: { ...stale, expectedRevision: 2 }, headers: { origin: "https://external.example" } })).status()).toBe(403);
    // Another view commits while this UI still shows revision 2.
    expect((await request.post(`/api/private-branches/${root!.id}/messages`, { data: { requestId: randomUUID(), expectedRevision: 2, text: "Second view message" } })).status()).toBe(200);
    await draftInput.fill("Preserve this text after conflict");
    await panel.getByRole("button", { name: "Taslağı dala kaydet" }).click();
    await expect(panel.getByRole("alert")).toContainText("Kaynak veya dal değişti");
    await expect(draftInput).toHaveValue("Preserve this text after conflict");
    await panel.getByRole("button", { name: "Dalları yenile" }).click();
    await panel.getByRole("button", { name: "Taslağı dala kaydet" }).click();
    await expect(draftInput).toHaveValue("");
    await draftInput.fill("Unsaved text follows the new branch");
    await panel.getByRole("button", { name: "Bu noktadan yeni özel dal aç" }).click();
    await expect(draftInput).toHaveValue("Unsaved text follows the new branch");
    await expect(panel).toContainText("3 taslağı kopyalandı");
    await panel.getByRole("button", { name: "Taslağı dala kaydet" }).click();
    await expect(draftInput).toHaveValue("");
    const all = await getDatabase().select().from(branches).where(eq(branches.conversationId, conversationId));
    const child = all.find((item) => item.parentBranchId === root!.id)!;
    rootView = await (await request.get(`/api/private-branches/${root!.id}`)).json() as PrivateBranchView;
    expect(rootView.messageCount).toBe(3);
    const childView = await (await request.get(`/api/private-branches/${child.id}`)).json() as PrivateBranchView;
    expect(childView.messageCount).toBe(4); expect(JSON.stringify(childView)).not.toContain("EXCLUDED PRIVATE PEER");
    await getDatabase().delete(runs).where(eq(runs.id, sourceId));
    await page.reload();
    await card.getByRole("button", { name: "Özel dal taslaklarını göster" }).click();
    panel = page.getByRole("region", { name: "Özel dal taslakları", exact: true });
    await panel.locator(`[data-private-branch-id="${child.id}"]`).getByRole("button", { name: "Özel dalı aç" }).click();
    await expect(panel).toContainText("Unsaved text follows the new branch");
    const downloadEvent = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Özel dalı indir (JSON)" }).click();
    const stream = await (await downloadEvent).createReadStream(); const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { branch: PrivateBranchView };
    expect(exported.branch.body.seed.rawText).toBe("Selected private seed output"); expect(exported.branch.messageCount).toBe(4);
    const conversationExport = await request.post(`/api/conversations/${conversationId}/export`);
    expect(conversationExport.status()).toBe(200); expect((await conversationExport.json() as { privateBranches: unknown[] }).privateBranches).toHaveLength(2);
    await card.getByRole("button", { name: "Kayıt silmeyi incele" }).click();
    await expect(page.getByRole("region", { name: "Konuşma kaydını silme önizlemesi" })).toContainText("saklanan özel dal taslakları");
    expect((await request.post(`/api/private-branches/${child.id}/export`, { headers: { origin: "https://external.example" } })).status()).toBe(403);
    expect(generationCalls).toBe(0);
  } finally {
    await getDatabase().delete(branches).where(eq(branches.conversationId, conversationId));
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.conversationId, conversationId));
    await getDatabase().delete(conversations).where(eq(conversations.id, conversationId));
    await getDatabase().delete(runs).where(eq(runs.id, sourceId));
    await closeDatabase();
  }
});
