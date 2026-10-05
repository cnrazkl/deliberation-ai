import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, expect, test } from "vitest";
import { KnowledgeAccessError } from "@deliberation-ai/application";
import { closeDatabase, getDatabase } from "./database";
import { createKnowledgeCollection, changeKnowledgeGrant, setConversationKnowledge, KnowledgeSelectionConflictError } from "./knowledge-scope";
import { createConversationKnowledgeReader, exportKnowledgeVersion, importKnowledgeFiles, inspectKnowledgeVersion, KnowledgeCapacityError,
  KnowledgeIntakeBusyError, listKnowledgeSources, LocalKnowledgeSource, searchLocalKnowledge, selectKnowledgeExcerpt, type SelectedKnowledgeFile } from "./knowledge-sources";
import { auditRestoredEncryption } from "../scripts/backup-encryption-audit";
import * as s from "./schema";
const collections: string[] = [], sources: string[] = [], conversations: string[] = [];
afterEach(async () => {
  if (sources.length) {
    await getDatabase().delete(s.knowledgeSourceVersions).where(inArray(s.knowledgeSourceVersions.sourceId, sources));
    await getDatabase().delete(s.knowledgeSources).where(inArray(s.knowledgeSources.id, sources));
  }
  if (conversations.length) {
    await getDatabase().delete(s.conversationKnowledgeSelections).where(inArray(s.conversationKnowledgeSelections.conversationId, conversations));
    await getDatabase().delete(s.conversationKnowledge).where(inArray(s.conversationKnowledge.conversationId, conversations));
    await getDatabase().delete(s.conversations).where(inArray(s.conversations.id, conversations));
  }
  if (collections.length) {
    await getDatabase().delete(s.knowledgeGrants).where(inArray(s.knowledgeGrants.collectionId, collections));
    await getDatabase().delete(s.knowledgeCollections).where(inArray(s.knowledgeCollections.id, collections));
  }
  collections.length = 0; sources.length = 0; conversations.length = 0;
});
afterAll(closeDatabase);
async function scope() { const collection = await createKnowledgeCollection("Generated source library"); collections.push(collection.id); return changeKnowledgeGrant(collection.id, 1, "active"); }
function file(text = "İnsan kaynakları: azınlık iddiası korunur."): SelectedKnowledgeFile {
  const id = randomUUID(); sources.push(id); return { sourceId: id, expectedVersionId: null, name: "generated.txt", mediaType: "text/plain", bytes: Buffer.from(text) };
}
const fixture = (name: string) => readFile(new URL(`../../../docs/evaluation/knowledge-fixtures/${name}`, import.meta.url));
test("encrypted originals and canonical text/page hashes round-trip; retries reuse the immutable version", async () => {
  const selected = await scope(), input = file("İnsan\r\nazınlık korunur.");
  const [saved] = await importKnowledgeFiles(selected, [input]);
  expect(saved).toMatchObject({ status: "complete", reused: false });
  const [row] = await getDatabase().select().from(s.knowledgeSourceVersions).where(eq(s.knowledgeSourceVersions.id, saved!.versionId));
  expect(row!.originalCiphertext).not.toContain("azınlık"); expect(row!.extractionCiphertext).not.toContain("azınlık");
  const exported = await exportKnowledgeVersion(selected, input.sourceId, saved!.versionId);
  expect(Buffer.from(exported.original.dataBase64, "base64")).toEqual(input.bytes);
  expect(exported.extraction.text).toBe("İnsan\nazınlık korunur.");
  expect((await importKnowledgeFiles(selected, [input]))[0]).toMatchObject({ versionId: saved!.versionId, reused: true });
  await expect(getDatabase().update(s.knowledgeSourceVersions).set({ textBytes: 1 }).where(eq(s.knowledgeSourceVersions.id, saved!.versionId))).rejects.toThrow();
  const [after] = await getDatabase().select().from(s.knowledgeSourceVersions).where(eq(s.knowledgeSourceVersions.id, saved!.versionId));
  expect(after).toEqual(row);
});
test("source updates preserve old originals and pinned citations without silently refreshing them", async () => {
  const selected = await scope(), input = file("Earlier minority source.");
  const [first] = await importKnowledgeFiles(selected, [input]);
  const quote = await selectKnowledgeExcerpt(selected, input.sourceId, first!.versionId, 0, 23, null);
  const [second] = await importKnowledgeFiles(selected, [{ ...input, expectedVersionId: first!.versionId, bytes: Buffer.from("Changed source version.") }]);
  expect(second!.versionId).not.toBe(first!.versionId);
  expect(await new LocalKnowledgeSource().readExcerpt(selected, input.sourceId, first!.versionId, quote.excerptId)).toEqual(quote);
  expect((await searchLocalKnowledge([selected], "changed")).hits[0]!.source.versionId).toBe(second!.versionId);
  await expect(importKnowledgeFiles(selected, [{ ...input, expectedVersionId: first!.versionId, bytes: Buffer.from("Stale overwrite.") }])).rejects.toBeInstanceOf(KnowledgeSelectionConflictError);
  expect((await listKnowledgeSources(selected)).items[0]!.versionId).toBe(second!.versionId);
});
test("temporary parser failure requires an explicit, revision-bound retry; lost retry responses reuse the result", async () => {
  const selected = await scope(), input = { ...file(), name: "selected.pdf", mediaType: "application/pdf" as const, bytes: await fixture("selectable-sun.pdf") };
  const [failed] = await importKnowledgeFiles(selected, [{ ...input, parseDeadlineMs: 1 }]);
  expect(failed).toMatchObject({ status: "failed", reason: "timeout" });
  expect((await importKnowledgeFiles(selected, [input]))[0]).toMatchObject({ versionId: failed!.versionId, reused: true });
  const retry = { ...input, expectedVersionId: failed!.versionId, retryFailed: true };
  const [recovered] = await importKnowledgeFiles(selected, [retry]); expect(recovered!.status).toBe("complete");
  expect(recovered!.versionId).not.toBe(failed!.versionId);
  expect((await importKnowledgeFiles(selected, [retry]))[0]).toMatchObject({ versionId: recovered!.versionId, reused: true });
  expect((await inspectKnowledgeVersion(selected, input.sourceId, failed!.versionId)).status).toBe("failed");
  expect(await getDatabase().select({ id: s.knowledgeSourceVersions.id }).from(s.knowledgeSourceVersions)).toHaveLength(2);
});
test("PDF/table page provenance is exact; scanned, image and failed extraction states abstain", async () => {
  const selected = await scope();
  const input = file();
  const scans = [file(), file()];
  const imported = await importKnowledgeFiles(selected, [{ ...input, name: "table.pdf", mediaType: "application/pdf", bytes: await fixture("support-table.pdf") },
    { ...scans[0]!, name: "scan.pdf", mediaType: "application/pdf", bytes: await fixture("scanned-support.pdf") },
    { ...scans[1]!, name: "image.png", mediaType: "image/png", bytes: await fixture("ambiguous-support.png") }]);
  expect(imported.map((item) => item.status)).toEqual(["complete", "extraction_unverified", "extraction_unverified"]);
  const body = await inspectKnowledgeVersion(selected, input.sourceId, imported[0]!.versionId);
  const quote = await selectKnowledgeExcerpt(selected, input.sourceId, imported[0]!.versionId, 0, Math.min(100, body.text.length), 1);
  expect(await new LocalKnowledgeSource().readExcerpt(selected, input.sourceId, imported[0]!.versionId, quote.excerptId)).toEqual(quote);
  await expect(selectKnowledgeExcerpt(selected, scans[0]!.sourceId, imported[1]!.versionId, 0, 1, 1)).rejects.toThrow();
  expect((await searchLocalKnowledge([selected], "support")).unavailableSources).toBe(2);
  expect((await exportKnowledgeVersion(selected, scans[0]!.sourceId, imported[1]!.versionId)).original.dataBase64).toBe(Buffer.from(await fixture("scanned-support.pdf")).toString("base64"));
});
test("foreign/unselected collection, source and version substitutions deny content, titles and existence", async () => {
  const selected = await scope(), foreign = await scope(), input = file();
  const [saved] = await importKnowledgeFiles(selected, [input]);
  expect((await searchLocalKnowledge([foreign], "azınlık")).hits).toEqual([]);
  for (const rejected of [{ ...selected, ownerId: "foreign-owner" }, { ...selected, accountId: "external" }, foreign]) {
    await expect(exportKnowledgeVersion(rejected, input.sourceId, saved!.versionId)).rejects.toBeInstanceOf(KnowledgeAccessError);
  }
  await expect(inspectKnowledgeVersion(selected, randomUUID(), saved!.versionId)).rejects.toBeInstanceOf(KnowledgeAccessError);
  await expect(inspectKnowledgeVersion(selected, input.sourceId, randomUUID())).rejects.toBeInstanceOf(KnowledgeAccessError);
  const conversationId = randomUUID(); conversations.push(conversationId);
  await getDatabase().insert(s.conversations).values({ id: conversationId, ownerId: "local-owner", anchorRunId: randomUUID(), origin: "native" });
  const revision = (await setConversationKnowledge(conversationId, null, { topic: "Scoped", scopes: [foreign] }))!;
  const gateway = await createConversationKnowledgeReader(conversationId, revision);
  await expect(gateway.searchSources(selected, "azınlık")).rejects.toBeInstanceOf(KnowledgeAccessError);
  const next = (await setConversationKnowledge(conversationId, revision, { topic: "Selected source", scopes: [selected] }))!;
  const reader = await createConversationKnowledgeReader(conversationId, next);
  const quote = (await searchLocalKnowledge([selected], "azınlık")).hits[0]!.excerpt;
  expect(await reader.readExcerpt(selected, input.sourceId, saved!.versionId, quote.excerptId)).toEqual(quote);
  await expect(gateway.searchSources(foreign, "azınlık")).rejects.toBeInstanceOf(KnowledgeAccessError);
});
test("revocation blocks search, original exports and pinned excerpt reuse; a later regrant does not revive old scope", async () => {
  const selected = await scope(), input = file(); const [saved] = await importKnowledgeFiles(selected, [input]);
  const quote = (await searchLocalKnowledge([selected], "azınlık")).hits[0]!.excerpt;
  const revoked = await changeKnowledgeGrant(selected.collectionId, selected.grantRevision, "revoked");
  await expect(searchLocalKnowledge([selected], "azınlık")).rejects.toBeInstanceOf(KnowledgeAccessError);
  await expect(exportKnowledgeVersion(selected, input.sourceId, saved!.versionId)).rejects.toBeInstanceOf(KnowledgeAccessError);
  await expect(new LocalKnowledgeSource().readExcerpt(selected, input.sourceId, saved!.versionId, quote.excerptId)).rejects.toBeInstanceOf(KnowledgeAccessError);
  await changeKnowledgeGrant(selected.collectionId, revoked.grantRevision, "active");
  await expect(searchLocalKnowledge([selected], "azınlık")).rejects.toBeInstanceOf(KnowledgeAccessError);
});
test("batch validation and stale updates are atomic; character overflow remains visible as a failed original", async () => {
  const selected = await scope(), valid = file(), invalid = { ...file(), name: "archive.zip" };
  await expect(importKnowledgeFiles(selected, [valid, invalid])).rejects.toThrow();
  expect(await getDatabase().select().from(s.knowledgeSources)).toHaveLength(0);
  const oversized = file("x".repeat(64_001)); const [saved] = await importKnowledgeFiles(selected, [oversized]);
  expect(saved).toMatchObject({ status: "failed", reason: "character_limit" });
  expect((await exportKnowledgeVersion(selected, oversized.sourceId, saved!.versionId)).extraction.text).toBe("");
  expect((await searchLocalKnowledge([selected], "x")).hits).toEqual([]);
  const active = Buffer.concat([await fixture("selectable-sun.pdf"), Buffer.from("\n/JavaScript active-script")]);
  await expect(importKnowledgeFiles(selected, [{ ...file(), name: "active.pdf", mediaType: "application/pdf", bytes: active }])).rejects.toThrow();
  expect(await getDatabase().select().from(s.knowledgeSources)).toHaveLength(1);
});
test("one active owner intake is enforced across database connections", async () => {
  const selected = await scope(), input = file(), client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    await client.query("begin"); await client.query("select pg_advisory_xact_lock(hashtext('local-owner'), hashtext('knowledge-intake-v1'))");
    await expect(importKnowledgeFiles(selected, [input])).rejects.toBeInstanceOf(KnowledgeIntakeBusyError);
  } finally { await client.query("rollback"); await client.end(); }
});
test("all selected collections count towards automatic inventory bounds before body scan; manual browsing remains available", async () => {
  const first = await scope(), second = await scope();
  for (const [selected, count] of [[first, 21], [second, 11]] as const) for (let start = 0; start < count; start += 6) {
    await importKnowledgeFiles(selected, Array.from({ length: Math.min(6, count - start) }, () => file("Shared fixture text.")));
  }
  await expect(searchLocalKnowledge([first, second], "shared")).rejects.toBeInstanceOf(KnowledgeCapacityError);
  expect((await searchLocalKnowledge([first], "shared")).hits).toHaveLength(21);
  const page = await listKnowledgeSources(first); expect(page.items).toHaveLength(20);
  expect((await listKnowledgeSources(first, page.nextCursor)).items).toHaveLength(1);
  const local = new LocalKnowledgeSource([first, second]);
  await expect(local.searchSources(first, "shared")).rejects.toBeInstanceOf(KnowledgeCapacityError);
});
test("automatic text-byte budget refuses a valid corpus before scanning while manual exact spans remain usable", async () => {
  const selected = await scope(); const files: SelectedKnowledgeFile[] = [];
  for (let start = 0; start < 16; start += 6) {
    const batch = Array.from({ length: Math.min(6, 16 - start) }, () => file("shared ".repeat(9_142).padEnd(64_000, "x")));
    files.push(...batch); await importKnowledgeFiles(selected, batch);
  }
  await expect(searchLocalKnowledge([selected], "shared")).rejects.toBeInstanceOf(KnowledgeCapacityError);
  const head = (await listKnowledgeSources(selected)).items.find((item) => item.sourceId === files[0]!.sourceId)!;
  expect((await selectKnowledgeExcerpt(selected, head.sourceId, head.versionId, 0, 6, null)).text).toBe("shared");
});
test("retained version inventory is bounded and quota rejection leaves the selected batch unapplied", async () => {
  const selected = await scope();
  for (let start = 0; start < 120; start += 6) await importKnowledgeFiles(selected, Array.from({ length: 6 }, () => file("Capacity fixture.")));
  await expect(importKnowledgeFiles(selected, [file()])).rejects.toBeInstanceOf(KnowledgeCapacityError);
  expect(await getDatabase().select({ id: s.knowledgeSourceVersions.id }).from(s.knowledgeSourceVersions)).toHaveLength(120);
});
test("database source pointer cannot switch to another collection's version", async () => {
  const selected = await scope(), foreign = await scope(), first = file(), second = file();
  const [a] = await importKnowledgeFiles(selected, [first]); const [b] = await importKnowledgeFiles(foreign, [second]);
  await expect(getDatabase().update(s.knowledgeSources).set({ activeVersionId: b!.versionId }).where(eq(s.knowledgeSources.id, first.sourceId))).rejects.toThrow();
  expect((await listKnowledgeSources(selected)).items[0]!.versionId).toBe(a!.versionId);
});
test("revocation during actual PDF intake prevents the whole parsed batch from committing", async () => {
  const selected = await scope(), client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  const bytes = await fixture("selectable-sun.pdf");
  const pending = importKnowledgeFiles(selected, [file(), file()].map((input) => ({ ...input, name: "selected.pdf", mediaType: "application/pdf" as const, bytes })));
  const outcome = pending.then(() => null, (error: unknown) => error);
  try {
    let witnessed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const lock = await client.query<{ active: boolean }>(`select exists(select 1 from pg_locks where locktype = 'advisory' and granted
        and database = (select oid from pg_database where datname = current_database()) and objsubid = 2
        and classid::bigint = (hashtext('local-owner')::bigint & 4294967295)
        and objid::bigint = (hashtext('knowledge-intake-v1')::bigint & 4294967295)) as active`);
      if (lock.rows[0]!.active) { witnessed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(witnessed).toBe(true);
    await changeKnowledgeGrant(selected.collectionId, selected.grantRevision, "revoked");
    expect(await outcome).toBeInstanceOf(KnowledgeAccessError);
    expect(await getDatabase().select().from(s.knowledgeSources)).toHaveLength(0);
  } finally { await client.end(); await outcome; }
});
test("backup verifies populated source originals, extracted page hashes and complete source schema era", async () => {
  const selected = await scope(); await importKnowledgeFiles(selected, [file()]);
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    expect((await auditRestoredEncryption(client)).decryptedValues).toBeGreaterThanOrEqual(3);
    await client.query("begin"); await client.query("alter table knowledge_sources rename to knowledge_sources_hidden");
    await expect(auditRestoredEncryption(client)).rejects.toThrow("incomplete");
  } finally { await client.query("rollback"); await client.end(); }
});
