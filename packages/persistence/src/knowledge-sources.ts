import { randomUUID } from "node:crypto";
import { inspectKnowledgeQuery, normalizeKnowledgeSearchTerm } from "@deliberation-ai/contracts";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { knowledgeObjectIdSchema, knowledgeScopeSchema, type KnowledgeExcerpt, type KnowledgeScope, type KnowledgeSource } from "@deliberation-ai/contracts";
import { KnowledgeAccessError, ScopedKnowledgeSource, sameKnowledgeScope, type KnowledgeSourcePort } from "@deliberation-ai/application";
import { knowledgeExcerptLocator, readKnowledgeExcerpt, validateKnowledgeExtraction, validateKnowledgeOriginal,
  type KnowledgeVersionMetadata } from "@deliberation-ai/domain";
import { extractKnowledgeFile, knowledgeDigest, knowledgeParserVersion, validateKnowledgeFiles, KnowledgeFileError, type KnowledgeFile } from "@deliberation-ai/retrieval";
import { getDatabase } from "./database";
import { decryptJson, encryptJson } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { lockConversationMembership, type ConversationTransaction } from "./conversation-membership";
import { authorizeKnowledgeScope, authorizeKnowledgeScopeInSnapshot, conversationKnowledgeAuthorization,
  exportConversationKnowledge, KnowledgeSelectionConflictError } from "./knowledge-scope";
import { knowledgeSources, knowledgeSourceVersions } from "./schema";

export const KNOWLEDGE_STORAGE_LIMITS = { versions: 120, originalBytes: 128 * 1_048_576, searchSources: 30, searchTextBytes: 1_000_000 } as const;
export class KnowledgeCapacityError extends Error { constructor() { super("Knowledge capacity exceeded; narrow the selection or use manual inspection."); } }
export class KnowledgeIntakeBusyError extends Error { constructor() { super("A knowledge intake is already active for this owner."); } }
const fields = { id: knowledgeSourceVersions.id, sourceId: knowledgeSourceVersions.sourceId, ownerId: knowledgeSourceVersions.ownerId,
  originalHash: knowledgeSourceVersions.originalHash, parserVersion: knowledgeSourceVersions.parserVersion, status: knowledgeSourceVersions.status,
  originalBytes: knowledgeSourceVersions.originalBytes, textBytes: knowledgeSourceVersions.textBytes,
  extractionCiphertext: knowledgeSourceVersions.extractionCiphertext, collectionId: knowledgeSources.collectionId };
type ExtractedVersion = KnowledgeVersionMetadata & { extractionCiphertext: string };
function extraction(row: ExtractedVersion) {
  if (row.extractionCiphertext.length > 512 * 1_024) throw new KnowledgeCapacityError();
  return validateKnowledgeExtraction(decryptJson(row.extractionCiphertext, `knowledge-version:${row.id}:extraction`), row);
}
async function ownedVersion(tx: ConversationTransaction, scope: KnowledgeScope, sourceId: string, versionId: string): Promise<ExtractedVersion> {
  if (!knowledgeObjectIdSchema.safeParse(sourceId).success || !knowledgeObjectIdSchema.safeParse(versionId).success) throw new KnowledgeAccessError();
  const [row] = await tx.select(fields).from(knowledgeSourceVersions).innerJoin(knowledgeSources,
    and(eq(knowledgeSources.id, knowledgeSourceVersions.sourceId), eq(knowledgeSources.ownerId, LOCAL_OWNER_ID), eq(knowledgeSources.collectionId, scope.collectionId)))
    .where(and(eq(knowledgeSourceVersions.id, versionId), eq(knowledgeSourceVersions.sourceId, sourceId), eq(knowledgeSourceVersions.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!row) throw new KnowledgeAccessError(); return row;
}
async function scoped<T>(scope: KnowledgeScope, read: (tx: ConversationTransaction) => Promise<T>): Promise<T> {
  if (!await authorizeKnowledgeScope(scope)) throw new KnowledgeAccessError();
  const result = await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '5s'`);
    if (!await authorizeKnowledgeScopeInSnapshot(tx, scope)) throw new KnowledgeAccessError();
    return read(tx);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  if (!await authorizeKnowledgeScope(scope)) throw new KnowledgeAccessError(); return result;
}
function normalizedSource(scope: KnowledgeScope, row: ExtractedVersion, body = extraction(row)): KnowledgeSource {
  if (body.status !== "complete" || body.mediaType === "image/png" || body.mediaType === "image/jpeg") throw new KnowledgeAccessError();
  return { scope: structuredClone(scope), sourceId: row.sourceId, versionId: row.id, title: body.name, mediaType: body.mediaType,
    originalHash: body.originalHash, textHash: body.textHash, parserVersion: body.parserVersion };
}
export type SelectedKnowledgeFile = KnowledgeFile & { sourceId: string; expectedVersionId: string | null; retryFailed?: boolean; parseDeadlineMs?: number };
function retryVersionIdentifier(scope: KnowledgeScope, sourceId: string, expected: string | null, originalHash: string, parserVersion: string) {
  if (expected === null) throw new KnowledgeSelectionConflictError();
  const hash = knowledgeDigest(JSON.stringify(["knowledge-extraction-retry-v1", scope.ownerId, scope.collectionId, sourceId, expected, originalHash, parserVersion]));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function importKnowledgeFiles(scope: KnowledgeScope, input: readonly SelectedKnowledgeFile[]) {
  validateKnowledgeFiles(input);
  // Copy caller buffers before any await; intake accepts selected bytes, never paths.
  const files = input.map((file) => ({ ...file, bytes: new Uint8Array(file.bytes) }));
  validateKnowledgeFiles(files);
  if (!knowledgeScopeSchema.safeParse(scope).success || scope.ownerId !== LOCAL_OWNER_ID || scope.accountId !== "local"
    || new Set(files.map((file) => file.sourceId)).size !== files.length
    || files.some((file) => !knowledgeObjectIdSchema.safeParse(file.sourceId).success
      || file.expectedVersionId !== null && !knowledgeObjectIdSchema.safeParse(file.expectedVersionId).success
      || file.retryFailed !== undefined && typeof file.retryFailed !== "boolean"
      || file.parseDeadlineMs !== undefined && (!Number.isInteger(file.parseDeadlineMs) || file.parseDeadlineMs < 1 || file.parseDeadlineMs > 10_000))) throw new KnowledgeAccessError();
  scope = structuredClone(scope);
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '10s'`);
    await tx.execute(sql`set local lock_timeout = '5s'`);
    const lease = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${LOCAL_OWNER_ID}), hashtext('knowledge-intake-v1')) as acquired`);
    if (!lease.rows[0]?.acquired) throw new KnowledgeIntakeBusyError();
    if (!await authorizeKnowledgeScopeInSnapshot(tx, scope)) throw new KnowledgeAccessError();
    const [inventory] = await tx.select({ count: sql<number>`count(*)::int`, bytes: sql<string>`coalesce(sum(${knowledgeSourceVersions.originalBytes}), 0)::text` })
      .from(knowledgeSourceVersions).where(eq(knowledgeSourceVersions.ownerId, LOCAL_OWNER_ID));
    const prepared: { sourceId: string; expected: string | null; row: typeof knowledgeSourceVersions.$inferInsert | null; versionId: string;
      body: ReturnType<typeof extraction> }[] = [];
    for (const file of files) {
      const [source] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, file.sourceId)).limit(1);
      if (source && (source.ownerId !== LOCAL_OWNER_ID || source.collectionId !== scope.collectionId)) throw new KnowledgeAccessError();
      const originalHash = knowledgeDigest(file.bytes), parserVersion = knowledgeParserVersion(file.mediaType);
      const retryId = file.retryFailed ? retryVersionIdentifier(scope, file.sourceId, file.expectedVersionId, originalHash, parserVersion) : null;
      const [existing] = source ? await tx.select(fields).from(knowledgeSourceVersions).innerJoin(knowledgeSources,
        eq(knowledgeSources.id, knowledgeSourceVersions.sourceId)).where(and(eq(knowledgeSourceVersions.sourceId, source.id),
          eq(knowledgeSourceVersions.ownerId, LOCAL_OWNER_ID), eq(knowledgeSourceVersions.originalHash, originalHash),
          eq(knowledgeSourceVersions.parserVersion, parserVersion)))
          .orderBy(desc(sql`${knowledgeSourceVersions.id} = ${source.activeVersionId}::uuid`), desc(knowledgeSourceVersions.createdAt)).limit(1) : [];
      const replay = existing?.id === source?.activeVersionId && (file.expectedVersionId === null || existing?.id === retryId);
      if (source && source.activeVersionId !== file.expectedVersionId && !replay) throw new KnowledgeSelectionConflictError();
      if (!source && file.expectedVersionId !== null) throw new KnowledgeSelectionConflictError();
      if (existing && (!file.retryFailed || existing.id === retryId)) {
        const body = extraction(existing);
        if (body.mediaType !== file.mediaType) throw new KnowledgeSelectionConflictError();
        prepared.push({ sourceId: file.sourceId, expected: source!.activeVersionId, row: null, versionId: existing.id, body }); continue;
      }
      if (file.retryFailed) {
        if (!source || source.activeVersionId !== file.expectedVersionId) throw new KnowledgeSelectionConflictError();
        const previous = extraction(await ownedVersion(tx, scope, file.sourceId, source.activeVersionId));
        if (previous.originalHash !== originalHash || previous.parserVersion !== parserVersion || previous.status !== "failed"
          || !["timeout", "parser_unavailable"].includes(previous.reason ?? "")) throw new KnowledgeSelectionConflictError();
      }
      if (Number(inventory!.count) + prepared.filter((value) => value.row).length + 1 > KNOWLEDGE_STORAGE_LIMITS.versions
        || Number(inventory!.bytes) + prepared.reduce((sum, value) => sum + (value.row?.originalBytes ?? 0), 0) + file.bytes.length > KNOWLEDGE_STORAGE_LIMITS.originalBytes) throw new KnowledgeCapacityError();
      const parsed = await extractKnowledgeFile(file, file.parseDeadlineMs ?? 10_000), id = retryId ?? randomUUID();
      if (parsed.reason === "active_content") throw new KnowledgeFileError();
      const identity = { ownerId: LOCAL_OWNER_ID, collectionId: scope.collectionId, sourceId: file.sourceId, versionId: id };
      const original = { ...identity, name: file.name, mediaType: file.mediaType, originalHash, dataBase64: Buffer.from(file.bytes).toString("base64") };
      const body = { ...identity, name: file.name, mediaType: file.mediaType, originalHash, ...parsed, deadlineMs: file.parseDeadlineMs ?? 10_000, textHash: knowledgeDigest(parsed.text),
        pages: parsed.pages.map((page) => ({ ...page, textHash: knowledgeDigest(parsed.text.slice(page.start, page.end)) })) };
      const metadata = { id, sourceId: file.sourceId, collectionId: scope.collectionId, ownerId: LOCAL_OWNER_ID, originalHash,
        parserVersion: parsed.parserVersion, status: parsed.status, originalBytes: file.bytes.length, textBytes: Buffer.byteLength(parsed.text, "utf8") };
      validateKnowledgeOriginal(original, metadata); validateKnowledgeExtraction(body, metadata);
      prepared.push({ sourceId: file.sourceId, expected: source?.activeVersionId ?? null, versionId: id, body,
        row: { id, sourceId: file.sourceId, ownerId: LOCAL_OWNER_ID, originalHash, parserVersion: parsed.parserVersion,
          status: parsed.status, originalBytes: metadata.originalBytes, textBytes: metadata.textBytes,
          originalCiphertext: encryptJson(original, `knowledge-version:${id}:original`), extractionCiphertext: encryptJson(body, `knowledge-version:${id}:extraction`) } });
    }
    // Parsing holds only the intake lease. Revocation remains available meanwhile.
    await lockConversationMembership(tx);
    if (!await authorizeKnowledgeScopeInSnapshot(tx, scope)) throw new KnowledgeAccessError();
    for (const item of prepared) {
      if (item.expected === null) await tx.insert(knowledgeSources).values({ id: item.sourceId, ownerId: LOCAL_OWNER_ID, collectionId: scope.collectionId, activeVersionId: item.versionId });
      else {
        const changed = await tx.update(knowledgeSources).set({ activeVersionId: item.versionId }).where(and(eq(knowledgeSources.id, item.sourceId),
          eq(knowledgeSources.ownerId, LOCAL_OWNER_ID), eq(knowledgeSources.collectionId, scope.collectionId), eq(knowledgeSources.activeVersionId, item.expected))).returning({ id: knowledgeSources.id });
        if (changed.length !== 1) throw new KnowledgeSelectionConflictError();
      }
      if (item.row) await tx.insert(knowledgeSourceVersions).values(item.row);
    }
    return prepared.map((item) => ({ sourceId: item.sourceId, versionId: item.versionId, name: item.body.name, originalHash: item.body.originalHash,
      status: item.body.status, reason: item.body.reason, parserVersion: item.body.parserVersion, reused: item.row === null }));
  });
}

export async function inspectKnowledgeVersion(scope: KnowledgeScope, sourceId: string, versionId: string) {
  return scoped(scope, async (tx) => { const row = await ownedVersion(tx, scope, sourceId, versionId); return extraction(row); });
}
export async function listKnowledgeSources(scope: KnowledgeScope, cursor: string | null = null) {
  if (cursor !== null && !knowledgeObjectIdSchema.safeParse(cursor).success) throw new KnowledgeAccessError();
  return scoped(scope, async (tx) => {
    const heads = await tx.select().from(knowledgeSources).where(and(eq(knowledgeSources.ownerId, LOCAL_OWNER_ID),
      eq(knowledgeSources.collectionId, scope.collectionId), cursor ? gt(knowledgeSources.id, cursor) : undefined)).orderBy(asc(knowledgeSources.id)).limit(21);
    const items = [];
    for (const head of heads.slice(0, 20)) {
      const row = await ownedVersion(tx, scope, head.id, head.activeVersionId), body = extraction(row);
      items.push({ sourceId: head.id, versionId: head.activeVersionId, name: body.name, status: body.status, reason: body.reason,
        parserVersion: body.parserVersion, originalHash: body.originalHash });
    }
    return { items, nextCursor: heads.length > 20 ? heads[19]!.id : null };
  });
}
export async function selectKnowledgeExcerpt(scope: KnowledgeScope, sourceId: string, versionId: string,
  start: number, end: number, page: number | null): Promise<KnowledgeExcerpt> {
  return scoped(scope, async (tx) => {
    const row = await ownedVersion(tx, scope, sourceId, versionId), body = extraction(row);
    const excerptId = knowledgeExcerptLocator(row.id, body.textHash, start, end, page);
    return { source: normalizedSource(scope, row, body), excerptId, ...readKnowledgeExcerpt(body, excerptId) };
  });
}
export async function exportKnowledgeVersion(scope: KnowledgeScope, sourceId: string, versionId: string) {
  return scoped(scope, async (tx) => {
    const row = await ownedVersion(tx, scope, sourceId, versionId);
    const [stored] = await tx.select({ originalCiphertext: knowledgeSourceVersions.originalCiphertext }).from(knowledgeSourceVersions).where(eq(knowledgeSourceVersions.id, row.id));
    if (!stored || stored.originalCiphertext.length > 10 * 1_048_576) throw new KnowledgeCapacityError();
    const original = validateKnowledgeOriginal(decryptJson(stored.originalCiphertext, `knowledge-version:${row.id}:original`), row);
    const extracted = extraction(row);
    if (original.name !== extracted.name || original.mediaType !== extracted.mediaType) throw new KnowledgeAccessError();
    return { schemaVersion: "knowledge-version-export-v1" as const, original, extraction: extracted };
  });
}

export class LocalKnowledgeSource implements KnowledgeSourcePort {
  private readonly selected: readonly KnowledgeScope[] | null;
  constructor(selected: readonly KnowledgeScope[] | null = null) { this.selected = selected === null ? null : selected.map((scope) => knowledgeScopeSchema.parse(scope)); }
  async inspectNotebook(scope: KnowledgeScope) { return scoped(scope, async () => structuredClone(scope)); }
  async searchSources(scope: KnowledgeScope, query: string) {
    if (this.selected && !this.selected.some((selected) => sameKnowledgeScope(selected, scope))) throw new KnowledgeAccessError();
    return (await searchLocalKnowledge(this.selected ?? [scope], query)).hits.filter((hit) => sameKnowledgeScope(hit.source.scope, scope)).map((hit) => hit.source);
  }
  async readExcerpt(scope: KnowledgeScope, sourceId: string, versionId: string, excerptId: string): Promise<KnowledgeExcerpt> {
    return scoped(scope, async (tx) => {
      const row = await ownedVersion(tx, scope, sourceId, versionId), body = extraction(row);
      return { source: normalizedSource(scope, row, body), excerptId, ...readKnowledgeExcerpt(body, excerptId) };
    });
  }
}
const fold = normalizeKnowledgeSearchTerm;
export class KnowledgeQueryError extends KnowledgeAccessError {
  constructor(readonly feedback: string) { super(); }
}
export async function searchLocalKnowledge(scopes: readonly KnowledgeScope[], query: string) {
  const inspected = inspectKnowledgeQuery(query);
  if (!inspected.valid) throw new KnowledgeQueryError(inspected.message!);
  const selected = scopes.map((scope) => knowledgeScopeSchema.parse(scope));
  const terms = new Set(inspected.terms);
  if (!selected.length || selected.length > 3 || new Set(selected.map((scope) => scope.collectionId)).size !== selected.length
    ) throw new KnowledgeAccessError();
  for (const scope of selected) if (!await authorizeKnowledgeScope(scope)) throw new KnowledgeAccessError();
  const deadline = performance.now() + 5_000;
  const result = await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '5s'`);
    for (const scope of selected) if (!await authorizeKnowledgeScopeInSnapshot(tx, scope)) throw new KnowledgeAccessError();
    const predicate = and(eq(knowledgeSources.ownerId, LOCAL_OWNER_ID), eq(knowledgeSourceVersions.ownerId, LOCAL_OWNER_ID),
      inArray(knowledgeSources.collectionId, selected.map((scope) => scope.collectionId)));
    const join = and(eq(knowledgeSourceVersions.sourceId, knowledgeSources.id), eq(knowledgeSourceVersions.id, knowledgeSources.activeVersionId));
    const [inventory] = await tx.select({ count: sql<number>`count(*)::int`, bytes: sql<string>`coalesce(sum(${knowledgeSourceVersions.textBytes}), 0)::text`,
      ciphertextBytes: sql<string>`coalesce(sum(octet_length(${knowledgeSourceVersions.extractionCiphertext})), 0)::text` }).from(knowledgeSources)
      .innerJoin(knowledgeSourceVersions, join).where(predicate);
    const [heads] = await tx.select({ count: sql<number>`count(*)::int` }).from(knowledgeSources).where(and(eq(knowledgeSources.ownerId, LOCAL_OWNER_ID),
      inArray(knowledgeSources.collectionId, selected.map((scope) => scope.collectionId))));
    if (heads!.count !== inventory!.count) throw new KnowledgeAccessError();
    if (inventory!.count > 30 || Number(inventory!.bytes) > 1_000_000 || Number(inventory!.ciphertextBytes) > 3 * 1_048_576) throw new KnowledgeCapacityError();
    const rows = await tx.select(fields).from(knowledgeSources).innerJoin(knowledgeSourceVersions, join).where(predicate).orderBy(asc(knowledgeSources.id)).limit(31);
    const hits: { source: KnowledgeSource; excerpt: KnowledgeExcerpt; matchingOccurrences: number }[] = []; let unavailableSources = 0;
    for (const row of rows) {
      if (performance.now() > deadline) throw new KnowledgeCapacityError();
      const body = extraction(row);
      if (body.status !== "complete") { unavailableSources++; continue; }
      const matches = [...body.text.matchAll(/[\p{L}\p{N}_]+/gu)].filter((match) => terms.has(fold(match[0])));
      if (!matches.length || [...terms].some((term) => !matches.some((match) => fold(match[0]) === term))) continue;
      const match = matches[0]!, page = body.pages.find((span) => span.start <= match.index && span.end >= match.index + match[0].length)!;
      const start = Math.max(page.start, match.index - 200), end = Math.min(page.end, start + 1_500);
      const source = normalizedSource(selected.find((scope) => scope.collectionId === row.collectionId)!, row, body);
      const excerptId = knowledgeExcerptLocator(row.id, body.textHash, start, end, page.page);
      hits.push({ source, excerpt: { source, excerptId, ...readKnowledgeExcerpt(body, excerptId) }, matchingOccurrences: matches.length });
    }
    return { hits, inspectedSources: rows.length, unavailableSources, policy: "lexical-and-first-window-v1" as const };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  if (performance.now() > deadline) throw new KnowledgeCapacityError();
  for (const scope of selected) if (!await authorizeKnowledgeScope(scope)) throw new KnowledgeAccessError();
  return result;
}
export async function createConversationKnowledgeReader(conversationId: string, revision: string) {
  const current = await exportConversationKnowledge(conversationId);
  if (current?.revision !== revision || current.grants.some((grant) => !grant.available)) throw new KnowledgeAccessError();
  const scopes = current.grants.map((grant) => grant.scope);
  return new ScopedKnowledgeSource(new LocalKnowledgeSource(scopes), conversationKnowledgeAuthorization(conversationId, revision), scopes);
}
