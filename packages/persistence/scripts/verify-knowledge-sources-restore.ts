import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Client } from "pg";
import { asc, eq } from "drizzle-orm";

import { closeDatabase, getDatabase } from "../src/database";
import { conversations, knowledgeCollections, conversationKnowledge, knowledgeSourceVersions } from "../src/schema";
import { createKnowledgeCollection, changeKnowledgeGrant, setConversationKnowledge, exportConversationKnowledge, exportKnowledgeCollection, authorizeKnowledgeScope } from "../src/knowledge-scope";
import { importKnowledgeFiles, exportKnowledgeVersion, searchLocalKnowledge, selectKnowledgeExcerpt, LocalKnowledgeSource } from "../src/knowledge-sources";
import { auditRestoredEncryption } from "./backup-encryption-audit";
import { benchmarkKnowledgeSources } from "./benchmark-knowledge-sources";

// Only generated records in two newly created databases; never dump/restore over owner data.
async function main() {
  const originalUrl = process.env.DATABASE_URL;
  const localRoot = process.env.LOCALAPPDATA;
  if (!originalUrl || !localRoot) throw new Error("Local database configuration is required.");
  const source = new URL(originalUrl);
  if (source.hostname !== "127.0.0.1" || source.port !== "5432" || source.pathname !== "/deliberation_ai" || source.username !== "deliberation") throw new Error("Provisioned loopback database required.");
  const repo = resolve(import.meta.dirname, "../../..");
  const suffix = randomUUID().replaceAll("-", "");
  const sourceName = `da121_fixture_${suffix}`; const restoredName = `da121_restore_${suffix}`;
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
    const collection = await createKnowledgeCollection("Synthetic archive collection");
    const scope = await changeKnowledgeGrant(collection.id, 1, "active");
    const conversationId = randomUUID();
    await getDatabase().insert(conversations).values({ id: conversationId, ownerId: "local-owner", anchorRunId: randomUUID(), origin: "native" });
    const revision = await setConversationKnowledge(conversationId, null, { topic: "Synthetic archive topic", scopes: [scope] });
    const sourceId = randomUUID(), pdfId = randomUUID(), scanId = randomUUID(), imageId = randomUUID();
    const input = { sourceId, expectedVersionId: null, name: "generated.txt", mediaType: "text/plain" as const, bytes: Buffer.from("Synthetic minority source remains inspectable.") };
    const imported = await importKnowledgeFiles(scope, [input,
      { sourceId: pdfId, expectedVersionId: null, name: "table.pdf", mediaType: "application/pdf", bytes: await readFile(resolve(repo, "docs/evaluation/knowledge-fixtures/support-table.pdf")) },
      { sourceId: scanId, expectedVersionId: null, name: "scan.pdf", mediaType: "application/pdf", bytes: await readFile(resolve(repo, "docs/evaluation/knowledge-fixtures/scanned-support.pdf")) },
      { sourceId: imageId, expectedVersionId: null, name: "image.png", mediaType: "image/png", bytes: await readFile(resolve(repo, "docs/evaluation/knowledge-fixtures/ambiguous-support.png")) }]);
    const originalExport = await exportKnowledgeVersion(scope, sourceId, imported[0]!.versionId);
    const quote = await selectKnowledgeExcerpt(scope, sourceId, imported[0]!.versionId, 0, 25, null);
    const [updated] = await importKnowledgeFiles(scope, [{ ...input, expectedVersionId: imported[0]!.versionId, bytes: Buffer.from("Updated canonical source.") }]);
    await benchmarkKnowledgeSources();
    const beforeVersions = await getDatabase().select().from(knowledgeSourceVersions).orderBy(asc(knowledgeSourceVersions.id));
    const revoked = await changeKnowledgeGrant(collection.id, scope.grantRevision, "revoked");
    const exported = await exportConversationKnowledge(conversationId);
    const collectionExport = await exportKnowledgeCollection(collection.id);
    const [beforeCollection] = await getDatabase().select().from(knowledgeCollections).where(eq(knowledgeCollections.id, collection.id));
    const [beforeSelection] = await getDatabase().select().from(conversationKnowledge).where(eq(conversationKnowledge.conversationId, conversationId));
    await closeDatabase();
    pgTool("pg_dump", ["--format=custom", "--no-owner", "--file", archive, sourceName], sourceName); archiveWritten = true;
    pgTool("pg_restore", ["--no-owner", "--no-acl", "--dbname", restoredName, archive], restoredName);
    const restoredUrl = new URL(source); restoredUrl.pathname = `/${restoredName}`; process.env.DATABASE_URL = restoredUrl.toString();
    const client = new Client({ connectionString: restoredUrl.toString() }); await client.connect();
    try { assert.ok((await auditRestoredEncryption(client)).decryptedValues >= 2); } finally { await client.end(); }
    const [afterCollection] = await getDatabase().select().from(knowledgeCollections).where(eq(knowledgeCollections.id, collection.id));
    const [afterSelection] = await getDatabase().select().from(conversationKnowledge).where(eq(conversationKnowledge.conversationId, conversationId));
    assert.deepEqual(afterCollection, beforeCollection); assert.deepEqual(afterSelection, beforeSelection);
    assert.deepEqual(await exportKnowledgeCollection(collection.id), collectionExport);
    assert.deepEqual(await exportConversationKnowledge(conversationId), exported);
    assert.equal(await authorizeKnowledgeScope(scope), false);
    assert.equal(exported?.revision, revision); assert.equal(exported?.grants[0]?.available, false);
    assert.deepEqual(await getDatabase().select().from(knowledgeSourceVersions).orderBy(asc(knowledgeSourceVersions.id)), beforeVersions);
    await assert.rejects(exportKnowledgeVersion(scope, sourceId, imported[0]!.versionId));
    const renewed = await changeKnowledgeGrant(collection.id, revoked.grantRevision, "active");
    assert.deepEqual(await exportKnowledgeVersion(renewed, sourceId, imported[0]!.versionId), originalExport);
    assert.deepEqual(await new LocalKnowledgeSource().readExcerpt(renewed, sourceId, imported[0]!.versionId, quote.excerptId), { ...quote, source: { ...quote.source, scope: renewed } });
    assert.equal((await searchLocalKnowledge([renewed], "updated")).hits[0]?.source.versionId, updated!.versionId);
    assert.equal((await searchLocalKnowledge([renewed], "source")).unavailableSources, 2);
    console.log("Synthetic source restore verified: identical originals/versions/page hashes, pinned old quote, latest search and revoked scope denial.");
  } finally {
    await closeDatabase(); process.env.DATABASE_URL = originalUrl;
    for (const name of created) {
      if (!/^da121_(fixture|restore)_[a-f0-9]{32}$/.test(name)) throw new Error("Unexpected disposable database identity.");
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await admin.end();
    if (archiveWritten) await unlink(archive);
  }
}
main().catch(() => { console.error("Synthetic source restore verification failed; no owner restore was attempted."); process.exitCode = 1; });
