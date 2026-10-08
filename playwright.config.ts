import { defineConfig } from "@playwright/test";
const port = process.env.DELIBERATION_E2E_PORT ?? "3100";
if (!/^\d{4,5}$/u.test(port) || Number(port) < 1024 || Number(port) > 65535 || port === "3000") throw new Error("Invalid isolated browser port.");
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  globalSetup: "./tests/e2e/auth-setup.ts",
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
    storageState: ".local/e2e/session.json",
  },
  webServer: {
    command: "pnpm dev:e2e",
    url: origin,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
