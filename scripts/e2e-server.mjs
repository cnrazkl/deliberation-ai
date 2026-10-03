import { spawnSync } from "node:child_process";

// Apply after local env loading: the test origin/output cannot inherit port 3000.
const args = ["--parallel", "--filter", "@deliberation-ai/web", "--filter", "@deliberation-ai/worker", "run", "dev:e2e"];
const windows = process.platform === "win32";
const result = spawnSync(windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
  windows ? ["/d", "/s", "/c", `pnpm ${args.join(" ")}`] : args, {
    cwd: process.cwd(),
    env: { ...process.env, APP_ORIGIN: "http://127.0.0.1:3100", DELIBERATION_E2E: "1", DELIBERATION_VERIFY_BUILD: "0" },
    stdio: "inherit",
  });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
