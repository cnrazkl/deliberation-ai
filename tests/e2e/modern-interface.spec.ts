import { expect, test } from "./authenticated-test";
import { workspaceView } from "./workspace-navigation";

test("account disclosure supports keyboard dismissal, outside click and existing password actions", async ({ page }) => {
  await page.goto("/");
  const summary = page.locator(".account-menu > summary");
  const menu = page.locator(".account-menu");
  await summary.focus(); await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Parolayı değiştir", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open"); await expect(summary).toBeFocused();
  await summary.click(); await page.getByRole("heading", { name: "Birlikte düşünelim." }).click();
  await expect(menu).not.toHaveAttribute("open");
  await summary.click(); await page.getByRole("button", { name: "Parolayı değiştir", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open");
  await expect(page.getByRole("region", { name: "Parola değiştirme" })).toBeVisible();
  await expect(summary).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} interface has readable text, distinguishable fields and responsive account navigation`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const draft = page.getByLabel("Sorunuz", { exact: true });
    await draft.fill("Tasarım doğrulamasında korunacak soru taslağı");
    for (const width of [320, 820, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const account = page.getByRole("banner", { name: "Hesap", exact: true });
      await expect(account).toBeVisible();
      expect((await account.boundingBox())!.height).toBeLessThanOrEqual(80);
      await page.locator(".account-menu > summary").click();
      const bounds = (await page.locator(".account-menu-panel").boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      const actionHeights = await page.locator(".account-menu-controls button").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
      expect(actionHeights.every(height => height >= 44)).toBe(true);
      const dangerColor = await page.getByRole("button", { name: "Hesabımı sil", exact: true }).evaluate(element => getComputedStyle(element).color.match(/[\d.]+/g)!.map(Number));
      expect(dangerColor[0]).toBeGreaterThan(dangerColor[2]!);
      await page.keyboard.press("Escape");
      for (const view of ["Sohbet", "Ayarlar", "Zamanlayıcı"] as const) {
        await workspaceView(page, view);
        const topbar = (await page.locator(".workspace-topbar").boundingBox())!;
        const toolbar = (await account.boundingBox())!;
        expect(topbar.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1);
        await page.locator(".workspace-view:not([hidden]) details").evaluateAll(items => {
          for (const item of items) (item as HTMLDetailsElement).open = true;
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const issues = await page.locator(".workspace-view:not([hidden])").evaluate(region => {
          function rgb(value: string) { return value.match(/[\d.]+/g)!.map(Number); }
          function luminance(color: number[]) { const linear = color.slice(0, 3).map(c => c / 255 <= .04045 ? c / 255 / 12.92 : ((c / 255 + .055) / 1.055) ** 2.4); return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722; }
          function background(element: Element): string {
            const color = getComputedStyle(element).backgroundColor;
            if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
            return element.parentElement ? background(element.parentElement) : "rgb(255, 255, 255)";
          }
          function ratio(a: number, b: number) { return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }
          const textIssues = Array.from(region.querySelectorAll("label, .hint, .view-intro, .composer-heading p, .secondary-button, button[type='submit']")).filter(element => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height || element.matches(":disabled")) return false;
            const style = getComputedStyle(element);
            const text = luminance(rgb(style.color)), surface = luminance(rgb(background(element)));
            return ratio(text, surface) < 4.5;
          }).map(element => `${element.tagName}.${element.className}: ${element.textContent?.slice(0, 50)}`).slice(0, 12);
          const fieldIssues = Array.from(region.querySelectorAll("textarea, select, input:not([type='checkbox']):not([type='radio']):not([type='file']):not([type='range'])")).filter(element => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height || element.matches(":disabled")) return false;
            const border = luminance(rgb(getComputedStyle(element).borderTopColor));
            return ratio(border, luminance(rgb(background(element)))) < 3;
          }).map(element => `Field boundary: ${element.tagName}#${element.id}`);
          return [...textIssues, ...fieldIssues];
        });
        expect(issues, `${view} contrast in ${theme} at ${width}px`).toEqual([]);
        if (width !== 820) await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-${view}.png`) });
      }
      await workspaceView(page, "Sohbet"); await expect(draft).toHaveValue("Tasarım doğrulamasında korunacak soru taslağı");
    }
  });
}
