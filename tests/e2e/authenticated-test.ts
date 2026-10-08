import { readFileSync } from "node:fs";
import { test as base } from "@playwright/test";
export { expect } from "@playwright/test";
export const testOrigin = `http://127.0.0.1:${process.env.DELIBERATION_E2E_PORT ?? "3100"}`;
export function testOwnerId(): string { return (JSON.parse(readFileSync(".local/e2e/owner.json", "utf8")) as { ownerId: string }).ownerId; }
export const test = base.extend({
  request: async ({ playwright, baseURL }, use) => {
    const { ownerId } = JSON.parse(readFileSync(".local/e2e/owner.json", "utf8")) as { ownerId: string };
    const request = await playwright.request.newContext({ baseURL, storageState: ".local/e2e/session.json", extraHTTPHeaders: { "X-Deliberation-Owner": ownerId } });
    try { await use(request); } finally { await request.dispose(); }
  },
});
