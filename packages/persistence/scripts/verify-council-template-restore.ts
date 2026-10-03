import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Client } from "pg";
import { eq } from "drizzle-orm";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { closeDatabase, getDatabase } from "../src/database";
import { councilTemplates } from "../src/schema";
import { saveCouncilTemplate, listCouncilTemplates, previewCouncilTemplateDeletion, deleteCouncilTemplateContent, CouncilTemplateConflictError } from "../src/council-templates";
import { auditRestoredEncryption } from "./backup-encryption-audit";

// Only generated records in two newly created databases; never dump/restore over owner data.
async function main() {
  const originalUrl = process.env.DATABASE_URL;
  const localRoot = process.env.LOCALAPPDATA;
  if (!originalUrl || !localRoot) throw new Error("Local database configuration is required.");
  const source = new URL(originalUrl);
  if (source.hostname !== "127.0.0.1" || source.port !== "5432" || source.pathname !== "/deliberation_ai" || source.username !== "deliberation") throw new Error("Provisioned loopback database required.");
  const repo = resolve(import.meta.dirname, "../../..");
  const suffix = randomUUID().replaceAll("-", "");
  const sourceName = `da108_fixture_${suffix}`; const restoredName = `da108_restore_${suffix}`;
  const scratch = resolve(repo, ".local", "restore-verification");
  await mkdir(scratch, { recursive: true }); const archive = resolve(scratch, `${suffix}.dump`);
  const adminFile = await readFile(join(localRoot, "DeliberationAI", "postgres-admin.local"), "utf8");
  const password = adminFile.split(/\r?\n/).find((line) => line.startsWith("POSTGRES_SUPERUSER_PASSWORD="))?.slice("POSTGRES_SUPERUSER_PASSWORD=".length);
  if (!password) throw new Error("Local administrator configuration unavailable.");
  const adminUrl = new URL(source); adminUrl.username = "postgres"; adminUrl.password = password; adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  const created: string[] = []; let archiveWritten = false;
  const pgEnv = (database: string) => ({ ...process.env, PGHOST: "127.0.0.1", PGPORT: "5432", PGUSER: "deliberation",
    PGPASSWORD: decodeURIComponent(source.password), PGDATABASE: database });
  const pgTool = (tool: string, args: string[], database: string) => {
    const result = spawnSync(join(localRoot, "DeliberationAI", "postgresql-18.6", "pgsql", "bin", `${tool}.exe`), args,
      { env: pgEnv(database), windowsHide: true, encoding: "utf8", timeout: 60_000 });
    if (result.error || result.status !== 0) throw new Error("Disposable archive command failed.");
  };
  try {
    await admin.connect();
    for (const name of [sourceName, restoredName]) { await admin.query(`CREATE DATABASE "${name}" OWNER deliberation TEMPLATE template0`); created.push(name); }
    const sourceUrl = new URL(source); sourceUrl.pathname = `/${sourceName}`; process.env.DATABASE_URL = sourceUrl.toString();
    const migration = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm --filter @deliberation-ai/persistence db:migrate"],
      { cwd: repo, env: process.env, windowsHide: true, encoding: "utf8", timeout: 60_000 });
    if (migration.error || migration.status !== 0) throw new Error("Disposable migrations failed.");
    const input = { requestId: randomUUID(), name: "Generated archive template", description: "Synthetic restore fixture", members: defaultFakeCouncilMembers };
    const template = await saveCouncilTemplate(input);
    const preview = (await previewCouncilTemplateDeletion(template.id))!; assert.equal(preview.eligible, true);
    const receipt = await deleteCouncilTemplateContent(template.id, preview.fingerprint!);
    const [before] = await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, template.id));
    await closeDatabase();
    pgTool("pg_dump", ["--format=custom", "--no-owner", "--file", archive, sourceName], sourceName); archiveWritten = true;
    pgTool("pg_restore", ["--no-owner", "--no-acl", "--dbname", restoredName, archive], restoredName);
    const restoredUrl = new URL(source); restoredUrl.pathname = `/${restoredName}`; process.env.DATABASE_URL = restoredUrl.toString();
    const client = new Client({ connectionString: restoredUrl.toString() }); await client.connect();
    try { assert.ok((await auditRestoredEncryption(client)).decryptedValues >= 2); } finally { await client.end(); }
    const [after] = await getDatabase().select().from(councilTemplates).where(eq(councilTemplates.id, template.id));
    assert.deepEqual(after, before);
    assert.equal((await listCouncilTemplates()).length, 0);
    assert.deepEqual(await deleteCouncilTemplateContent(template.id, preview.fingerprint!), receipt);
    await assert.rejects(saveCouncilTemplate(input), CouncilTemplateConflictError);
    const reused = await saveCouncilTemplate({ ...input, requestId: randomUUID() }); assert.notEqual(reused.id, template.id);
    await assert.rejects(saveCouncilTemplate(input), CouncilTemplateConflictError);
    console.log("Synthetic custom archive restore verified: identical ciphertext/receipt, hidden tombstone, blocked original intent and fresh name reuse.");
  } finally {
    await closeDatabase(); process.env.DATABASE_URL = originalUrl;
    for (const name of created) {
      if (!/^da108_(fixture|restore)_[a-f0-9]{32}$/.test(name)) throw new Error("Unexpected disposable database identity.");
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await admin.end();
    if (archiveWritten) await unlink(archive);
  }
}
main().catch(() => { console.error("Synthetic template restore verification failed; no owner restore was attempted."); process.exitCode = 1; });
