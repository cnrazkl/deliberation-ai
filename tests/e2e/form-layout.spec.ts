import { expect, test } from "./authenticated-test";
import { revealCouncilControls, workspaceView } from "./workspace-navigation";

for (const theme of ["light", "dark"] as const) for (const width of [320, 960, 1440]) {
  test(`settings and council form controls have spacing at ${width}px in ${theme}`, async ({ page }, info) => {
    let mutations = 0;
    page.on("request", request => { if (request.method() !== "GET" && !request.url().includes("/api/token-preview")) mutations += 1; });
    await page.setViewportSize({ width, height: 975 });
    await page.goto("/");
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await workspaceView(page, "Ayarlar");
    const defaults = page.getByRole("region", { name: "Özel yanıt varsayılanı" });
    await expect(defaults.getByRole("combobox")).toBeVisible();
    const gaps = await defaults.evaluate(section => {
      const field = section.querySelector("label")!.getBoundingClientRect(), actions = section.querySelector(".private-output-actions")!.getBoundingClientRect();
      const buttons = Array.from(section.querySelectorAll("button")).map(button => button.getBoundingClientRect());
      return { field: actions.top - field.bottom, actions: Math.max(buttons[1]!.left - buttons[0]!.right, buttons[1]!.top - buttons[0]!.bottom), heights: buttons.map(button => button.height) };
    });
    expect(gaps.field).toBeGreaterThanOrEqual(15); expect(gaps.actions).toBeGreaterThanOrEqual(11);
    expect(gaps.heights.every(height => height >= 44)).toBe(true);
    await page.getByRole("button", { name: "Yeni Bağlantı Ekle", exact: true }).click();
    const form = page.locator(".connection-form");
    await expect(form.getByRole("button", { name: "Modelleri getir", exact: true })).toBeDisabled();
    await expect(form.getByLabel("Düşünme parametresi")).not.toBeVisible();
    await form.getByText("Gelişmiş uç nokta ayarları", { exact: true }).click();
    await expect(form.getByLabel("Düşünme parametresi")).toBeVisible();
    await form.screenshot({ path: info.outputPath(`connection-${theme}-${width}.png`) });
    await workspaceView(page, "Sohbet"); await revealCouncilControls(page);
    const prompt = page.getByRole("region", { name: "İstem sürümleri" });
    await prompt.getByRole("radio", { name: "Düzenlenebilir adayı kullan" }).focus(); await page.keyboard.press("Space");
    await expect(prompt.getByRole("radio", { name: "Düzenlenebilir adayı kullan" })).toBeChecked();
    await expect(prompt.getByRole("radio", { name: "Özgün soruyu kullan" })).not.toBeChecked();
    await prompt.getByRole("radio", { name: "Özgün soruyu kullan" }).check();
    const issues = await page.locator("#workspace-content").evaluate(main => {
      const issues: string[] = [];
      const visible = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
      for (const group of main.querySelectorAll(".prompt-revision-editor, .prompt-choice, .form-options")) {
        const children = Array.from(group.children).filter(visible);
        for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
          const a = children[i]!.getBoundingClientRect(), b = children[j]!.getBoundingClientRect();
          const gap = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
          if (gap < 10) issues.push(`Crowded controls: ${group.className}`);
        }
      }
      for (const label of main.querySelectorAll(".prompt-choice .check-row, .council-config .checkbox-label, .attachment-member-control .check-row")) {
        if (!visible(label)) continue;
        const input = label.querySelector("input")!.getBoundingClientRect(), text = label.querySelector("span")!.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
        if (text.left - input.right < 10) issues.push("Selection touches its text");
        if (Math.abs(input.top + input.height / 2 - (text.top + lineHeight / 2)) > 3) issues.push("Selection is not aligned with its first line");
        if (label.getBoundingClientRect().height < 44) issues.push("Small selection target");
      }
      for (const element of main.querySelectorAll(".prompt-revision-editor *, .council-config *, .memory-card *")) {
        if (!visible(element)) continue;
        const box = element.getBoundingClientRect();
        if (box.left < -1 || box.right > innerWidth + 1) issues.push(`Overflow: ${element.tagName}`);
      }
      return issues;
    });
    expect(issues).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await prompt.screenshot({ path: info.outputPath(`prompt-${theme}-${width}.png`) });
    await page.locator(".council-config .form-options").screenshot({ path: info.outputPath(`council-${theme}-${width}.png`) });
    expect(mutations).toBe(0);
  });
}
