import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const action = process.argv[2];
if (!new Set(["start", "status", "stop"]).has(action)) {
  throw new Error("Expected one of: start, status, stop.");
}

const localDataRoot = join(process.env.LOCALAPPDATA ?? "", "DeliberationAI");
const postgresRoot = join(localDataRoot, "postgresql-18.6");
const dataPath = join(postgresRoot, "data");
const pgCtlPath = join(postgresRoot, "pgsql", "bin", "pg_ctl.exe");
const logPath = join(postgresRoot, "postgresql.log");

if (!existsSync(pgCtlPath) || !existsSync(dataPath)) {
  throw new Error(`Portable PostgreSQL was not found at ${postgresRoot}.`);
}
mkdirSync(postgresRoot, { recursive: true });

const args =
  action === "start"
    ? ["-D", dataPath, "-l", logPath, "-o", "-h 127.0.0.1 -p 5432", "start", "-w"]
    : action === "stop"
      ? ["-D", dataPath, "stop", "-m", "fast", "-w"]
      : ["-D", dataPath, "status"];

const result = spawnSync(pgCtlPath, args, { stdio: "inherit", shell: false });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
