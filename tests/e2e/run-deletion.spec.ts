import { withOwner } from "@deliberation-ai/persistence";
import { randomUUID } from "node:crypto";
import { expect, test, testOwnerId } from "./authenticated-test";
import { eq, inArray, sql } from "drizzle-orm";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { getDatabase, closeDatabase, encryptJson, encryptText, runs, conversationRuns, conversations,
  providerOperations, runDeletions, conversationPrivateBranches, loadRunContinuation } from "@deliberation-ai/persistence";

test("reviews run deletion, preserves the draft, rejects stale state and manually replays a lost committed response", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  const id = randomUUID(); const conversationId = randomUUID(); const key = randomUUID(); const op = randomUUID(); let generations = 0;
  const report = buildCouncilReport(defaultFakeCouncilMembers.map((member) => ({ memberId: member.id, label: member.label, councilRole: member.councilRole,
    rawText: "Generated report content to remove", parsed: { summary: "Generated deletion report", claims: [{ statement: "Generated claim", quote: "Generated claim", kind: "objection" as const }] }, citations: [] })), []);
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generations++; });
  try {
    await getDatabase().insert(runs).values({ id, ownerId: testOwnerId(), idempotencyKey: key, requestHash: "reviewed-delete-browser",
      snapshotId: randomUUID(), question: "[encrypted]", questionCiphertext: encryptText("Generated run deletion browser fixture", `run:${id}:question`),
      reportCiphertext: encryptJson(report, `run:${id}:report`), membersCiphertext: encryptJson(defaultFakeCouncilMembers, `run:${id}:members`),
      status: "completed", branchIndexVersion: 1, branchKind: "independent", createdAt: sql`'2400-01-07'::timestamptz`, finishedAt: new Date() });
    await getDatabase().insert(conversations).values({ id: conversationId, ownerId: testOwnerId(), anchorRunId: id, origin: "native" });
    await getDatabase().insert(conversationRuns).values({ ownerId: testOwnerId(), conversationId, runId: id, kind: "independent", createdAt: sql`'2400-01-07'::timestamptz` });
    await getDatabase().insert(providerOperations).values({ id: op, runId: id, memberId: defaultFakeCouncilMembers[0]!.id,
      provider: "fake", model: "offline-model", status: "failed", requestFingerprint: "fixture-request", inputTokens: 0, outputTokens: null });
    const endpoint = `/api/runs/${id}/deletion`;
    const previewResponse = await request.get(endpoint); expect(previewResponse.status()).toBe(200); expect(previewResponse.headers()["cache-control"]).toBe("no-store");
    const previewData = await previewResponse.json(); expect(previewData.eligible).toBe(true);
    const body = { runId: id, fingerprint: previewData.fingerprint, confirmContentDeletion: true, acknowledgeRetainedRecords: true };
    expect((await request.post(endpoint, { data: body, headers: { origin: "https://external.example" } })).status()).toBe(403);
    expect((await request.post(endpoint, { data: { ...body, runId: randomUUID() } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { ...body, confirmContentDeletion: false } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { ...body, extra: "unsafe" } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: "x".repeat(4_097), headers: { "Content-Type": "application/json" } })).status()).toBe(413);
    expect((await request.get(`/api/runs/${id}/deletion-receipt`)).status()).toBe(404);
    await page.goto("/");
    const history = page.locator("details.run-history"); const card = history.locator(`[data-run-id="${id}"]`);
    await expect(card).toBeVisible(); await page.getByLabel("Sorunuz", { exact: true }).fill("Owner draft preserved after run deletion");
    await card.getByRole("button", { name: "Çalışmayı aç", exact: true }).click();
    await expect(page.locator("#council-result")).toBeVisible();
    await card.getByRole("button", { name: "Çalışma silmeyi incele" }).click();
    const preview = history.getByRole("region", { name: "Çalışma içeriği silme önizlemesi" });
    await expect(preview.getByRole("checkbox")).toBeVisible();
    await expect(preview.getByRole("button", { name: "Çalışma içeriğini kalıcı olarak sil" })).toBeDisabled();
    await preview.getByRole("button", { name: "Silmeden vazgeç" }).click(); expect((await request.get(`/api/runs/${id}`)).status()).toBe(200);
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Owner draft preserved after run deletion");
    await card.getByRole("button", { name: "Çalışma silmeyi incele" }).click(); await preview.getByRole("checkbox").check();
    await getDatabase().update(providerOperations).set({ inputTokens: 1 }).where(eq(providerOperations.id, op));
    await preview.getByRole("button", { name: "Çalışma içeriğini kalıcı olarak sil" }).click();
    await expect(preview.getByRole("alert")).toContainText("Çalışma değişti");
    expect((await request.get(`/api/runs/${id}`)).status()).toBe(200);
    await preview.getByRole("button", { name: "Silme önizlemesini yenile" }).click(); await preview.getByRole("checkbox").check();
    let lose = true;
    await page.route(`**${endpoint}`, async (route) => {
      if (route.request().method() === "POST" && lose) { lose = false; await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await preview.getByRole("button", { name: "Çalışma içeriğini kalıcı olarak sil" }).click(); await expect(preview.getByRole("alert")).toBeVisible();
    await preview.getByRole("button", { name: "Çalışma içeriğini kalıcı olarak sil" }).click();
    await expect(card).toHaveCount(0); await expect(page.locator("#council-result")).toHaveCount(0);
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Owner draft preserved after run deletion");
    const auditResponse = await request.get(`/api/runs/${id}/deletion-receipt`); expect(auditResponse.status()).toBe(200);
    const audit = await auditResponse.json(); expect(audit.receipts[0]).toMatchObject({ inputTokens: 1, outputTokens: null });
    expect(JSON.stringify(audit)).not.toMatch(/Generated report|Generated run deletion|Owner draft/);
    expect((await request.get(`/api/runs/${id}`)).status()).toBe(404); expect((await request.post(`/api/runs/${id}/export`)).status()).toBe(404);
    const exported = await (await request.post(`/api/conversations/${conversationId}/export`)).json();
    expect(exported.runDeletions).toEqual([audit]); expect(exported.runs[0]).toMatchObject({ availability: "unavailable", payload: null });
    expect(generations).toBe(0);
  } finally {
    await getDatabase().delete(runDeletions).where(eq(runDeletions.id, id));
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.conversationId, conversationId));
    await getDatabase().delete(conversations).where(eq(conversations.id, conversationId));
    await getDatabase().delete(runs).where(eq(runs.id, id)); await closeDatabase();
  }
}));

test("run deletion preview blocks copied context and running work without generating or deleting content", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  const source = randomUUID(); const child = randomUUID(); const conversationId = randomUUID(); let generations = 0;
  const report = buildCouncilReport(defaultFakeCouncilMembers.map((member) => ({ memberId: member.id, label: member.label, councilRole: member.councilRole,
    rawText: "Copied fixture report", parsed: { summary: "Copied fixture", claims: [] }, citations: [] })), []);
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generations++; });
  try {
    await getDatabase().insert(runs).values({ id: source, ownerId: testOwnerId(), idempotencyKey: randomUUID(), requestHash: "copy-fixture",
      snapshotId: randomUUID(), question: "[encrypted]", questionCiphertext: encryptText("Generated blocked deletion fixture", `run:${source}:question`),
      reportCiphertext: encryptJson(report, `run:${source}:report`), membersCiphertext: encryptJson(defaultFakeCouncilMembers, `run:${source}:members`),
      status: "completed", branchIndexVersion: 1, branchKind: "independent", createdAt: sql`'2400-01-08'::timestamptz`, finishedAt: new Date() });
    const context = await loadRunContinuation(source);
    await getDatabase().insert(runs).values({ id: child, ownerId: testOwnerId(), idempotencyKey: randomUUID(), requestHash: "copy-fixture-child",
      snapshotId: randomUUID(), question: "Copied generated child", continuationContextCiphertext: encryptJson(context, `run:${child}:continuation-context`),
      status: "running", branchIndexVersion: 1, branchKind: "continuation-full", branchSourceRunId: source, createdAt: sql`'2400-01-09'::timestamptz` });
    await getDatabase().insert(conversations).values({ id: conversationId, ownerId: testOwnerId(), anchorRunId: source, origin: "native" });
    await getDatabase().insert(conversationRuns).values([
      { ownerId: testOwnerId(), conversationId, runId: source, kind: "independent", createdAt: sql`'2400-01-08'::timestamptz` },
      { ownerId: testOwnerId(), conversationId, runId: child, kind: "continuation-full", sourceRunId: source, createdAt: sql`'2400-01-09'::timestamptz` },
    ]);
    const active = await (await request.get(`/api/runs/${child}/deletion`)).json(); expect(active.blockedReasons).toContain("active_run");
    await page.goto("/"); const history = page.locator("details.run-history"); const card = history.locator(`[data-run-id="${source}"]`);
    await expect(card).toBeVisible(); await page.getByLabel("Sorunuz", { exact: true }).fill("Draft kept for blocked deletion");
    await card.getByRole("button", { name: "Çalışma silmeyi incele" }).click();
    const preview = history.getByRole("region", { name: "Çalışma içeriği silme önizlemesi" });
    await expect(preview).toContainText("kopyaları var"); await expect(preview).toContainText(child);
    await expect(preview.getByRole("button", { name: "Çalışma içeriğini kalıcı olarak sil" })).toHaveCount(0);
    await preview.getByRole("button", { name: "Silmeden vazgeç" }).click();
    await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue("Draft kept for blocked deletion");
    expect((await request.get(`/api/runs/${source}`)).status()).toBe(200); expect(generations).toBe(0);
  } finally {
    await getDatabase().delete(conversationPrivateBranches).where(inArray(conversationPrivateBranches.sourceRunId, [source, child]));
    await getDatabase().delete(conversationRuns).where(eq(conversationRuns.conversationId, conversationId));
    await getDatabase().delete(conversations).where(eq(conversations.id, conversationId));
    await getDatabase().delete(runs).where(inArray(runs.id, [source, child])); await closeDatabase();
  }
}));
