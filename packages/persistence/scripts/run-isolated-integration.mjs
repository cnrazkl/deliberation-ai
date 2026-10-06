import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const repoRoot = resolve(import.meta.dirname, "../../..");
const benchmark = process.argv[2] === "knowledge-benchmark";
if (process.argv.length > 3 || process.argv[2] && !benchmark) throw new Error("Unsupported isolated verification mode.");
const envFile = readFileSync(resolve(repoRoot, ".env.local"), "utf8");
const localEnv = Object.fromEntries(envFile.split(/\r?\n/u)
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
if (!localEnv.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const name = `da_it_${randomBytes(8).toString("hex")}`;
const sourceUrl = new URL(localEnv.DATABASE_URL);
if (sourceUrl.protocol !== "postgresql:" || sourceUrl.hostname !== "127.0.0.1" ||
    sourceUrl.port !== "5432" || sourceUrl.pathname !== "/deliberation_ai" ||
    decodeURIComponent(sourceUrl.username) !== "deliberation") {
  throw new Error("Isolated integration tests require the provisioned local database.");
}
if (!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is required.");
const adminFile = readFileSync(resolve(process.env.LOCALAPPDATA, "DeliberationAI", "postgres-admin.local"), "utf8");
const adminPassword = adminFile.split(/\r?\n/u).find((line) => line.startsWith("POSTGRES_SUPERUSER_PASSWORD="))
  ?.slice("POSTGRES_SUPERUSER_PASSWORD=".length);
if (!adminPassword) throw new Error("Local PostgreSQL administrator secret is unavailable.");
const adminUrl = new URL(localEnv.DATABASE_URL);
adminUrl.pathname = "/postgres";
adminUrl.username = "postgres";
adminUrl.password = adminPassword;
const testUrl = new URL(localEnv.DATABASE_URL);
testUrl.pathname = `/${name}`;
const admin = new pg.Client({ connectionString: adminUrl.toString() });
let created = false;
let exitCode = 1;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}" OWNER deliberation TEMPLATE template0`);
  created = true;
  const env = { ...process.env, ...localEnv, DATABASE_URL: testUrl.toString(),
    DELIBERATION_KNOWLEDGE_BENCHMARK: benchmark ? "1" : "0" };
  const run = (command) => spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
    cwd: repoRoot, env, stdio: "inherit",
  });
  const migrated = run("pnpm --filter @deliberation-ai/persistence db:migrate");
  if (migrated.error || migrated.status !== 0) throw migrated.error ?? new Error("Isolated migrations failed.");
  const tested = run(benchmark ? "pnpm exec vitest run --config vitest.integration.config.ts packages/persistence/src/knowledge-benchmark.integration.test.ts"
    : "pnpm exec vitest run --config vitest.integration.config.ts");
  if (tested.error) throw tested.error;
  exitCode = tested.status ?? 1;
} finally {
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
process.exitCode = exitCode;
