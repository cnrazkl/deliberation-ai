import { expect, test } from "@playwright/test";

test("explains automatic risk and requires controls without changing the owner's question or calling a model", async ({ page, request }) => {
  let submissions = 0;
  await page.route("**/api/provider-connections", async (route) => {
    await route.fulfill({ json: { connections: [{
      id: "11111111-1111-4111-8111-111111111111", provider: "openai", label: "Offline risk fixture",
      defaultModel: "fixture-model", configured: true, endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema",
    }] } });
  });
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submissions += 1;
    await route.fulfill({ status: 422, json: { error: "Fixture must not submit" } });
  });
  await page.goto("/");
  const question = page.getByRole("textbox", { name: "Sorunuz", exact: true });
  const risk = page.getByLabel("Risk ön değerlendirmesi");
  await question.fill("İlaç dozunu nasıl değiştirmeliyim?");
  await expect(risk).toContainText("Uygulanacak profil: Yüksek risk");
  await expect(risk).toContainText("Sağlık / tedavi · soru");
  await expect(page.getByLabel("Değerlendirme profili")).toHaveValue("standard");
  await expect(page.getByRole("button", { name: "Açıklama sorularını aç" })).toBeDisabled();
  await page.getByRole("button", { name: "Gerekli risk kontrollerini ekle" }).click();
  await expect(page.getByLabel("Red-team karşılaştırmasını etkinleştir")).toBeChecked();
  await expect(page.getByLabel("Çapraz inceleme turu")).toHaveValue("1");
  await expect(page.getByRole("button", { name: "Açıklama sorularını aç" })).toBeEnabled();
  await expect(question).toHaveValue("İlaç dozunu nasıl değiştirmeliyim?");
  await expect(page.getByLabel("Değerlendirme profili")).toHaveValue("standard");

  // Changing the draft recomputes the risk; the owner's added members remain.
  await question.fill("Renk paletlerini nasıl karşılaştırmalıyım?");
  await expect(risk).toContainText("Uygulanacak profil: Standart");
  await expect(page.getByLabel("Red-team karşılaştırmasını etkinleştir")).toBeEnabled();
  await expect(risk).toContainText("güvenli olduğuna dair onay değildir");
  expect(submissions).toBe(0);

  const blocked = await request.post("/api/runs", { data: {
    question: "İlaç dozunu nasıl değiştirmeliyim?", providerMode: "fake", riskProfile: "standard", idempotencyKey: crypto.randomUUID(),
  } });
  expect(blocked.status()).toBe(422);
  expect(await blocked.json()).toMatchObject({ riskAssessment: { effectiveProfile: "high", requestedProfile: "standard" } });
  const schedule = await request.post("/api/local-schedules", { data: {
    requestId: crypto.randomUUID(), name: "Blocked risk fixture", question: "Yatırım hesabımı nasıl seçmeliyim?", providerMode: "fake", riskProfile: "standard",
    reviewRounds: 0, cadence: "daily", nextRunAt: new Date(Date.now() + 86400000).toISOString(),
    members: ["fake-a", "fake-b"].map((id) => ({ id, label: id, role: "Analist", provider: "fake", model: "fixture", perspective: "risk", councilRole: "analyst" })),
  } });
  expect(schedule.status()).toBe(422);
  expect(await schedule.json()).toMatchObject({ riskAssessment: { effectiveProfile: "high" } });
});
