import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, inArray, sql } from "drizzle-orm";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { closeDatabase, getDatabase, encryptJson, encryptText, LOCAL_OWNER_ID, runs, conversations,
  conversationRuns, conversationPrivateBranches, privateBranchDeletions, runDeletions, loadRunContinuation } from "@deliberation-ai/persistence";

test("deletes a populated conversation through separate private, leaf-run and metadata reviews while preserving the draft", async ({ page, request }) => {
  const source = randomUUID(); const child = randomUUID(); const conversationId = randomUUID(); const neighbor = randomUUID();
  const report = buildCouncilReport(defaultFakeCouncilMembers.map((member) => ({ memberId: member.id, label: member.label,
    councilRole: member.councilRole, rawText: "Generated cleanup response", parsed: { summary: "Generated cleanup report",
      claims: [{ statement: "Generated cleanup claim", quote: "Generated cleanup claim", kind: "objection" as const }] }, citations: [] })), []);
  let generations = 0;
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generations++; });
  try {
    for (const [index, id] of [source, child].entries()) {
      const context = index ? await loadRunContinuation(source) : undefined;
      await getDatabase().insert(runs).values({ id, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "cleanup-fixture",
        snapshotId: randomUUID(), question: "[encrypted]", questionCiphertext: encryptText("Generated conversation cleanup fixture", `run:${id}:question`),
        reportCiphertext: encryptJson(report, `run:${id}:report`), membersCiphertext: encryptJson(defaultFakeCouncilMembers, `run:${id}:members`),
        continuationContextCiphertext: context ? encryptJson(context, `run:${id}:continuation-context`) : null,
        status: "completed", branchIndexVersion: 1, branchKind: index ? "continuation-full" : "independent",
        branchSourceRunId: index ? source : null, createdAt: sql`'2400-02-01'::timestamptz`, finishedAt: new Date() });
    }
    await getDatabase().insert(conversations).values([
      { id: conversationId, ownerId: LOCAL_OWNER_ID, anchorRunId: source, origin: "native", createdAt: sql`'2400-02-02'::timestamptz` },
      { id: neighbor, ownerId: LOCAL_OWNER_ID, anchorRunId: randomUUID(), origin: "native", createdAt: sql`'2400-02-01'::timestamptz` },
    ]);
    await getDatabase().insert(conversationRuns).values([
      { ownerId: LOCAL_OWNER_ID, conversationId, runId: source, kind: "independent", createdAt: sql`'2400-02-01'::timestamptz` },
      { ownerId: LOCAL_OWNER_ID, conversationId, runId: child, kind: "continuation-full", sourceRunId: source, createdAt: sql`'2400-02-01'::timestamptz` },
    ]);
    const seedResponse = await request.get(`/api/runs/${source}/private-branch-seed?member=${defaultFakeCouncilMembers[0]!.id}`);
    expect(seedResponse.status()).toBe(200);
    const seed = await seedResponse.json();
    const created = await request.post("/api/private-branches", { data: { action: "create", sourceRunId: source,
      memberId: defaultFakeCouncilMembers[0]!.id, expectedSeedSha256: seed.sha256, requestId: randomUUID() } });
    expect(created.status()).toBe(200);
    const branch = await created.json();
    expect((await request.get(`/api/runs/${child}/conversation`)).status()).toBe(200);
    await page.goto("/");
    const library = page.getByRole("region", { name: "Kayıtlı konuşmalar", exact: true });
    const card = library.locator(`[data-conversation-id="${conversationId}"]`);
    // The delete entry must be visible without expanding other operations.
    await expect(card.getByRole("button", { name: "Konuşmayı silmeyi incele", exact: true })).toBeVisible();
    await page.getByLabel("Sorunuz", { exact: true }).fill("Draft preserved throughout conversation cleanup");
    await card.getByRole("button", { name: "Konuşmayı aç", exact: true }).click();
    await expect(page.locator("#council-result")).toBeVisible();
    await card.getByRole("button", { name: "Konuşmayı silmeyi incele", exact: true }).click();
    const panel = page.getByRole("region", { name: "Konuşma kaydını silme önizlemesi", exact: true });
    await expect(panel).toBeFocused();
    await expect(panel.getByRole("button", { name: "Konuşma kaydını kalıcı olarak sil" })).toHaveCount(0);
    const runReview = panel.getByRole("region", { name: "Çalışma içeriği silme önizlemesi", exact: true });
    await panel.locator(`[data-run-id="${source}"]`).getByRole("button", { name: "Çalışma silmeyi incele" }).click();
    await expect(runReview).toContainText("kopyaları var");
    await expect(runReview.getByRole("button", { name: "Çalışma içeriğini kalıcı olarak sil" })).toHaveCount(0);
    await runReview.getByRole("button", { name: "Silmeden vazgeç" }).click();
    await panel.locator(`[data-private-branch-id="${branch.id}"]`).getByRole("button", { name: "Özel dal silmeyi incele" }).click();
    const privateReview = panel.getByRole("region", { name: "Özel dal silme önizlemesi", exact: true });
    await privateReview.getByRole("checkbox").check();
    await privateReview.getByRole("button", { name: "Özel dal içeriğini kalıcı olarak sil" }).click();
    await expect(panel.locator(`[data-private-branch-id="${branch.id}"]`)).toHaveCount(0);
    for (const id of [child, source]) {
      await panel.locator(`[data-run-id="${id}"]`).getByRole("button", { name: "Çalışma silmeyi incele" }).click();
      await expect(runReview.getByRole("button", { name: "Çalışma içeriğini kalıcı olarak sil" })).toBeDisabled();
      await runReview.getByRole("checkbox").check();
      await runReview.getByRole("button", { name: "Çalışma içeriğini kalıcı olarak sil" }).click();
      await expect(panel.locator(`[data-run-id="${id}"]`)).toHaveCount(0);
      expect((await request.get(`/api/runs/${id}`)).status()).toBe(404);
    }
    await expect(page.locator("#council-result")).toHaveCount(0);
    await expect(panel).toContainText("1 konuşma kaydı ve 2 üyelik bağlantısı");
    await expect(panel.getByRole("button", { name: "Konuşma kaydını kalıcı olarak sil" })).toBeDisabled();
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Konuşma kaydını kalıcı olarak sil" }).click();
    await expect(panel).toHaveCount(0); await expect(card).toHaveCount(0);
    expect((await request.get(`/api/conversations/${conversationId}/deletion`)).status()).toBe(404);
    expect((await request.get(`/api/conversations/${neighbor}/deletion`)).status()).toBe(200);
    expect((await getDatabase().select().from(runDeletions).where(eq(runDeletions.conversationId, conversationId)))).toHaveLength(2);
    expect((await getDatabase().select().from(privateBranchDeletions).where(eq(privateBranchDeletions.conversationId, conversationId)))).toHaveLength(1);
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Draft preserved throughout conversation cleanup");
    expect(generations).toBe(0);
  } finally {
    await getDatabase().delete(conversationPrivateBranches).where(eq(conversationPrivateBranches.conversationId, conversationId));
    await getDatabase().delete(privateBranchDeletions).where(eq(privateBranchDeletions.conversationId, conversationId));
    await getDatabase().delete(runDeletions).where(eq(runDeletions.conversationId, conversationId));
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.conversationId, conversationId));
    await getDatabase().delete(conversations).where(inArray(conversations.id, [conversationId, neighbor]));
    await getDatabase().delete(runs).where(inArray(runs.id, [source, child]));
    await closeDatabase();
  }
});
