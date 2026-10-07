import { spawn } from "node:child_process";
import { join } from "node:path";
const root = process.cwd(), role = process.argv[2], identity = process.argv[3];
if (!identity || !/^[a-f0-9-]{36}$/u.test(identity) || !["web", "worker"].includes(role ?? "")) throw new Error("Runtime wrapper identity invalid.");
const args = role === "web" ? [join(root, "apps/web/node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3000"]
  : [join(root, "node_modules/tsx/dist/cli.mjs"), "watch", join(root, "apps/worker/src/index.ts")];
const child = spawn(process.execPath, args, { cwd: role === "web" ? join(root, "apps/web") : root, env: process.env, windowsHide: true, stdio: "inherit" });
child.on("error", () => { console.error("Runtime child could not start."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
process.once("SIGTERM", () => child.kill("SIGTERM")); process.once("SIGINT", () => child.kill("SIGINT"));
