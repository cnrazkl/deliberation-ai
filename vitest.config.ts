import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/web/src/lib/**/*.test.ts"],
    exclude: ["**/node_modules/**", "packages/**/*.integration.test.ts"],
    coverage: {
      include: ["packages/{contracts,domain,providers,application}/src/**/*.ts"],
    },
  },
});
