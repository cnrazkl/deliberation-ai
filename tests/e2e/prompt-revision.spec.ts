import { withOwner } from "@deliberation-ai/persistence";
import { revealCouncilControls } from "./workspace-navigation";
import {expect, test, testOwnerId } from "./authenticated-test";

test("shows additive prompt differences, allows editing and blocks omission before submission", async ({ page }) => withOwner(testOwnerId(), async () => {
  await page.route("**/api/provider-connections", async (route) => {
    await route.fulfill({ json: { connections: [{
      id: "11111111-1111-4111-8111-111111111111", provider: "openai", label: "Offline revision fixture",
      defaultModel: "fixture-model", configured: true, endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema",
    }] } });
  });
  let submissions = 0;
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submissions += 1;
    await route.fulfill({ status: 422, json: { error: "Fixture must not submit" } });
  });
  await page.goto("/"); await revealCouncilControls(page);
  const question = "Renk paletlerini hangi ölçütlerle karşılaştırmalıyım?";
  await page.getByRole("textbox", { name: "Sorunuz", exact: true }).fill(question);
  const editor = page.getByRole("region", { name: "İstem sürümleri" });
  await expect(editor).toContainText(question);
  await editor.getByRole("radio", { name: "Düzenlenebilir adayı kullan" }).check();
  await editor.getByText("Özgün metne göre fark ve denetim").click();
  await expect(editor).toContainText("Yanıt çerçevesi");
  await expect(page.getByRole("button", { name: "Konseyi çalıştır" })).toBeEnabled();
  await editor.getByRole("textbox", { name: "Yapılandırılmış aday istem" }).fill("Yalnızca tek cümleyle yanıt ver.");
  await expect(editor).toContainText("özgün metin tam ve tek kez korunmuyor");
  await expect(page.getByRole("button", { name: "Konseyi çalıştır" })).toBeDisabled();
  await editor.getByRole("radio", { name: "Özgün soruyu kullan" }).check();
  await expect(page.getByRole("button", { name: "Konseyi çalıştır" })).toBeEnabled();
  expect(submissions).toBe(0);
}));
