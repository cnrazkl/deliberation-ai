import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { getDatabase, closeDatabase, encryptJson, encryptText, LOCAL_OWNER_ID, runs, claims, conversationRuns, conversations } from "@deliberation-ai/persistence";

test("candidate inbox preserves originals, retries lost replies and separates review from claim state without provider calls", async ({ page, request }) => {
  test.setTimeout(60_000);
  const id = randomUUID(), conversationId = randomUUID(), claimRowId = randomUUID(); let generations = 0;
  const report = buildCouncilReport(defaultFakeCouncilMembers.slice(0, 2).map((member) => ({ memberId: member.id, label: member.label, councilRole: member.councilRole,
    rawText: "Generated model candidate response", parsed: { summary: "Generated answer", claims: [{ statement: "Generated candidate claim", quote: "Original model passage", kind: "shared" as const }] },
    citations: [{ title: "Generated citation", url: "https://example.invalid/candidate" }] })), []);
  const claim = report.sharedClaims[0]!;
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
    await page.screenshot({ path: ".local/da123-inbox-mobile.png" });
  } finally {
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.runId, id)); await getDatabase().delete(runs).where(eq(runs.id, id));
    await getDatabase().delete(conversations).where(eq(conversations.id, conversationId)); await closeDatabase();
  }
});
