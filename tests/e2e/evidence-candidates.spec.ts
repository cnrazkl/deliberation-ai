import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, sql, inArray } from "drizzle-orm";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { getDatabase, closeDatabase, encryptJson, encryptText, LOCAL_OWNER_ID, runs, claims, conversationRuns, conversations, createKnowledgeCollection, changeKnowledgeGrant, evidencePublications, knowledgeSources, knowledgeSourceVersions, knowledgeGrants, knowledgeCollections } from "@deliberation-ai/persistence";

test("candidate inbox preserves originals, retries lost replies and separates review from claim state without provider calls", async ({ page, request }) => {
  test.setTimeout(60_000);
  const id = randomUUID(), conversationId = randomUUID(), claimRowId = randomUUID(); let generations = 0;
  const report = buildCouncilReport(defaultFakeCouncilMembers.slice(0, 2).map((member) => ({ memberId: member.id, label: member.label, councilRole: member.councilRole,
    rawText: "Generated model candidate response", parsed: { summary: "Generated answer", claims: [{ statement: "Generated candidate claim", quote: "Original model passage", kind: "shared" as const }] },
    citations: [{ title: "Generated citation", url: "https://example.invalid/candidate" }] })), []);
  const claim = report.sharedClaims[0]!;
  const collection = await createKnowledgeCollection("Browser evidence destination");
  await changeKnowledgeGrant(collection.id, 1, "active");
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generations++; });
  try {
    await getDatabase().insert(runs).values({ id, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "candidate-browser-fixture", snapshotId: randomUUID(),
      question: "[encrypted]", questionCiphertext: encryptText("Generated inbox browser fixture", `run:${id}:question`), reportCiphertext: encryptJson(report, `run:${id}:report`),
      membersCiphertext: encryptJson(defaultFakeCouncilMembers.slice(0, 2), `run:${id}:members`), status: "completed", branchIndexVersion: 1, branchKind: "independent", createdAt: sql`'2400-01-08'::timestamptz`, finishedAt: new Date() });
    await getDatabase().insert(claims).values({ id: claimRowId, runId: id, statement: "[encrypted]", statementCiphertext: encryptText(claim.statement, `claim:${claimRowId}:statement`), reportClaimId: claim.claimId, disposition: "represented" });
    await getDatabase().insert(conversations).values({ id: conversationId, ownerId: LOCAL_OWNER_ID, anchorRunId: id, origin: "native" });
    await getDatabase().insert(conversationRuns).values({ ownerId: LOCAL_OWNER_ID, conversationId, runId: id, kind: "independent", createdAt: sql`'2400-01-08'::timestamptz` });
    await page.goto("/");
    const card = page.locator(`details.run-history [data-run-id="${id}"]`);
    await expect(card).toBeVisible(); await card.getByRole("button", { name: "Çalışmayı aç", exact: true }).click();
    const panel = page.getByRole("region", { name: "Kaynak aday kutusu", exact: true });
    await expect(panel).toBeVisible();
    await panel.getByLabel("Aday başlığı", { exact: true }).fill("Owner false source");
    await panel.getByLabel("Aday kaynak adresi", { exact: true }).fill("https://example.invalid/false");
    await panel.getByLabel("Adayın özgün pasajı", { exact: true }).fill("Original false source passage.");
    let lose = true;
    await page.route("**/api/evidence-candidates", async (route) => {
      if (route.request().method() === "POST" && lose) { lose = false; await route.fetch(); await route.abort("failed"); } else await route.continue();
    });
    await panel.getByRole("button", { name: "Gönderiyi aday kutusuna ekle", exact: true }).click(); await expect(panel.getByRole("alert")).toBeVisible();
    await panel.getByRole("button", { name: "Gönderiyi aday kutusuna ekle", exact: true }).click();
    await expect(panel.locator("article")).toHaveCount(1);
    await panel.getByLabel("Owner false source aday içerik kararı", { exact: true }).selectOption("verified");
    await panel.getByLabel("Owner false source aday güncellik kararı", { exact: true }).selectOption("current");
    const publication = panel.locator(".candidate-publication").first();
    await publication.getByText("Yeniden kullanılabilir kanıt kaydı", { exact: true }).click();
    await publication.getByLabel("Kanıtın hedef koleksiyonu", { exact: true }).selectOption(collection.id);
    await publication.getByRole("button", { name: "Kanıt kaydını incele", exact: true }).click();
    const review = publication.getByRole("region", { name: "Kanıt kaydı incelemesi", exact: true });
    await expect(review).toContainText("Original false source passage.");
    await expect(review.getByRole("button", { name: "Onaylanan kanıtı kaydet", exact: true })).toBeDisabled();
    await review.getByLabel("Bu içeriği ve tam hedefi onaylıyorum", { exact: true }).check();
    let loseSave = true;
    await page.route("**/api/evidence-publications", async (route) => {
      if (route.request().method() === "POST" && route.request().postDataJSON().action === "commit" && loseSave) {
        loseSave = false; await route.fetch(); await route.abort("failed");
      } else await route.continue();
    });
    await review.getByRole("button", { name: "Onaylanan kanıtı kaydet", exact: true }).click();
    await expect(publication.getByRole("alert")).toBeVisible();
    await review.getByRole("button", { name: "Onaylanan kanıtı kaydet", exact: true }).click();
    await expect(publication).toContainText("Yerel kayıt tamamlandı");
    expect(await getDatabase().select().from(knowledgeSources).where(eq(knowledgeSources.collectionId, collection.id))).toHaveLength(1);
    await publication.getByLabel("Kaydetme yöntemi", { exact: true }).selectOption("manual");
    await publication.getByLabel("Manuel hedef adı", { exact: true }).fill("Selected manual notebook");
    await publication.getByLabel("Manuel hedef hesabı", { exact: true }).fill("Declared account");
    await publication.getByLabel("Manuel hedef bağlantısı", { exact: true }).fill("https://example.invalid/notebook");
    await publication.getByRole("button", { name: "Kanıt kaydını incele", exact: true }).click();
    await expect(review).toContainText("uygulama göndermez");
    await publication.getByLabel("Manuel hedef adı", { exact: true }).fill("Changed manual notebook");
    await expect(review).toHaveCount(0);
    await publication.getByRole("button", { name: "Kanıt kaydını incele", exact: true }).click();
    await review.getByLabel("Bu içeriği ve tam hedefi onaylıyorum", { exact: true }).check();
    await review.getByRole("button", { name: "Onaylanan aktarım paketini hazırla", exact: true }).click();
    await expect(publication).toContainText("Elle eklemeniz bekleniyor");
    const handoffDownload = page.waitForEvent("download");
    await publication.getByText("Kanıt ve hedef paketini indir (JSON)", { exact: true }).last().click();
    expect((await handoffDownload).suggestedFilename()).toContain("deliberationai-evidence-");
    await publication.getByRole("button", { name: "Adlandırılan hedefe elle ekledim", exact: true }).click();
    await expect(publication).toContainText("uzaktan doğrulanmadı");
    const packets = await (await request.get(`/api/evidence-publications?runId=${id}`)).json();
    expect(packets.publications).toHaveLength(2);
    expect(packets.publications[1].destination.name).toBe("Changed manual notebook");
    expect(packets.publications[1].candidate.provenance.statement).toBe(claim.statement);
    expect((await request.post("/api/evidence-publications", { data: { action: "preview" }, headers: { origin: "https://external.invalid" } })).status()).toBe(403);
    expect((await request.post("/api/evidence-publications", { data: "x".repeat(17 * 1024) })).status()).toBe(413);
    await panel.getByLabel("Owner false source aday içerik kararı", { exact: true }).selectOption("rejected");
    await expect(panel.getByLabel("Owner false source aday içerik kararı", { exact: true })).toHaveValue("rejected");
    await panel.getByLabel("Owner false source aday güncellik kararı", { exact: true }).selectOption("stale");
    await expect(panel.getByLabel("Owner false source aday güncellik kararı", { exact: true })).toHaveValue("stale");
    await panel.getByRole("button", { name: /atfını ekle: Generated citation/ }).first().click();
    await expect(panel.locator("article")).toHaveCount(2);
    const model = panel.locator("article").filter({ has: page.getByText("Özgün kaynak pasajı yok; model atfı doğrulanmış kaynak sayılmaz.", { exact: true }) });
    await expect(model.getByRole("option", { name: "İnsan tarafından incelendi", exact: true })).toHaveAttribute("disabled", "");
    const data = await request.get(`/api/evidence-candidates?runId=${id}&download=1`); expect(data.headers()["cache-control"]).toBe("no-store");
    const exported = await data.json(); expect(exported.candidates).toHaveLength(2); expect(exported.candidates[0].excerpt).toBe("Original false source passage.");
    expect(exported.candidates[1].candidateProvenance.model.passage).toBe("Original model passage");
    expect((await request.patch(`/api/evidence-sources/${exported.candidates[1].id}`, { data: { reviewStatus: "verified" } })).status()).toBe(409);
    expect((await (await request.get(`/api/runs/${id}`)).json()).report.sharedClaims[0].evidenceState).toBe("unsupported");
    expect((await request.post("/api/evidence-candidates", { data: { origin: "owner" }, headers: { origin: "https://external.invalid" } })).status()).toBe(403);
    expect((await request.post("/api/evidence-candidates", { data: { origin: "owner" } })).status()).toBe(422);
    expect((await request.post("/api/evidence-candidates", { data: "x".repeat(33 * 1024) })).status()).toBe(413);
    expect(generations).toBe(0);
    await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: ".local/da123-inbox.png" });
    const downloading = page.waitForEvent("download"); await panel.getByRole("button", { name: "Adayları indir (JSON)", exact: true }).click(); expect((await downloading).suggestedFilename()).toContain(id);
    await page.reload(); await page.locator(`details.run-history [data-run-id="${id}"]`).getByRole("button", { name: "Çalışmayı aç", exact: true }).click(); await expect(panel.locator("article")).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 }); await panel.scrollIntoViewIfNeeded();
    await panel.getByText("Modelin özgün pasajı ve atıf kaydı", { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.locator(".candidate-publication").first().getByText("Yeniden kullanılabilir kanıt kaydı", { exact: true }).click();
    await expect(panel.locator(".candidate-publication").first()).toContainText("Yerel kayıt tamamlandı");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: ".local/da124-publication-mobile.png" });
  } finally {
    await getDatabase().delete(evidencePublications).where(eq(evidencePublications.runId, id));
    const heads = await getDatabase().select().from(knowledgeSources).where(eq(knowledgeSources.collectionId, collection.id));
    if (heads.length) await getDatabase().delete(knowledgeSourceVersions).where(inArray(knowledgeSourceVersions.sourceId, heads.map((value) => value.id)));
    await getDatabase().delete(knowledgeSources).where(eq(knowledgeSources.collectionId, collection.id));
    await getDatabase().delete(knowledgeGrants).where(eq(knowledgeGrants.collectionId, collection.id));
    await getDatabase().delete(knowledgeCollections).where(eq(knowledgeCollections.id, collection.id));
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.runId, id)); await getDatabase().delete(runs).where(eq(runs.id, id));
    await getDatabase().delete(conversations).where(eq(conversations.id, conversationId)); await closeDatabase();
  }
});
