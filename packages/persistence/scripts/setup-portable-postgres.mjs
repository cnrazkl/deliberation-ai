import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const appEnvPath = join(repositoryRoot, ".env.local");
const localDataRoot = join(process.env.LOCALAPPDATA ?? "", "DeliberationAI");
const adminSecretPath = join(localDataRoot, "postgres-admin.local");
const postgresRoot = join(localDataRoot, "postgresql-18.6");
const hbaPath = join(postgresRoot, "data", "pg_hba.conf");
const pgCtlPath = join(postgresRoot, "pgsql", "bin", "pg_ctl.exe");

function parseEnv(text) {
  return new Map(
    text
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

const appEnv = parseEnv(await readFile(appEnvPath, "utf8"));
const adminEnv = parseEnv(await readFile(adminSecretPath, "utf8"));
const databaseUrl = appEnv.get("DATABASE_URL");
const adminPassword = adminEnv.get("POSTGRES_SUPERUSER_PASSWORD");

if (!databaseUrl || !adminPassword) {
  throw new Error("Local database secrets are missing.");
}

const appUrl = new URL(databaseUrl);
const appPassword = decodeURIComponent(appUrl.password);
const adminClient = new Client({
  host: "127.0.0.1",
  port: 5432,
  user: "postgres",
  database: "postgres",
});

await adminClient.connect();
try {
  const quotedAdmin = await adminClient.query("select quote_literal($1) as value", [adminPassword]);
  const quotedApp = await adminClient.query("select quote_literal($1) as value", [appPassword]);
  await adminClient.query(`alter role postgres password ${quotedAdmin.rows[0].value}`);

  const role = await adminClient.query("select 1 from pg_roles where rolname = $1", ["deliberation"]);
  if (role.rowCount === 0) {
    await adminClient.query(`create role deliberation login password ${quotedApp.rows[0].value}`);
  } else {
    await adminClient.query(`alter role deliberation login password ${quotedApp.rows[0].value}`);
  }

  const database = await adminClient.query("select 1 from pg_database where datname = $1", ["deliberation_ai"]);
  if (database.rowCount === 0) {
    await adminClient.query("create database deliberation_ai owner deliberation");
  }
} finally {
  await adminClient.end();
}

const originalHba = await readFile(hbaPath, "utf8");
const securedHba = originalHba
  .split(/\r?\n/u)
  .map((line) =>
    line.trimStart().startsWith("#") ? line : line.replace(/\btrust\s*$/u, "scram-sha-256"),
  )
  .join("\n");
if (securedHba !== originalHba) {
  await writeFile(hbaPath, securedHba, "utf8");
}

execFileSync(pgCtlPath, ["-D", join(postgresRoot, "data"), "reload"], { stdio: "ignore" });

const appClient = new Client({ connectionString: databaseUrl });
await appClient.connect();
try {
  const verification = await appClient.query(
    "select current_database() as database, current_user as role, current_setting('server_version') as version",
  );
  const row = verification.rows[0];
  console.log(`PostgreSQL ${row.version}; database=${row.database}; role=${row.role}; auth=scram-sha-256`);
} finally {
  await appClient.end();
}
