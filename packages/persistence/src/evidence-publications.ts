import { randomUUID, createHash } from "node:crypto";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { evidencePublicationBodySchema, evidencePublicationCommitSchema, evidencePublicationPreviewRequestSchema,
  knowledgeCollectionBodySchema, type EvidencePublicationBody, type EvidencePublicationCommit, type EvidencePublicationPreviewRequest } from "@deliberation-ai/contracts";
import { KnowledgeAccessError } from "@deliberation-ai/application";
import { validateKnowledgeOriginal, validateKnowledgeExtraction } from "@deliberation-ai/domain";
import { extractKnowledgeFile, knowledgeDigest } from "@deliberation-ai/retrieval";
import { getDatabase } from "./database";
import { decryptJson, encryptJson } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { evidencePublications, evidenceSources, knowledgeCollections, knowledgeSources, knowledgeSourceVersions } from "./schema";
import { lockConversationMembership, type ConversationTransaction } from "./conversation-membership";
import { candidateSourceAvailable, mapEvidenceSource } from "./evidence-sources";
import { authorizeKnowledgeScopeInSnapshot } from "./knowledge-scope";
import { KNOWLEDGE_STORAGE_LIMITS, KnowledgeCapacityError } from "./knowledge-sources";

export class EvidencePublicationConflictError extends Error {
  constructor() { super("İçerik, inceleme veya hedef değişmiş; kaydetmeyi yeniden inceleyin."); }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function originalDestinationHash(candidateId: string, provenance: EvidencePublicationBody["candidate"]["provenance"], excerpt: string, destination: EvidencePublicationPreviewRequest["destination"]) {
  return hash({ candidateId, provenance, excerpt, destination: destination.kind === "local" ? { kind: "local", collectionId: destination.scope.collectionId } : destination });
}
export function decodeEvidencePublication(row: typeof evidencePublications.$inferSelect) {
  if (row.bodyCiphertext.length > 64 * 1024) throw new EvidencePublicationConflictError();
  const body = evidencePublicationBodySchema.parse(decryptJson(row.bodyCiphertext, `evidence-publication:${row.id}:body`));
  if (body.id !== row.id || body.ownerId !== row.ownerId || body.candidate.id !== row.candidateId || body.candidate.runId !== row.runId || body.requestHash !== row.requestHash
    || body.fingerprint !== hash({ candidate: body.candidate, destination: body.destination, destinationTitle: body.destinationTitle })
    || body.requestHash !== hash({ candidateId: body.candidate.id, destination: body.destination, requestId: body.id, fingerprint: body.fingerprint, consent: true })
    || row.dedupHash !== originalDestinationHash(body.candidate.id, body.candidate.provenance, body.candidate.excerpt, body.destination)
    || (body.destination.kind === "local") !== (row.status === "local_saved")
    || (row.status === "manual_acknowledged") !== Boolean(row.acknowledgedAt)) throw new EvidencePublicationConflictError();
  return { ...body, status: row.status as "local_saved" | "awaiting_manual_addition" | "manual_acknowledged", acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    indexing: body.destination.kind === "local" ? "lexical_at_save" as const : "unknown" as const,
    remoteReadBack: "not_performed" as const };
}
async function lock(tx: ConversationTransaction) {
  await tx.execute(sql`set local lock_timeout = '5s'`); await tx.execute(sql`set local statement_timeout = '10s'`);
  await lockConversationMembership(tx);
}
async function preview(tx: ConversationTransaction, input: EvidencePublicationPreviewRequest) {
  const [row] = await tx.select().from(evidenceSources).where(and(eq(evidenceSources.id, input.candidateId), eq(evidenceSources.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!row) throw new KnowledgeAccessError();
  const source = mapEvidenceSource(row);
  if (!source.candidateProvenance || !source.excerpt || source.reviewStatus !== "verified" || source.freshnessStatus !== "current" || !source.freshnessReviewedAt
    || !await candidateSourceAvailable(tx, row)) throw new EvidencePublicationConflictError();
  let destinationTitle: string;
  if (input.destination.kind === "local") {
    if (!await authorizeKnowledgeScopeInSnapshot(tx, input.destination.scope)) throw new KnowledgeAccessError();
    const [collection] = await tx.select().from(knowledgeCollections).where(eq(knowledgeCollections.id, input.destination.scope.collectionId)).limit(1);
    destinationTitle = knowledgeCollectionBodySchema.parse(decryptJson(collection!.bodyCiphertext, `knowledge-collection:${collection!.id}:body`)).title;
  } else destinationTitle = input.destination.name;
  const { candidateProvenance, createdAt: _created, ...candidate } = source;
  void _created;
  const frozen = { ...candidate, provenance: candidateProvenance };
  return { candidate: frozen, destination: input.destination, destinationTitle, fingerprint: hash({ candidate: frozen, destination: input.destination, destinationTitle }),
    sharing: input.destination.kind === "local" ? "Yalnız bu yerel koleksiyon; seçim/izin ayrıca gerekir." : "İndirme düz metindir. Adlandırılan hedefe aktarım sizin eyleminizdir; uygulama göndermez." };
}
export async function previewEvidencePublication(input: EvidencePublicationPreviewRequest) {
  const request = evidencePublicationPreviewRequestSchema.parse(input);
  return getDatabase().transaction(async (tx) => { await lock(tx); return preview(tx, request); });
}
export async function commitEvidencePublication(input: EvidencePublicationCommit) {
  const request = evidencePublicationCommitSchema.parse(input), requestHash = hash(request);
  return getDatabase().transaction(async (tx) => {
    // Same ordering as selected-file intake; original and receipt commit atomically.
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCAL_OWNER_ID}), hashtext('knowledge-intake-v1'))`);
    await lock(tx);
    const [existing] = await tx.select().from(evidencePublications).where(eq(evidencePublications.id, request.requestId)).limit(1);
    if (existing) {
      if (existing.ownerId !== LOCAL_OWNER_ID || existing.requestHash !== requestHash) throw new EvidencePublicationConflictError();
      return decodeEvidencePublication(existing); // Historical acknowledgement, no fresh source access.
    }
    const [total] = await tx.select({ value: count() }).from(evidencePublications).where(eq(evidencePublications.ownerId, LOCAL_OWNER_ID));
    if (Number(total?.value ?? 0) >= 500) throw new KnowledgeCapacityError();
    const reviewed = await preview(tx, request);
    if (reviewed.fingerprint !== request.fingerprint) throw new EvidencePublicationConflictError();
    // Review timestamps and grant revisions do not turn the same original into a new source.
    const dedupHash = originalDestinationHash(request.candidateId, reviewed.candidate.provenance!, reviewed.candidate.excerpt!, request.destination);
    let sourceId: string | null = null, versionId: string | null = null;
    if (request.destination.kind === "local") {
      const [prior] = await tx.select().from(evidencePublications).where(and(eq(evidencePublications.ownerId, LOCAL_OWNER_ID), eq(evidencePublications.dedupHash, dedupHash))).orderBy(asc(evidencePublications.createdAt)).limit(1);
      if (prior) {
        ({ sourceId, versionId } = decodeEvidencePublication(prior));
        const [head] = await tx.select().from(knowledgeSources).where(and(eq(knowledgeSources.id, sourceId!), eq(knowledgeSources.ownerId, LOCAL_OWNER_ID), eq(knowledgeSources.collectionId, request.destination.scope.collectionId))).limit(1);
        if (head?.activeVersionId !== versionId) throw new EvidencePublicationConflictError();
      }
      else {
        const [inventory] = await tx.select({ total: count(), bytes: sql<string>`coalesce(sum(${knowledgeSourceVersions.originalBytes}), 0)::text` }).from(knowledgeSourceVersions).where(eq(knowledgeSourceVersions.ownerId, LOCAL_OWNER_ID));
        const bytes = Buffer.from(reviewed.candidate.excerpt!, "utf8");
        if (Number(inventory!.total) >= KNOWLEDGE_STORAGE_LIMITS.versions || Number(inventory!.bytes) + bytes.length > KNOWLEDGE_STORAGE_LIMITS.originalBytes) throw new KnowledgeCapacityError();
        sourceId = randomUUID(); versionId = randomUUID();
        const file = { name: `reviewed-evidence-${request.candidateId}.txt`, mediaType: "text/plain" as const, bytes };
        const parsed = await extractKnowledgeFile(file);
        // No slicing, normalization or secondary model output becomes the source.
        if (parsed.status !== "complete" || parsed.text !== reviewed.candidate.excerpt) throw new EvidencePublicationConflictError();
        const originalHash = knowledgeDigest(bytes), textHash = knowledgeDigest(parsed.text);
        const identity = { ownerId: LOCAL_OWNER_ID, collectionId: request.destination.scope.collectionId, sourceId, versionId };
        const original = { ...identity, name: file.name, mediaType: file.mediaType, originalHash, dataBase64: bytes.toString("base64") };
        const extracted = { ...identity, name: file.name, mediaType: file.mediaType, originalHash, ...parsed, textHash, deadlineMs: 10000,
          pages: parsed.pages.map((page) => ({ ...page, textHash: knowledgeDigest(parsed.text.slice(page.start, page.end)) })) };
        const metadata = { id: versionId, ...identity, originalHash, parserVersion: parsed.parserVersion, status: parsed.status, originalBytes: bytes.length, textBytes: bytes.length };
        validateKnowledgeOriginal(original, metadata); validateKnowledgeExtraction(extracted, metadata);
        await tx.insert(knowledgeSources).values({ id: sourceId, ownerId: LOCAL_OWNER_ID, collectionId: identity.collectionId, activeVersionId: versionId });
        await tx.insert(knowledgeSourceVersions).values({ id: versionId, sourceId, ownerId: LOCAL_OWNER_ID, originalHash, parserVersion: parsed.parserVersion, status: parsed.status,
          originalBytes: bytes.length, textBytes: bytes.length, originalCiphertext: encryptJson(original, `knowledge-version:${versionId}:original`), extractionCiphertext: encryptJson(extracted, `knowledge-version:${versionId}:extraction`) });
      }
      const [stored] = await tx.select().from(knowledgeSourceVersions).where(and(eq(knowledgeSourceVersions.id, versionId!), eq(knowledgeSourceVersions.sourceId, sourceId!), eq(knowledgeSourceVersions.ownerId, LOCAL_OWNER_ID))).limit(1);
      const extracted = stored && decryptJson(stored.extractionCiphertext, `knowledge-version:${versionId}:extraction`) as { text?: unknown } | undefined;
      if (extracted?.text !== reviewed.candidate.excerpt) throw new EvidencePublicationConflictError();
    }
    const body = evidencePublicationBodySchema.parse({ version: "evidence-publication-v1", id: request.requestId, ownerId: LOCAL_OWNER_ID, requestHash,
      fingerprint: request.fingerprint, candidate: reviewed.candidate, destination: reviewed.destination, destinationTitle: reviewed.destinationTitle,
      createdAt: new Date().toISOString(), sourceId, versionId });
    const [saved] = await tx.insert(evidencePublications).values({ id: body.id, ownerId: LOCAL_OWNER_ID, runId: body.candidate.runId, candidateId: body.candidate.id, requestHash, dedupHash,
      bodyCiphertext: encryptJson(body, `evidence-publication:${body.id}:body`), status: request.destination.kind === "local" ? "local_saved" : "awaiting_manual_addition" }).returning();
    return decodeEvidencePublication(saved!);
  });
}
export async function listEvidencePublications(runId: string) {
  const rows = await getDatabase().select().from(evidencePublications).where(and(eq(evidencePublications.ownerId, LOCAL_OWNER_ID), eq(evidencePublications.runId, runId))).orderBy(asc(evidencePublications.createdAt)).limit(501);
  if (rows.length > 500) throw new KnowledgeCapacityError(); return rows.map(decodeEvidencePublication);
}
export async function acknowledgeManualEvidencePublication(id: string) {
  return getDatabase().transaction(async (tx) => {
    await lock(tx);
    const [row] = await tx.select().from(evidencePublications).where(and(eq(evidencePublications.id, id), eq(evidencePublications.ownerId, LOCAL_OWNER_ID))).limit(1);
    if (!row) throw new KnowledgeAccessError();
    if (decodeEvidencePublication(row).destination.kind !== "manual") throw new EvidencePublicationConflictError();
    if (row.status === "manual_acknowledged") return decodeEvidencePublication(row);
    const [saved] = await tx.update(evidencePublications).set({ status: "manual_acknowledged", acknowledgedAt: new Date() }).where(eq(evidencePublications.id, id)).returning();
    return decodeEvidencePublication(saved!);
  });
}
