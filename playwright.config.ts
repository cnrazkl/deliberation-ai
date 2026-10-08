import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  globalSetup: "./tests/e2e/auth-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    storageState: ".local/e2e/session.json",
    extraHTTPHeaders: { "X-Deliberation-Owner": "local-owner" },
  },
  webServer: {
    command: "pnpm dev:e2e",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
