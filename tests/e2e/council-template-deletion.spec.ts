import { withOwner } from "@deliberation-ai/persistence";
import { revealCouncilControls } from "./workspace-navigation";
import { randomUUID } from "node:crypto";
import {expect, test, testOwnerId } from "./authenticated-test";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDatabase, councilTemplates, getDatabase } from "@deliberation-ai/persistence";

test("reviews template deletion, rejects stale confirmation and recovers a lost receipt while preserving the council draft", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  const ids: string[] = []; const name = `E2E reviewed template ${randomUUID()}`;
  let input: Record<string, unknown> | undefined; let generations = 0;
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generations++; });
  try {
    await page.route("**/api/provider-connections", (route) => route.fulfill({ json: { connections: [{ id: "11111111-1111-4111-8111-111111111111", provider: "openai", label: "Offline template fixture", defaultModel: "offline-fixture", endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema" }] } }));
    await page.route("**/api/council-templates", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      input = route.request().postDataJSON(); const response = await route.fetch(); expect(response.ok()).toBe(true);
      ids.push((await response.json()).id); await route.fulfill({ response });
    });
    await page.goto("/"); await revealCouncilControls(page); const question = page.getByRole("textbox", { name: "Sorunuz", exact: true });
    await question.fill("Generated template deletion keeps this draft question");
    await page.getByLabel("Şablon adı", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Şablonu kaydet", exact: true }).click();
    const reviewButton = page.getByRole("button", { name: `${name} şablonunu silmeyi incele`, exact: true });
    await expect(reviewButton).toBeVisible(); const id = ids[0]!;
    await reviewButton.click(); const panel = page.getByRole("region", { name: "Şablon silme önizlemesi" });
    const confirm = panel.getByRole("button", { name: "Şablon içeriğini kalıcı olarak sil" });
    await expect(confirm).toBeDisabled(); await expect(panel).toContainText("Önceki çalışmalar ve zamanlamalar kendi kopyalarını saklar");
    await panel.getByRole("button", { name: "Silme incelemesini kapat" }).click();
    await expect(question).toHaveValue("Generated template deletion keeps this draft question");
    await reviewButton.click(); await expect(confirm).toBeDisabled();
    const old = await (await request.get(`/api/council-templates/${id}/deletion`)).json();
    const confirmation = { templateId: id, fingerprint: old.fingerprint, confirmContentDeletion: true, acknowledgeRetainedCopies: true };
    expect((await request.post(`/api/council-templates/${id}/deletion`, { data: { ...confirmation, acknowledgeRetainedCopies: false } })).status()).toBe(422);
    expect((await request.post(`/api/council-templates/${id}/deletion`, { headers: { origin: "https://foreign.example" }, data: confirmation })).status()).toBe(403);
    await getDatabase().execute(sql`update council_templates set updated_at=updated_at+interval '1 microsecond' where id=${id}::uuid`);
    await panel.getByRole("checkbox").check(); await confirm.click(); await expect(panel.getByRole("alert")).toContainText("Şablon değişti");
    await panel.getByRole("button", { name: "Silme önizlemesini yenile" }).click(); await expect(confirm).toBeDisabled();
    const current = await (await request.get(`/api/council-templates/${id}/deletion`)).json();
    await page.route(`**/api/council-templates/${id}/deletion`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort();
    });
    await panel.getByRole("checkbox").check(); await confirm.click(); await expect(panel.getByRole("alert")).toBeVisible();
    await panel.getByRole("button", { name: "Silme önizlemesini yenile" }).click(); await expect(reviewButton).toHaveCount(0);
    const replay = await request.post(`/api/council-templates/${id}/deletion`, { data: { ...confirmation, fingerprint: current.fingerprint } });
    expect(replay.ok()).toBe(true); const receipt = (await replay.json()).receipt;
    expect((await request.post(`/api/council-templates/${id}/deletion`, { data: { ...confirmation, fingerprint: current.fingerprint } })).ok()).toBe(true);
    expect((await request.post("/api/council-templates", { data: input })).status()).toBe(409);
    const reused = await request.post("/api/council-templates", { data: { ...input, requestId: randomUUID() } });
    expect(reused.ok()).toBe(true); ids.push((await reused.json()).id);
    expect((await request.post("/api/council-templates", { data: { ...input, requestId: undefined } })).status()).toBe(422);
    expect(receipt.templateId).toBe(id);
    await expect(question).toHaveValue("Generated template deletion keeps this draft question");
    await expect(page.getByLabel("Üye 1 modeli", { exact: true })).toHaveValue("offline-fixture");
    expect(generations).toBe(0);
  } finally { if (ids.length) await getDatabase().delete(councilTemplates).where(inArray(councilTemplates.id, ids)); await closeDatabase(); }
}));
