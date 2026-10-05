import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { knowledgeObjectIdSchema, knowledgePacketReferenceSchema, type KnowledgePacket } from "@deliberation-ai/contracts";
import { KnowledgeAccessError } from "@deliberation-ai/application";
import { knowledgePacketFingerprint, validateKnowledgePacket } from "@deliberation-ai/domain";
import { getDatabase } from "./database";
import { decryptJson, encryptJson } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { lockConversationMembership, type ConversationTransaction } from "./conversation-membership";
import { authorizeKnowledgeScopeInSnapshot, exportConversationKnowledgeInSnapshot } from "./knowledge-scope";
import { searchLocalKnowledge, KnowledgeCapacityError } from "./knowledge-sources";
import { knowledgePreparations, knowledgeSources, knowledgeSourceVersions } from "./schema";

export class KnowledgePacketStaleError extends Error { constructor() { super("Kaynak seçimi veya sürümleri değişti; kanıt paketini yeniden hazırlayın ve inceleyin."); } }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function inventory(tx: ConversationTransaction, collections: string[]) {
  const rows = await tx.select({ sourceId: knowledgeSources.id, versionId: knowledgeSources.activeVersionId,
    collectionId: knowledgeSources.collectionId, status: knowledgeSourceVersions.status }).from(knowledgeSources)
    .innerJoin(knowledgeSourceVersions, and(eq(knowledgeSourceVersions.id, knowledgeSources.activeVersionId), eq(knowledgeSourceVersions.sourceId, knowledgeSources.id)))
    .where(and(eq(knowledgeSources.ownerId, LOCAL_OWNER_ID), eq(knowledgeSourceVersions.ownerId, LOCAL_OWNER_ID), inArray(knowledgeSources.collectionId, collections)))
    .orderBy(asc(knowledgeSources.id)).limit(31);
  if (rows.length > 30) throw new KnowledgeCapacityError(); return rows;
}
export async function authorizeKnowledgePacketInSnapshot(tx: ConversationTransaction, packet: KnowledgePacket, fresh = false) {
  const current = await exportConversationKnowledgeInSnapshot(tx, packet.conversationId);
  if (packet.ownerId !== LOCAL_OWNER_ID || current?.revision !== packet.selectionRevision
    || JSON.stringify(current.grants.map((item) => item.scope)) !== JSON.stringify(packet.scopes)) throw new KnowledgeAccessError();
  for (const scope of packet.scopes) if (!await authorizeKnowledgeScopeInSnapshot(tx, scope)) throw new KnowledgeAccessError();
  if (fresh) {
    const age = Date.now() - Date.parse(packet.createdAt);
    const active = (await inventory(tx, packet.scopes.map((scope) => scope.collectionId))).map(({ sourceId, versionId }) => ({ sourceId, versionId }));
    if (age < 0 || age > 15 * 60_000 || JSON.stringify(active) !== JSON.stringify(packet.inventory)) throw new KnowledgePacketStaleError();
  }
}
export function readRunKnowledgePacket(row: { id: string; knowledgePacketCiphertext: string | null }) {
  if (!row.knowledgePacketCiphertext) return null;
  if (row.knowledgePacketCiphertext.length > 192 * 1_024) throw new KnowledgeCapacityError();
  return validateKnowledgePacket(decryptJson(row.knowledgePacketCiphertext, `run:${row.id}:knowledge-packet`));
}
export async function assertKnowledgePacketAttachmentRouting(packet: KnowledgePacket, hashes: readonly string[]) {
  if (!hashes.length) return;
  await getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx); await authorizeKnowledgePacketInSnapshot(tx, packet, true);
    const rows = await tx.select({ originalHash: knowledgeSourceVersions.originalHash }).from(knowledgeSourceVersions)
      .where(and(eq(knowledgeSourceVersions.ownerId, packet.ownerId), inArray(knowledgeSourceVersions.id, packet.inventory.map((item) => item.versionId))));
    if (rows.some((row) => hashes.includes(row.originalHash))) throw new KnowledgePacketStaleError();
  });
}
export async function loadKnowledgePacket(reference: unknown, fresh = true): Promise<KnowledgePacket> {
  const parsed = knowledgePacketReferenceSchema.parse(reference);
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const [row] = await tx.select().from(knowledgePreparations).where(and(eq(knowledgePreparations.id, parsed.id), eq(knowledgePreparations.ownerId, LOCAL_OWNER_ID))).limit(1);
    if (!row || row.packetCiphertext.length > 192 * 1_024) throw new KnowledgeAccessError();
    const packet = validateKnowledgePacket(decryptJson(row.packetCiphertext, `knowledge-preparation:${row.id}:packet`));
    if (packet.id !== row.id || packet.conversationId !== row.conversationId || packet.fingerprint !== parsed.fingerprint) throw new KnowledgeAccessError();
    await authorizeKnowledgePacketInSnapshot(tx, packet, fresh); return packet;
  });
}
export async function prepareKnowledgePacket(input: { id: string; conversationId: string; selectionRevision: string; query: string; allowWithoutEvidence: boolean }) {
  if (![input.id, input.conversationId, input.selectionRevision].every((id) => knowledgeObjectIdSchema.safeParse(id).success)
    || typeof input.query !== "string" || !input.query.trim() || input.query.length > 4_000 || typeof input.allowWithoutEvidence !== "boolean") throw new KnowledgeAccessError();
  input = { id: input.id, conversationId: input.conversationId, selectionRevision: input.selectionRevision, query: input.query.trim(), allowWithoutEvidence: input.allowWithoutEvidence };
  const requestHash = digest(input);
  const before = await getDatabase().transaction(async (tx) => {
    const selection = await exportConversationKnowledgeInSnapshot(tx, input.conversationId);
    if (!selection || selection.revision !== input.selectionRevision || selection.grants.some((item) => !item.available)) throw new KnowledgeAccessError();
    const [previous] = await tx.select().from(knowledgePreparations).where(eq(knowledgePreparations.id, input.id)).limit(1);
    if (previous) {
      if (previous.ownerId !== LOCAL_OWNER_ID || previous.requestHash !== requestHash) throw new KnowledgePacketStaleError();
      const packet = validateKnowledgePacket(decryptJson(previous.packetCiphertext, `knowledge-preparation:${input.id}:packet`));
      await authorizeKnowledgePacketInSnapshot(tx, packet, true); return { selection, rows: null, packet };
    }
    return { selection, rows: await inventory(tx, selection.grants.map((item) => item.scope.collectionId)), packet: null };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  if (before.packet) return before.packet;
  const scopes = before.selection.grants.map((item) => item.scope);
  const search = await searchLocalKnowledge(scopes, input.query);
  const groups = scopes.map((scope) => search.hits.filter((hit) => hit.source.scope.collectionId === scope.collectionId));
  const excerpts: KnowledgePacket["excerpts"] = [];
  const seen = new Set<string>(), duplicateIds = new Set<string>();
  // Reserve coverage per selected collection, then take further complete windows.
  for (let round = 0; round < 30; round++) for (const group of groups) {
    const hit = group[round]; if (!hit) continue;
    const key = JSON.stringify([hit.source.originalHash, hit.source.textHash, hit.excerpt.start, hit.excerpt.end]);
    if (seen.has(key)) { duplicateIds.add(hit.source.sourceId); continue; }
    if (excerpts.length < 6) { seen.add(key); excerpts.push(hit.excerpt); }
  }
  if (!excerpts.length && !input.allowWithoutEvidence) throw new KnowledgeAccessError();
  const body: Omit<KnowledgePacket, "fingerprint"> = { version: "knowledge-packet-v1", id: input.id, ownerId: LOCAL_OWNER_ID,
    conversationId: input.conversationId, selectionRevision: input.selectionRevision, query: input.query, topic: before.selection.topic,
    createdAt: new Date().toISOString(), scopes, policy: "lexical-fair-coverage-v1",
    inventory: before.rows!.map(({ sourceId, versionId }) => ({ sourceId, versionId })), excerpts,
    omissions: search.hits.filter((hit) => !excerpts.some((excerpt) => excerpt.source.sourceId === hit.source.sourceId)).map((hit) => ({
      collectionId: hit.source.scope.collectionId, sourceId: hit.source.sourceId, versionId: hit.source.versionId, title: hit.source.title,
      reason: duplicateIds.has(hit.source.sourceId) ? "duplicate" : "budget" })),
    coverage: scopes.map((scope, index) => {
      const inspected = before.rows!.filter((row) => row.collectionId === scope.collectionId);
      const selected = excerpts.filter((excerpt) => excerpt.source.scope.collectionId === scope.collectionId).length;
      return { collectionId: scope.collectionId, inspected: inspected.length, unavailable: inspected.filter((row) => row.status !== "complete").length,
        matches: groups[index]!.length, selected, omitted: groups[index]!.length - selected };
    }), withoutEvidence: excerpts.length === 0 };
  const packet = validateKnowledgePacket({ ...body, fingerprint: knowledgePacketFingerprint(body) });
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    await authorizeKnowledgePacketInSnapshot(tx, packet, true);
    const [existing] = await tx.select().from(knowledgePreparations).where(eq(knowledgePreparations.id, input.id)).limit(1);
    if (existing) {
      if (existing.ownerId !== LOCAL_OWNER_ID || existing.requestHash !== requestHash) throw new KnowledgePacketStaleError();
      const retained = validateKnowledgePacket(decryptJson(existing.packetCiphertext, `knowledge-preparation:${existing.id}:packet`));
      await authorizeKnowledgePacketInSnapshot(tx, retained, true); return retained;
    }
    const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(knowledgePreparations).where(eq(knowledgePreparations.ownerId, LOCAL_OWNER_ID));
    if (count!.value >= 100) throw new KnowledgeCapacityError();
    await tx.insert(knowledgePreparations).values({ id: input.id, ownerId: LOCAL_OWNER_ID, conversationId: input.conversationId,
      requestHash, packetCiphertext: encryptJson(packet, `knowledge-preparation:${input.id}:packet`) }); return packet;
  });
}
