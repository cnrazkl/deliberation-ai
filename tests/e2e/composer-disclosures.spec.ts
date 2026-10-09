import type { Page } from "@playwright/test";
import { expect, test } from "./authenticated-test";

async function offlineConnection(page: Page) {
  await page.route("**/api/provider-connections", route => route.fulfill({ json: { connections: [{
    id: "11111111-1111-4111-8111-111111111111", provider: "openai", label: "Offline disclosure fixture",
    defaultModel: "fixture-model", configured: true, endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema",
  }] } }));
}

for (const theme of ["light", "dark"] as const) for (const width of [320, 960, 1540]) {
  test(`composer disclosures are readable and fit at ${width}px in ${theme}`, async ({ page }, info) => {
    await offlineConnection(page);
    let mutations = 0;
    page.on("request", request => {
      if (request.method() !== "GET" && new URL(request.url()).pathname !== "/api/runs/token-preview") mutations++;
    });
    await page.setViewportSize({ width, height: 975 });
    await page.goto("/");
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const headers = page.locator("summary.disclosure-summary");
    await expect(headers).toHaveCount(7);
    for (const expanded of [false, true]) {
      const issues = await headers.evaluateAll((summaries, expanded) => {
        const issues: string[] = [];
        const luminance = (rgb: number[]) => rgb.map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
        const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        for (const summary of summaries) {
          (summary.parentElement as HTMLDetailsElement).open = expanded;
          const box = summary.getBoundingClientRect();
          if (box.height < 44 || box.width < 44) issues.push("Small disclosure target");
          for (const element of summary.querySelectorAll("span, svg")) {
            const rect = element.getBoundingClientRect();
            if (rect.left < box.left - 1 || rect.right > box.right + 1 || (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)) issues.push("Clipped disclosure label");
          }
          for (const text of summary.querySelectorAll(".disclosure-title, .disclosure-description, .disclosure-status")) {
            const style = getComputedStyle(text);
            let background: Element | null = text;
            while (background && ["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(background).backgroundColor)) background = background.parentElement;
            const ink = luminance(rgb(style.color)), paper = luminance(rgb(getComputedStyle(background!).backgroundColor));
            if ((Math.max(ink, paper) + .05) / (Math.min(ink, paper) + .05) < 4.5) issues.push("Insufficient text contrast");
            if (text.classList.contains("disclosure-title") && parseFloat(style.fontSize) < 15) issues.push("Small disclosure heading");
          }
        }
        if (document.documentElement.scrollWidth > innerWidth) issues.push("Horizontal page overflow");
        return issues;
      }, expanded);
      expect(issues).toEqual([]);
      await page.locator(".question-card").screenshot({ path: info.outputPath(`composer-${theme}-${width}-${expanded ? "open" : "closed"}.png`) });
    }
    expect(mutations).toBe(0);
  });
}

test("keyboard and whole-row expansion retain drafts and do not enable settings", async ({ page }) => {
  await offlineConnection(page);
  let submissions = 0;
  await page.route("**/api/runs", route => {
    if (route.request().method() === "GET") return route.continue();
    submissions++;
    return route.fulfill({ status: 422, json: { error: "Must not dispatch" } });
  });
  await page.goto("/");
  const question = "Renk paletlerini hangi ölçütlerle karşılaştırmalıyım?";
  await page.getByLabel("Sorunuz", { exact: true }).fill(question);
  const prompt = page.locator("details.composer-disclosure").filter({ has: page.locator(".prompt-revision-editor") });
  const summary = prompt.locator(":scope > summary");
  await summary.focus();
  await expect(summary).toBeFocused();
  expect(await summary.evaluate(element => element.matches(":focus-visible") && parseFloat(getComputedStyle(element).outlineWidth) >= 2)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(prompt).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(prompt.getByRole("radio", { name: "Özgün soruyu kullan" })).toBeFocused();
  const candidate = `${question}\nÖlçütleri bir tabloyla karşılaştır.`;
  await prompt.getByLabel("Yapılandırılmış aday istem").fill(candidate);
  await prompt.getByRole("radio", { name: "Düzenlenebilir adayı kullan" }).check();
  await summary.focus(); await page.keyboard.press("Space");
  await expect(prompt).not.toHaveAttribute("open");
  const limits = page.locator("details.composer-disclosure").filter({ has: page.locator(".execution-limits-control") });
  const limitSummary = limits.locator(":scope > summary");
  const bounds = await limitSummary.boundingBox();
  await limitSummary.click({ position: { x: bounds!.width - 8, y: bounds!.height / 2 } });
  await expect(limits).toHaveAttribute("open", "");
  await expect(limits.getByRole("checkbox")).not.toBeChecked();
  await limits.getByRole("checkbox").check();
  await limits.getByLabel("En fazla API çağrısı").fill("5");
  await limitSummary.click();
  await expect(limitSummary.locator(".disclosure-status")).toHaveText("Etkin");
  await summary.press("Enter");
  await expect(prompt.getByLabel("Yapılandırılmış aday istem")).toHaveValue(candidate);
  await expect(prompt.getByRole("radio", { name: "Düzenlenebilir adayı kullan" })).toBeChecked();
  await page.locator(".knowledge-panel > summary").press("Space");
  await expect(page.locator(".knowledge-panel")).toHaveAttribute("open", "");
  await expect(prompt).toHaveAttribute("open", "");
  await limitSummary.press("Enter");
  await expect(limits.getByRole("checkbox")).toBeChecked();
  await expect(limits.getByLabel("En fazla API çağrısı")).toHaveValue("5");
  await expect(page.getByLabel("Sorunuz", { exact: true })).toHaveValue(question);
  expect(submissions).toBe(0);
});

test("high-risk assessment and blocking guidance stay visible", async ({ page }) => {
  await offlineConnection(page); await page.goto("/");
  await page.getByLabel("Sorunuz", { exact: true }).fill("Tedavi için hangi ilacı seçmeliyim ve nasıl bir doz kullanmalıyım?");
  await expect(page.locator(".question-card > .risk-assessment")).toBeVisible();
  await expect(page.locator(".question-card > .risk-assessment")).toContainText("Yüksek risk");
  await expect(page.locator(".question-card > .inline-warning").filter({ hasText: "Yüksek risk profili" })).toBeVisible();
  await expect(page.locator('.question-card button[type="submit"]')).toBeDisabled();
});
