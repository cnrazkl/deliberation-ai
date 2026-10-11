import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { withOwner, closeDatabase, getDatabase, councilTemplates } from "@deliberation-ai/persistence";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { expect, test, testOwnerId } from "./authenticated-test";
import { revealCouncilControls } from "./workspace-navigation";

test("saved council pool restores models and rounds, preserves the question and freezes the chosen draft on submit", async ({ page, request }) => withOwner(testOwnerId(), async () => {
  const created = await request.post("/api/provider-connections", { data: { provider: "openai-compatible", label: `Pool fixture ${randomUUID()}`,
    apiKey: "fixture-only", endpointPreset: "ollama", baseUrl: "http://127.0.0.1:11434/v1", reasoningProtocol: "openai",
    structuredOutputMode: "json-schema", selectedModels: ["first-fixture", "second-fixture"] } });
  const connection = await created.json(); const ids: string[] = []; let dispatched = 0; let submitted: Record<string, unknown> | undefined;
  try {
    const members = defaultFakeCouncilMembers.map((member, index) => ({ ...member, provider: "openai-compatible", model: index ? "second-fixture" : "first-fixture", connectionId: connection.id, reasoningLevel: "default" }));
    const name = `Saved pool ${randomUUID()}`;
    const saved = await request.post("/api/council-templates", { data: { requestId: randomUUID(), name, members, settings: { reviewRounds: 0, selfRevisionEnabled: false } } });
    expect(saved.ok()).toBe(true); const template = await saved.json(); ids.push(template.id);
    page.on("request", value => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") dispatched++; });
    await page.goto("/"); const pool = page.getByRole("region", { name: "Konsey Havuzu", exact: true });
    await expect(pool).toBeVisible(); const question = page.getByLabel("Sorunuz", { exact: true });
    await question.fill("Compare two ways to organize project notes briefly.");
    await pool.getByLabel("Kayıtlı Konsey").selectOption(template.id);
    await expect(pool).toContainText("0 inceleme turu"); await expect(pool).toContainText("second-fixture");
    await expect(question).toHaveValue("Compare two ways to organize project notes briefly."); expect(dispatched).toBe(0);
    await revealCouncilControls(page);
    await expect(page.getByLabel("Üye 1 modeli", { exact: true })).toHaveValue("first-fixture");
    await expect(page.getByLabel("Üye 2 modeli", { exact: true })).toHaveValue("second-fixture");
    await expect(page.getByLabel("Çapraz inceleme turu")).toHaveValue("0");
    await page.getByLabel("Çapraz inceleme turu").selectOption("2");
    await expect(pool.getByLabel("Kayıtlı Konsey")).toHaveValue(""); await expect(pool).toContainText("Düzenlenmiş Taslak");
    await pool.getByLabel("Şablon adı").fill(`${name} edited`);
    await pool.getByLabel("Şablon adı").press("Enter"); await expect(pool.getByLabel("Şablon adı")).toHaveValue("");
    const list = (await (await request.get("/api/council-templates")).json()).templates;
    const edited = list.find((value: { name: string }) => value.name === `${name} edited`); ids.push(edited.id);
    expect(edited.settings).toEqual({ reviewRounds: 2, selfRevisionEnabled: false }); expect(dispatched).toBe(0);
    await page.reload(); await expect(pool.getByLabel("Kayıtlı Konsey").locator("option").filter({ hasText: name })).toHaveCount(2);
    await pool.getByLabel("Kayıtlı Konsey").selectOption(template.id);
    await question.fill("Compare two ways to organize project notes briefly.");
    await page.route("**/api/runs", async route => {
      if (route.request().method() !== "POST") return route.continue(); submitted = route.request().postDataJSON(); await route.abort();
    });
    const run = page.getByRole("button", { name: "Konseyi çalıştır", exact: true }); await expect(run).toBeEnabled(); await run.click();
    await expect.poll(() => submitted).toBeTruthy(); expect(dispatched).toBe(1);
    expect(submitted?.reviewRounds).toBe(0); expect(submitted?.selfRevisionEnabled).toBe(false); expect(submitted?.members).toEqual(members);
    expect(submitted?.question).toBe("Compare two ways to organize project notes briefly.");
  } finally { if (ids.length) await getDatabase().delete(councilTemplates).where(inArray(councilTemplates.id, ids)); await request.delete(`/api/provider-connections?id=${connection.id}`); await closeDatabase(); }
}));

for (const theme of ["light", "dark"]) for (const width of [320, 1110]) {
  test(`council pool fits ${width}px in ${theme} with long saved names and models`, async ({ page }, info) => {
    const id = "11111111-1111-4111-8111-111111111111", connectionId = "22222222-2222-4222-8222-222222222222";
    const members = defaultFakeCouncilMembers.map(member => ({ ...member, provider: "openai-compatible", model: "long-model-id-".repeat(12), connectionId }));
    let dispatched = 0; page.on("request", value => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") dispatched++; });
    await page.route("**/api/council-templates", route => route.fulfill({ json: { templates: [{ id, name: "Uzun Konsey Adı ".repeat(5), members, memberCount: 2, settings: { reviewRounds: 2, selfRevisionEnabled: true } }] } }));
    await page.route("**/api/provider-connections", route => route.fulfill({ json: { connections: [{ id: connectionId, provider: "openai-compatible", label: "Offline pool fixture", endpointPreset: "ollama", defaultModel: members[0]!.model, selectedModels: [members[0]!.model] }] } }));
    await page.setViewportSize({ width, height: 1066 }); await page.goto("/"); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const pool = page.getByRole("region", { name: "Konsey Havuzu", exact: true }); await pool.getByLabel("Kayıtlı Konsey").selectOption(id);
    await expect(pool).toContainText("2 inceleme turu");
    expect(await pool.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pool.screenshot({ path: info.outputPath(`pool-${theme}-${width}.png`) }); expect(dispatched).toBe(0);
  });
}
