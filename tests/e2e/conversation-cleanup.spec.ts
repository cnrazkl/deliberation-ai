import { withOwner } from "@deliberation-ai/persistence";
import { randomUUID } from "node:crypto";
import { expect, test, testOwnerId } from "./authenticated-test";
import { eq, inArray, sql } from "drizzle-orm";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { closeDatabase, getDatabase, encryptJson, encryptText, runs, conversations,
  conversationRuns, conversationPrivateBranches, privateBranchDeletions, runDeletions, loadRunContinuation } from "@deliberation-ai/persistence";

test("deletes a populated conversation with one confirmation while preserving the draft and neighbor", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  const source = randomUUID(); const child = randomUUID(); const external = randomUUID(); const conversationId = randomUUID(); const neighbor = randomUUID();
  const report = buildCouncilReport(defaultFakeCouncilMembers.map((member) => ({ memberId: member.id, label: member.label,
    councilRole: member.councilRole, rawText: "Generated cleanup response", parsed: { summary: "Generated cleanup report",
      claims: [{ statement: "Generated cleanup claim", quote: "Generated cleanup claim", kind: "objection" as const }] }, citations: [] })), []);
  let generations = 0;
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generations++; });
  try {
    for (const [index, id] of [source, child, external].entries()) {
      const context = index === 1 ? await loadRunContinuation(source) : undefined;
      await getDatabase().insert(runs).values({ id, ownerId: testOwnerId(), idempotencyKey: randomUUID(), requestHash: "cleanup-fixture",
        snapshotId: randomUUID(), question: "[encrypted]", questionCiphertext: encryptText("Generated conversation cleanup fixture", `run:${id}:question`),
        reportCiphertext: encryptJson(report, `run:${id}:report`), membersCiphertext: encryptJson(defaultFakeCouncilMembers, `run:${id}:members`),
        continuationContextCiphertext: context ? encryptJson(context, `run:${id}:continuation-context`) : null,
        memoryContextCiphertext: index === 2 ? encryptJson([{ sourceRunId: source, content: "Generated independent copied memory" }], `run:${id}:memory-context`) : null,
        status: "completed", branchIndexVersion: 1, branchKind: index === 1 ? "continuation-full" : "independent",
        branchSourceRunId: index === 1 ? source : null, createdAt: sql`'2400-02-01'::timestamptz`, finishedAt: new Date() });
    }
    await getDatabase().insert(conversations).values([
      { id: conversationId, ownerId: testOwnerId(), anchorRunId: source, origin: "native", createdAt: sql`'2400-02-02'::timestamptz` },
      { id: neighbor, ownerId: testOwnerId(), anchorRunId: external, origin: "native", createdAt: sql`'2400-02-01'::timestamptz` },
    ]);
    await getDatabase().insert(conversationRuns).values([
      { ownerId: testOwnerId(), conversationId, runId: source, kind: "independent", createdAt: sql`'2400-02-01'::timestamptz` },
      { ownerId: testOwnerId(), conversationId, runId: child, kind: "continuation-full", sourceRunId: source, createdAt: sql`'2400-02-01'::timestamptz` },
      { ownerId: testOwnerId(), conversationId: neighbor, runId: external, kind: "independent", createdAt: sql`'2400-02-01'::timestamptz` },
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
    const library = page.getByRole("region", { name: "Kayıtlı müzakereler", exact: true });
    const card = library.locator(`[data-conversation-id="${conversationId}"]`);
    // The delete entry must be visible without expanding other operations.
    await expect(card.getByRole("button", { name: "Müzakereyi Sil", exact: true })).toBeVisible();
    await page.getByLabel("Sorunuz", { exact: true }).fill("Draft preserved throughout conversation cleanup");
    await card.getByRole("button", { name: "Müzakereyi aç", exact: true }).click();
    await expect(page.locator("#council-result")).toBeVisible();
    // Sidebar controls stay visible while the long report is open.
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: "instant" }));
    const trigger = card.getByRole("button", { name: "Müzakereyi Sil", exact: true });
    await trigger.scrollIntoViewIfNeeded(); await trigger.focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "Müzakereyi Sil", exact: true });
    await expect(panel).toHaveCount(1);
    await expect(panel).toContainText("2 çalışma ve 1 özel müzakere");
    await expect(panel).toContainText("Bağlı Kayıtlar Korunacak");
    await panel.getByText("Bağlı Kayıtları Göster", { exact: false }).click();
    await expect(panel).toContainText(external);
    await expect(panel.getByRole("checkbox")).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0);
    await panel.getByRole("button", { name: "Evet, Müzakereyi Sil" }).click();
    await expect(panel).toHaveCount(0); await expect(card).toHaveCount(0);
    await expect(page.locator("#council-result")).toHaveCount(0);
    for (const id of [child, source]) expect((await request.get(`/api/runs/${id}`)).status()).toBe(404);
    expect((await request.get(`/api/conversations/${conversationId}/deletion`)).status()).toBe(404);
    expect((await request.get(`/api/conversations/${neighbor}/deletion`)).status()).toBe(200);
    expect((await request.get(`/api/runs/${external}`)).status()).toBe(200);
    expect((await getDatabase().select().from(runDeletions).where(eq(runDeletions.conversationId, conversationId)))).toHaveLength(2);
    expect((await getDatabase().select().from(privateBranchDeletions).where(eq(privateBranchDeletions.conversationId, conversationId)))).toHaveLength(1);
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Draft preserved throughout conversation cleanup");
    expect(generations).toBe(0);
  } finally {
    await getDatabase().delete(conversationPrivateBranches).where(eq(conversationPrivateBranches.conversationId, conversationId));
    await getDatabase().delete(privateBranchDeletions).where(eq(privateBranchDeletions.conversationId, conversationId));
    await getDatabase().delete(runDeletions).where(eq(runDeletions.conversationId, conversationId));
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.conversationId, conversationId));
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.conversationId, neighbor));
    await getDatabase().delete(conversations).where(inArray(conversations.id, [conversationId, neighbor]));
    await getDatabase().delete(runs).where(inArray(runs.id, [source, child, external]));
    await closeDatabase();
  }
}));
