import { randomUUID } from "node:crypto";
import type { KnowledgePacket } from "@deliberation-ai/contracts";
import { expect, test, type Page, testOwnerId } from "./authenticated-test";

async function sourceFixtures(page: Page) {
  const collectionId = randomUUID(), conversationId = randomUUID(), revision = randomUUID();
  const scope = { ownerId: testOwnerId(), accountId: "local", collectionId, grantId: randomUUID(), grantRevision: 1 };
  const title = "Çok uzun proje koleksiyonu ".repeat(6).trim();
  const name = "kesintisiz-dosya-adı".repeat(8) + ".pdf";
  const text = "Kaynak pasajı: " + "kesintisiz-alıntı".repeat(35);
  const source = { scope, sourceId: randomUUID(), versionId: randomUUID(), title: name, mediaType: "application/pdf" as const,
    originalHash: "a".repeat(64), textHash: "b".repeat(64), parserVersion: "layout-fixture" };
  const packet: KnowledgePacket = { version: "knowledge-packet-v1", id: randomUUID(), ownerId: scope.ownerId, conversationId,
    selectionRevision: revision, query: "destek", topic: "Uzun kaynaklarla düzen kontrolü", createdAt: "2026-10-09T00:00:00.000Z",
    scopes: [scope], policy: "lexical-fair-coverage-v1", inventory: [{ sourceId: source.sourceId, versionId: source.versionId }],
    excerpts: [{ source, excerptId: randomUUID(), text, start: 0, end: text.length, page: 1, textHash: source.textHash }],
    omissions: [{ collectionId, sourceId: randomUUID(), versionId: randomUUID(), title: name, reason: "duplicate" }],
    coverage: [{ collectionId, inspected: 3, unavailable: 1, matches: 2, selected: 1, omitted: 1 }], withoutEvidence: false, fingerprint: "c".repeat(64) };
  let bound = false;
  const operations: string[] = [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/auth/")) { await route.continue(); return; }
    if (url.pathname === "/api/knowledge") {
      const input = route.request().postDataJSON(); operations.push(input.operation);
      if (input.operation === "bind") bound = true;
      const results: Record<string, unknown> = {
        state: { collections: { items: [{ ...scope, title, grantStatus: "active" },
          { ...scope, collectionId: randomUUID(), title: "Okuma izni kapalı koleksiyon", grantStatus: "revoked" }], hasMore: false },
          selection: bound ? { revision, topic: packet.topic, grants: [{ scope, available: true }] } : null },
        conversation: { conversationId }, bind: {}, import: {},
        sources: { items: [{ ...source, name, status: "complete", reason: null },
          { ...source, sourceId: randomUUID(), name: "taranmış-belge.pdf", status: "extraction_unverified", reason: "missing_text_pages" }], nextCursor: null },
        prepare: packet,
      };
      // Layout fixtures never mutate persistence or send a provider request.
      await route.fulfill({ status: results[input.operation] ? 200 : 422, json: results[input.operation] ?? { error: "Unsupported fixture" } }); return;
    }
    const lists: Record<string, unknown> = {
      "/api/provider-connections": { connections: [] }, "/api/provider-operations": { operations: [] },
      "/api/council-templates": { templates: [] }, "/api/memory-entries": { entries: [] },
      "/api/mcp-connections": { connections: [] }, "/api/mcp-tool-results": { results: [] },
      "/api/preflight-drafts": { drafts: [] }, "/api/conversations": { conversations: [], nextCursor: null },
      "/api/runs": { runs: [], nextCursor: null }, "/api/local-schedules": { schedules: [] },
    };
    await route.fulfill({ status: lists[url.pathname] ? 200 : 404, json: lists[url.pathname] ?? { error: "No fixture" } });
  });
  return { collectionId, title, name, operations };
}

async function assertSourceGeometry(page: Page) {
  const issues = await page.locator(".knowledge-panel").evaluate(panel => {
    const issues: string[] = [];
    function visible(element: Element) { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
    for (const element of panel.querySelectorAll("*")) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect(), css = getComputedStyle(element);
      if (rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 2 && css.overflowX === "visible") issues.push(`Overflow: ${element.tagName}.${element.className}`);
      if (element.matches("button") && rect.height < 44) issues.push(`Small action: ${element.textContent}`);
    }
    // Catch crowded/overlapping controls as well as overflow, including wrapped rows.
    for (const group of panel.querySelectorAll(".knowledge-body, .knowledge-step, .knowledge-selection, .knowledge-field-action, .knowledge-actions")) {
      const children = Array.from(group.children).filter(visible);
      for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
        const a = children[i]!.getBoundingClientRect(), b = children[j]!.getBoundingClientRect();
        const gap = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
        if (gap < 10) issues.push(`Crowded siblings in ${group.className}: ${Math.round(gap)}px`);
      }
    }
    for (const field of panel.querySelectorAll(".knowledge-field")) {
      const range = document.createRange(); range.selectNodeContents(field.firstChild!);
      const label = range.getBoundingClientRect(), input = field.querySelector("input, select")!.getBoundingClientRect();
      if (input.top - label.bottom < 7) issues.push("Label touches field");
    }
    for (const label of panel.querySelectorAll(".knowledge-check")) {
      const checkbox = label.querySelector("input")!.getBoundingClientRect(), text = label.querySelector("span")!.getBoundingClientRect();
      if (text.left - checkbox.right < 10) issues.push("Checkbox touches text");
    }
    return issues;
  });
  expect(issues).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const theme of ["light", "dark"] as const) for (const width of [390, 960, 1440]) {
  test(`source steps and populated packet have spacing at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 918 });
    const fixture = await sourceFixtures(page); await page.goto("/");
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const panel = page.locator(".knowledge-panel"); await panel.locator("summary").click();
    await expect(panel.getByRole("heading", { level: 3 })).toHaveCount(3);
    await expect(panel.getByRole("button", { name: "Dosya seç", exact: true })).toBeDisabled();
    await assertSourceGeometry(page);
    await panel.getByRole("button", { name: "Koleksiyonları göster", exact: true }).click();
    await panel.getByRole("button", { name: "Yeni kaynak sohbeti", exact: true }).click();
    await panel.getByRole("checkbox", { name: `${fixture.title} · Okuma izni açık`, exact: true }).check();
    await panel.getByRole("button", { name: "Seçimi kaydet", exact: true }).click();
    await panel.getByRole("combobox", { name: "Dosyaların kaydedileceği koleksiyon", exact: true }).selectOption(fixture.collectionId);
    const choosing = page.waitForEvent("filechooser");
    await panel.getByRole("button", { name: "Dosya seç", exact: true }).focus(); await page.keyboard.press("Enter");
    await (await choosing).setFiles({ name: "destek.txt", mimeType: "text/plain", buffer: Buffer.from("destek koşulları") });
    await expect(panel.getByRole("list", { name: "Eklenen dosyalar" })).toContainText(fixture.name);
    await expect(panel).toContainText("missing_text_pages");
    await panel.getByLabel("Arama sözcükleri", { exact: true }).fill("destek");
    await panel.getByRole("button", { name: "Kanıt paketini hazırla", exact: true }).click();
    const packet = panel.getByRole("region", { name: "Hazırlanan kaynak paketi" }); await expect(packet).toBeVisible();
    await assertSourceGeometry(page);
    await panel.screenshot({ path: testInfo.outputPath(`sources-${theme}-${width}.png`) });
    await packet.getByRole("checkbox").check();
    await panel.getByLabel("Arama sözcükleri", { exact: true }).fill("değişen sorgu");
    await expect(packet).toHaveCount(0);
    expect(fixture.operations.filter(operation => operation === "import")).toHaveLength(1);
    expect(fixture.operations.filter(operation => operation === "prepare")).toHaveLength(1);
  });
}
