import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, or } from "drizzle-orm";
import { closeDatabase, councilTemplates, getDatabase } from "@deliberation-ai/persistence";

test("lost template save responses retry without overwriting drafts or resurrecting explicit deleted identities", async ({ page, request }) => {
  const name = `E2E template ${randomUUID()}`;
  let id: string | undefined;
  let input: Record<string, unknown> | undefined;
  let first = true;
  let generations = 0;
  page.on("request", (value) => { if (value.method() === "POST" && new URL(value.url()).pathname === "/api/runs") generations++; });
  try {
    await page.route("**/api/provider-connections", (route) => route.fulfill({ json: { connections: [{
      id: "11111111-1111-4111-8111-111111111111", provider: "openai", label: "Offline template fixture",
      defaultModel: "offline-fixture", endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema",
    }] } }));
    await page.route("**/api/council-templates", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      input = route.request().postDataJSON();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      id = (await response.json()).id;
      if (first) { first = false; await route.abort(); } else await route.fulfill({ response });
    });
    await page.goto("/");
    const question = page.getByRole("textbox", { name: "Sorunuz", exact: true });
    await question.fill("Generated template save question stays unchanged");
    const field = page.getByRole("textbox", { name: "Şablon adı", exact: true });
    await field.fill(name);
    const save = page.getByRole("button", { name: "Şablonu kaydet", exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(field).toHaveValue(name);
    await expect(save).toBeEnabled();
    expect(id).toBeTruthy();
    const before = await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, id!));
    await save.click();
    await expect(field).toHaveValue("");
    await expect(page.getByRole("button", { name: `${name} 2 üye`, exact: true })).toBeVisible();
    expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, id!))).toEqual(before);
    const conflict = await request.post("/api/council-templates", { data: { ...input, description: "Different draft" } });
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error).toContain("farklı bir ad seçin");
    expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, id!))).toEqual(before);
    expect((await request.delete(`/api/council-templates?id=${id}`)).status()).toBe(405);
    const preview = await (await request.get(`/api/council-templates/${id}/deletion`)).json();
    expect((await request.post(`/api/council-templates/${id}/deletion`, { data: { templateId: id, fingerprint: preview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedCopies: true } })).ok()).toBe(true);
    expect((await request.post("/api/council-templates", { data: { ...input, requestId: undefined, id } })).status()).toBe(409);
    expect(await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.name, name))).toHaveLength(0);
    await expect(question).toHaveValue("Generated template save question stays unchanged");
    expect(generations).toBe(0);
  } finally {
    await getDatabase().delete(councilTemplates).where(or(eq(councilTemplates.name, name), id ? eq(councilTemplates.id, id) : undefined));
    await closeDatabase();
  }
});
