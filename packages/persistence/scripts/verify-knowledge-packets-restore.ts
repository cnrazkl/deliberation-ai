import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, unlink, copyFile, writeFile, rm } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { Client } from "pg";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closeDatabase, getDatabase } from "../src/database";
import { conversations, knowledgeCollections, conversationKnowledge, knowledgeSourceVersions } from "../src/schema";
import { createKnowledgeCollection, changeKnowledgeGrant, setConversationKnowledge, exportConversationKnowledge, exportKnowledgeCollection, authorizeKnowledgeScope } from "../src/knowledge-scope";
import { importKnowledgeFiles, exportKnowledgeVersion, searchLocalKnowledge, selectKnowledgeExcerpt, LocalKnowledgeSource } from "../src/knowledge-sources";
import { auditRestoredEncryption } from "./backup-encryption-audit";
import { prepareKnowledgePacket, loadKnowledgePacket } from "../src/knowledge-packets";
import { enqueueDurableRun, executeDurableRun, findDurableRunById } from "../src/run-repository";
import { createEvidenceCandidate, listEvidenceCandidates } from "../src/evidence-candidates";
import { updateEvidenceSourceReview } from "../src/evidence-sources";
import { closeBoss } from "../src/queue";
import { commitEvidencePublication, previewEvidencePublication, listEvidencePublications, acknowledgeManualEvidencePublication } from "../src/evidence-publications";
import { buildRoundZeroPromptPlan, buildRiskPreflight } from "@deliberation-ai/application";
import { createRunRequestSchema, defaultFakeCouncilMembers } from "@deliberation-ai/contracts";

// Only generated records in two/three new databases; never dump/restore over owner data.
let verificationPhase = "setup";
async function main() {
  const upgrade = process.argv[2] === "upgrade";
  if (process.argv.length > 3 || (process.argv[2] && !upgrade)) throw new Error("Unsupported restore verification mode.");
  globalThis.fetch = async () => { throw new Error("Network calls are forbidden in generated recovery verification."); };
  const originalUrl = process.env.DATABASE_URL;
  const localRoot = process.env.LOCALAPPDATA;
  if (!originalUrl || !localRoot) throw new Error("Local database configuration is required.");
  const source = new URL(originalUrl);
  if (source.hostname !== "127.0.0.1" || source.port !== "5432" || source.pathname !== "/deliberation_ai" || source.username !== "deliberation") throw new Error("Provisioned loopback database required.");
  const repo = resolve(import.meta.dirname, "../../..");
  const suffix = randomUUID().replaceAll("-", "");
  const sourceName = `da122_fixture_${suffix}`; const restoredName = `da122_restore_${suffix}`;
  const rollbackName = `da122_rollback_${suffix}`;
  const scratch = resolve(repo, ".local", "restore-verification");
  await mkdir(scratch, { recursive: true }); const archive = resolve(scratch, `${suffix}.dump`);
  const baselineArchive = resolve(scratch, `${suffix}-baseline.dump`);
  const baselineFolder = resolve(scratch, `${suffix}-baseline`);
  const adminFile = await readFile(join(localRoot, "DeliberationAI", "postgres-admin.local"), "utf8");
  const password = adminFile.split(/\r?\n/).find((line) => line.startsWith("POSTGRES_SUPERUSER_PASSWORD="))?.slice("POSTGRES_SUPERUSER_PASSWORD=".length);
  if (!password) throw new Error("Local administrator configuration unavailable.");
  const adminUrl = new URL(source); adminUrl.username = "postgres"; adminUrl.password = password; adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  const created: string[] = []; let archiveWritten = false, baselineWritten = false, baselineFolderCreated = false;
  const pgEnv = (database: string) => ({ ...process.env, PGHOST: "127.0.0.1", PGPORT: "5432", PGUSER: "deliberation",
    PGPASSWORD: decodeURIComponent(source.password), PGDATABASE: database });
  const pgTool = (tool: string, args: string[], database: string) => {
    const result = spawnSync(join(localRoot, "DeliberationAI", "postgresql-18.6", "pgsql", "bin", `${tool}.exe`), args,
      { env: pgEnv(database), windowsHide: true, encoding: "utf8", timeout: 60_000 });
    if (result.error || result.status !== 0) throw new Error("Disposable archive command failed.");
  };
  try {
    await admin.connect();
    for (const name of [sourceName, restoredName, ...(upgrade ? [rollbackName] : [])]) { await admin.query(`CREATE DATABASE "${name}" OWNER deliberation TEMPLATE template0`); created.push(name); }
    const sourceUrl = new URL(source); sourceUrl.pathname = `/${sourceName}`; process.env.DATABASE_URL = sourceUrl.toString();
    const migrateCurrent = () => {
      const migration = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm --filter @deliberation-ai/persistence db:migrate"],
        { cwd: repo, env: process.env, windowsHide: true, encoding: "utf8", timeout: 60_000 });
      if (migration.error || migration.status !== 0) throw new Error("Disposable migrations failed.");
    };
    if (upgrade) {
      verificationPhase = "baseline-migrations";
      const migrationRoot = resolve(repo, "packages/persistence/drizzle");
      const journal = JSON.parse(await readFile(resolve(migrationRoot, "meta/_journal.json"), "utf8")) as {
        entries: { idx: number; tag: string }[];
      };
      if (journal.entries.at(-1)?.idx !== 54 || journal.entries.at(-2)?.idx !== 53) throw new Error("Review the rehearsal after migration inventory changes.");
      const baselineEntries = journal.entries.filter((entry) => entry.idx <= 53);
      if (baselineEntries.some((entry) => !/^\d{4}_[a-z0-9_]+$/.test(entry.tag))) throw new Error("Invalid migration inventory.");
      await mkdir(resolve(baselineFolder, "meta"), { recursive: true }); baselineFolderCreated = true;
      await writeFile(resolve(baselineFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: baselineEntries }), { flag: "wx" });
      for (const entry of baselineEntries) await copyFile(resolve(migrationRoot, `${entry.tag}.sql`), resolve(baselineFolder, `${entry.tag}.sql`));
      await migrate(getDatabase(), { migrationsFolder: baselineFolder });
      assert.equal((await getDatabase().execute("select to_regclass('public.evidence_publications') as relation")).rows[0]?.relation, null);
    } else migrateCurrent();
    verificationPhase = "populate-fixtures";
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
    const packet = await prepareKnowledgePacket({ id: randomUUID(), conversationId, selectionRevision: revision!, query: "source", allowWithoutEvidence: false });
    const members = defaultFakeCouncilMembers.slice(0, 2), question = "Which synthetic source boundaries remain inspectable?";
    const plan = buildRoundZeroPromptPlan({ question, members, knowledgePacket: packet, memoryContext: [], toolContext: [], documents: [], images: [] });
    const risk = buildRiskPreflight({ question, documents: packet.excerpts.map((item) => ({ content: item.text })), memoryContext: [], toolContext: [], promptFingerprint: plan.fingerprint, reviewRounds: 0 });
    const run = await enqueueDurableRun(createRunRequestSchema.parse({ question, members, providerMode: "fake", reviewRounds: 0, idempotencyKey: randomUUID(), knowledgePacket: { id: packet.id, fingerprint: packet.fingerprint, reviewed: true }, expectedPreflightFingerprint: plan.fingerprint, expectedRiskFingerprint: risk.fingerprint }));
    const completed = (await executeDurableRun(run.runId))!;
    const claimId = [...completed.report!.sharedClaims, ...completed.report!.distinctClaims][0]!.claimId;
    const candidate = (await createEvidenceCandidate({ requestId: randomUUID(), runId: run.runId, claimId, origin: "local-excerpt",
      excerptId: packet.excerpts[0]!.excerptId, relation: "context" }))!;
    await updateEvidenceSourceReview(candidate.id, { reviewStatus: "verified", freshnessStatus: "current" });
    const baseline = upgrade ? {
      versions: await getDatabase().select().from(knowledgeSourceVersions).orderBy(asc(knowledgeSourceVersions.id)),
      collection: await exportKnowledgeCollection(collection.id), selection: await exportConversationKnowledge(conversationId),
      candidates: await listEvidenceCandidates(run.runId),
    } : null;
    if (upgrade) {
      verificationPhase = "upgrade-preservation";
      await closeBoss(); await closeDatabase();
      pgTool("pg_dump", ["--format=custom", "--no-owner", "--file", baselineArchive, sourceName], sourceName); baselineWritten = true;
      migrateCurrent();
      assert.deepEqual(await getDatabase().select().from(knowledgeSourceVersions).orderBy(asc(knowledgeSourceVersions.id)), baseline!.versions);
      assert.deepEqual(await exportKnowledgeCollection(collection.id), baseline!.collection);
      assert.deepEqual(await exportConversationKnowledge(conversationId), baseline!.selection);
      assert.deepEqual(await listEvidenceCandidates(run.runId), baseline!.candidates);
      assert.deepEqual((await findDurableRunById(run.runId))!.knowledgePacket, packet);
    }
    const localSave = { candidateId: candidate.id, destination: { kind: "local" as const, scope } };
    verificationPhase = "publication-fixtures";
    const localReview = await previewEvidencePublication(localSave);
    await commitEvidencePublication({ ...localSave, requestId: randomUUID(), fingerprint: localReview.fingerprint, consent: true });
    const manualSave = { candidateId: candidate.id, destination: { kind: "manual" as const, name: "Synthetic handoff", account: "Synthetic account", url: "https://example.invalid/notebook" } };
    const manualReview = await previewEvidencePublication(manualSave);
    const manualReceipt = await commitEvidencePublication({ ...manualSave, requestId: randomUUID(), fingerprint: manualReview.fingerprint, consent: true });
    await acknowledgeManualEvidencePublication(manualReceipt.id);
    const beforePublications = await listEvidencePublications(run.runId);
    await updateEvidenceSourceReview(candidate.id, { reviewStatus: "rejected", freshnessStatus: "stale" });
    await closeBoss();
    const beforeVersions = await getDatabase().select().from(knowledgeSourceVersions).orderBy(asc(knowledgeSourceVersions.id));
    const revoked = await changeKnowledgeGrant(collection.id, scope.grantRevision, "revoked");
    const candidateExport = await listEvidenceCandidates(run.runId);
    const exported = await exportConversationKnowledge(conversationId);
    const collectionExport = await exportKnowledgeCollection(collection.id);
    const [beforeCollection] = await getDatabase().select().from(knowledgeCollections).where(eq(knowledgeCollections.id, collection.id));
    const [beforeSelection] = await getDatabase().select().from(conversationKnowledge).where(eq(conversationKnowledge.conversationId, conversationId));
    await closeDatabase();
    verificationPhase = "current-archive-restore";
    pgTool("pg_dump", ["--format=custom", "--no-owner", "--file", archive, sourceName], sourceName); archiveWritten = true;
    pgTool("pg_restore", ["--no-owner", "--no-acl", "--dbname", restoredName, archive], restoredName);
    const restoredUrl = new URL(source); restoredUrl.pathname = `/${restoredName}`; process.env.DATABASE_URL = restoredUrl.toString();
    const client = new Client({ connectionString: restoredUrl.toString() }); await client.connect();
    verificationPhase = "current-encryption-audit";
    try { assert.ok((await auditRestoredEncryption(client)).decryptedValues >= 2); } finally { await client.end(); }
    const [afterCollection] = await getDatabase().select().from(knowledgeCollections).where(eq(knowledgeCollections.id, collection.id));
    const [afterSelection] = await getDatabase().select().from(conversationKnowledge).where(eq(conversationKnowledge.conversationId, conversationId));
    verificationPhase = "current-scope-equality";
    assert.deepEqual(afterCollection, beforeCollection); assert.deepEqual(afterSelection, beforeSelection);
    assert.deepEqual(await exportKnowledgeCollection(collection.id), collectionExport);
    assert.deepEqual(await exportConversationKnowledge(conversationId), exported);
    assert.equal(await authorizeKnowledgeScope(scope), false);
    verificationPhase = "current-packet-equality";
    assert.deepEqual((await findDurableRunById(run.runId))!.knowledgePacket, packet);
    assert.deepEqual(await listEvidenceCandidates(run.runId), candidateExport);
    verificationPhase = "current-publication-equality";
    assert.deepEqual(await listEvidencePublications(run.runId), beforePublications);
    assert.equal(candidateExport![0]!.availability, "inaccessible");
    await assert.rejects(loadKnowledgePacket({ id: packet.id, fingerprint: packet.fingerprint, reviewed: true }));
    assert.equal(exported?.revision, revision); assert.equal(exported?.grants[0]?.available, false);
    assert.deepEqual(await getDatabase().select().from(knowledgeSourceVersions).orderBy(asc(knowledgeSourceVersions.id)), beforeVersions);
    await assert.rejects(exportKnowledgeVersion(scope, sourceId, imported[0]!.versionId));
    verificationPhase = "current-renewal-quotes";
    const renewed = await changeKnowledgeGrant(collection.id, revoked.grantRevision, "active");
    verificationPhase = "current-original-bytes";
    assert.deepEqual(await exportKnowledgeVersion(renewed, sourceId, imported[0]!.versionId), originalExport);
    verificationPhase = "current-historical-quote";
    assert.deepEqual(await new LocalKnowledgeSource().readExcerpt(renewed, sourceId, imported[0]!.versionId, quote.excerptId), { ...quote, source: { ...quote.source, scope: renewed } });
    verificationPhase = "current-latest-search";
    const latestSearch = await searchLocalKnowledge([renewed], "updated");
    // Reusable save adds another matching source; UUID order is not source identity.
    assert.ok(latestSearch.hits.some((hit) => hit.source.sourceId !== sourceId));
    assert.equal(latestSearch.hits.find((hit) => hit.source.sourceId === sourceId)?.source.versionId, updated!.versionId);
    verificationPhase = "current-unverified-extraction";
    assert.equal((await searchLocalKnowledge([renewed], "source")).unavailableSources, 2);
    if (upgrade) {
      verificationPhase = "baseline-archive-rollback";
      await closeBoss(); await closeDatabase();
      pgTool("pg_restore", ["--no-owner", "--no-acl", "--dbname", rollbackName, baselineArchive], rollbackName);
      const rollbackUrl = new URL(source); rollbackUrl.pathname = `/${rollbackName}`; process.env.DATABASE_URL = rollbackUrl.toString();
      const rollbackClient = new Client({ connectionString: rollbackUrl.toString() }); await rollbackClient.connect();
      try {
        assert.equal((await rollbackClient.query("select to_regclass('public.evidence_publications') as relation")).rows[0].relation, null);
        assert.equal(Number((await rollbackClient.query("select max(created_at) as last from drizzle.__drizzle_migrations")).rows[0].last),
          (JSON.parse(await readFile(resolve(repo, "packages/persistence/drizzle/meta/_journal.json"), "utf8")) as { entries: { idx: number; when: number }[] }).entries.find((entry) => entry.idx === 53)!.when);
        assert.ok((await auditRestoredEncryption(rollbackClient)).decryptedValues >= 2);
      } finally { await rollbackClient.end(); }
      assert.deepEqual(await getDatabase().select().from(knowledgeSourceVersions).orderBy(asc(knowledgeSourceVersions.id)), baseline!.versions);
      assert.deepEqual(await exportKnowledgeCollection(collection.id), baseline!.collection);
      assert.deepEqual(await exportConversationKnowledge(conversationId), baseline!.selection);
      assert.deepEqual(await listEvidenceCandidates(run.runId), baseline!.candidates);
      assert.deepEqual((await findDurableRunById(run.runId))!.knowledgePacket, packet);
      assert.deepEqual(await exportKnowledgeVersion(scope, sourceId, imported[0]!.versionId), originalExport);
      assert.equal(await authorizeKnowledgeScope(scope), true);
      console.log("Generated 0053-to-0054 upgrade and pre-upgrade archive rollback verified; no old application binary or owner database was used.");
    }
    console.log("Synthetic packet, candidate and source restore verified: immutable quote/provenance, separate human decisions, latest search and revoked scope denial.");
  } finally {
    const completedPhase = verificationPhase;
    verificationPhase = "cleanup";
    await closeBoss(); await closeDatabase(); process.env.DATABASE_URL = originalUrl;
    for (const name of created) {
      if (!/^da122_(fixture|restore|rollback)_[a-f0-9]{32}$/.test(name)) throw new Error("Unexpected disposable database identity.");
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await admin.end();
    if (archiveWritten) await unlink(archive);
    if (baselineWritten) await unlink(baselineArchive);
    if (baselineFolderCreated) {
      if (dirname(baselineFolder) !== scratch || basename(baselineFolder) !== `${suffix}-baseline`) throw new Error("Unexpected disposable migration directory.");
      await rm(baselineFolder, { recursive: true });
    }
    verificationPhase = completedPhase;
  }
}
main().catch(() => { console.error(`Synthetic source restore verification failed during ${verificationPhase}; no owner restore was attempted.`); process.exitCode = 1; });
