import { expect, test } from "./authenticated-test";
import type { RunRecord } from "@deliberation-ai/application";

for (const highRisk of [false, true]) {
  test(`council submission without randomUUID preserves lost-response identity (${highRisk ? "four members, three rounds, high risk" : "standard"})`, async ({ page, context }) => {
    await context.addInitScript(() => Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true }));
    await page.route("**/api/provider-connections", route => route.fulfill({ json: { connections: [{
      id: "11111111-1111-4111-8111-111111111111", provider: "openai", label: "Offline LAN fixture", configured: true,
      defaultModel: "fixture-model", endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema",
    }] } }));
    const attempts: Array<{ key: string; members: number; rounds: number; profile: string }> = [];
    let loseResponse = true;
    await page.route("**/api/runs", async route => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON() as { idempotencyKey: string; question: string; reviewRounds: number; riskProfile: string; members: unknown[] };
      attempts.push({ key: body.idempotencyKey, members: body.members.length, rounds: body.reviewRounds, profile: body.riskProfile });
      if (loseResponse) { loseResponse = false; await route.abort(); return; }
      const run: RunRecord = {
        runId: "22222222-2222-4222-8222-222222222222", question: body.question, idempotencyKey: body.idempotencyKey,
        requestHash: "offline-lan-fixture", promptVersion: "council-v1", promptFingerprint: "a".repeat(64),
        riskProfile: highRisk ? "high" : "standard", snapshotId: "offline-lan-fixture", memberCount: body.members.length,
        memoryEntryCount: 0, attachmentCount: 0, toolResultCount: 0, createdAt: "2026-10-09T00:00:00.000Z", status: "completed", report: null,
      };
      await route.fulfill({ json: run });
    });
    await page.goto("/");
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
    if (highRisk) {
      await page.locator(".council-config > summary").click();
      await page.getByLabel("Üye sayısı", { exact: true }).selectOption("3");
      await page.getByLabel("Değerlendirme profili", { exact: true }).selectOption("high");
      await page.getByRole("combobox", { name: "Çapraz inceleme turu", exact: true }).selectOption("3");
      await expect(page.getByLabel("Üye sayısı", { exact: true })).toHaveValue("4");
      await expect(page.getByLabel("Red-team karşılaştırmasını etkinleştir")).toBeChecked();
    }
    const question = page.getByLabel("Sorunuz", { exact: true });
    const draft = "Renk paletlerini hangi ölçütlerle karşılaştırmalıyım?";
    await question.fill(draft);
    const submit = page.locator('.question-card button[type="submit"]');
    await expect(submit).toBeEnabled(); await submit.click();
    await expect(page.locator(".workspace-view > .error")).toBeVisible();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.key).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    await expect(submit).toBeEnabled(); await submit.click();
    await expect(page.getByText("Konsey tamamlandı", { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2); expect(attempts[1]!.key).toBe(attempts[0]!.key);
    expect(attempts[1]!.members).toBe(highRisk ? 4 : 2); expect(attempts[1]!.rounds).toBe(highRisk ? 3 : 1);
    expect(attempts[1]!.profile).toBe(highRisk ? "high" : "standard");
    await expect(question).toHaveValue(draft);
    await expect(submit).toBeEnabled(); await submit.click();
    await expect.poll(() => attempts.length).toBe(3);
    expect(attempts[2]!.key).not.toBe(attempts[1]!.key);
  });
}
