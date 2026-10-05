import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { knowledgeCollectionBodySchema, knowledgeScopeSchema, knowledgeSelectionSchema, type KnowledgeScope } from "@deliberation-ai/contracts";
import { KnowledgeAccessError, sameKnowledgeScope } from "@deliberation-ai/application";
import { getDatabase } from "./database";
import { decryptJson, encryptJson } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { lockConversationMembership, type ConversationTransaction } from "./conversation-membership";
import { conversations, conversationKnowledge, conversationKnowledgeSelections, knowledgeCollections, knowledgeGrants } from "./schema";

export class KnowledgeSelectionConflictError extends Error {
  constructor() { super("Knowledge selection has changed."); }
}
async function lock(tx: ConversationTransaction) {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(sql`set local statement_timeout = '10s'`);
  await lockConversationMembership(tx);
}
export async function createKnowledgeCollection(title: string) {
  const body = knowledgeCollectionBodySchema.parse({ title });
  return getDatabase().transaction(async (tx) => {
    await lock(tx);
    const id = randomUUID(), grantId = randomUUID();
    await tx.insert(knowledgeCollections).values({ id, ownerId: LOCAL_OWNER_ID, accountId: "local",
      bodyCiphertext: encryptJson(body, `knowledge-collection:${id}:body`) });
    // Creating a collection does not grant retrieval or select it in a conversation.
    await tx.insert(knowledgeGrants).values({ id: grantId, collectionId: id, ownerId: LOCAL_OWNER_ID, status: "revoked", revision: 1 });
    return { id, title: body.title, grantId, grantRevision: 1, status: "revoked" as const };
  });
}
export async function exportKnowledgeCollection(collectionId: string) {
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx.select({ collection: knowledgeCollections, grant: knowledgeGrants }).from(knowledgeCollections)
      .innerJoin(knowledgeGrants, and(eq(knowledgeGrants.collectionId, knowledgeCollections.id), eq(knowledgeGrants.ownerId, LOCAL_OWNER_ID)))
      .where(and(eq(knowledgeCollections.id, collectionId), eq(knowledgeCollections.ownerId, LOCAL_OWNER_ID), eq(knowledgeCollections.accountId, "local"))).limit(1);
    if (!row) return undefined;
    if (row.collection.bodyCiphertext.length > 4_096) throw new KnowledgeAccessError();
    const body = knowledgeCollectionBodySchema.parse(decryptJson(row.collection.bodyCiphertext, `knowledge-collection:${collectionId}:body`));
    return { version: "knowledge-collection-export-v1" as const, collectionId, accountId: row.collection.accountId,
      ...body, grantId: row.grant.id, grantRevision: row.grant.revision, grantStatus: row.grant.status,
      scope: "Collection metadata and current grant only; source storage is not implemented in DA-120." };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
async function authorizeInSnapshot(tx: ConversationTransaction, scope: KnowledgeScope) {
  if (!knowledgeScopeSchema.safeParse(scope).success || scope.ownerId !== LOCAL_OWNER_ID || scope.accountId !== "local") return false;
  const [row] = await tx.select({ id: knowledgeGrants.id }).from(knowledgeGrants).innerJoin(knowledgeCollections,
    and(eq(knowledgeCollections.id, knowledgeGrants.collectionId), eq(knowledgeCollections.ownerId, LOCAL_OWNER_ID), eq(knowledgeCollections.accountId, scope.accountId)))
    .where(and(eq(knowledgeGrants.ownerId, LOCAL_OWNER_ID), eq(knowledgeGrants.id, scope.grantId),
      eq(knowledgeGrants.collectionId, scope.collectionId), eq(knowledgeGrants.revision, scope.grantRevision), eq(knowledgeGrants.status, "active"))).limit(1);
  return !!row;
}
export async function authorizeKnowledgeScope(scope: KnowledgeScope) {
  return getDatabase().transaction((tx) => authorizeInSnapshot(tx, scope), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function changeKnowledgeGrant(collectionId: string, expectedRevision: number, status: "active" | "revoked"): Promise<KnowledgeScope> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision >= 2_147_483_647
    || !["active", "revoked"].includes(status)) throw new KnowledgeAccessError();
  return getDatabase().transaction(async (tx) => {
    await lock(tx);
    const [collection] = await tx.select().from(knowledgeCollections)
      .where(and(eq(knowledgeCollections.id, collectionId), eq(knowledgeCollections.ownerId, LOCAL_OWNER_ID), eq(knowledgeCollections.accountId, "local"))).limit(1);
    if (!collection) throw new KnowledgeAccessError();
    const [grant] = await tx.update(knowledgeGrants).set({ status, revision: expectedRevision + 1, updatedAt: new Date() })
      .where(and(eq(knowledgeGrants.collectionId, collectionId), eq(knowledgeGrants.ownerId, LOCAL_OWNER_ID), eq(knowledgeGrants.revision, expectedRevision)))
      .returning();
    if (!grant) throw new KnowledgeSelectionConflictError();
    return { ownerId: LOCAL_OWNER_ID, accountId: "local", collectionId, grantId: grant.id, grantRevision: grant.revision };
  });
}
export async function exportConversationKnowledgeInSnapshot(tx: ConversationTransaction, conversationId: string) {
  const [conversation] = await tx.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!conversation) throw new KnowledgeAccessError();
  const [head] = await tx.select().from(conversationKnowledge).where(eq(conversationKnowledge.conversationId, conversationId)).limit(1);
  const rows = await tx.select().from(conversationKnowledgeSelections).where(eq(conversationKnowledgeSelections.conversationId, conversationId))
    .orderBy(asc(conversationKnowledgeSelections.collectionId)).limit(4);
  if (!head) { if (rows.length) throw new KnowledgeAccessError(); return null; }
  if (head.ownerId !== LOCAL_OWNER_ID || rows.some((row) => row.ownerId !== LOCAL_OWNER_ID)) throw new KnowledgeAccessError();
  if (head.selectionCiphertext.length > 32_768) throw new KnowledgeAccessError();
  const selection = knowledgeSelectionSchema.parse(decryptJson(head.selectionCiphertext, `conversation-knowledge:${conversationId}:${head.revision}:selection`));
  if (rows.length !== selection.scopes.length || selection.scopes.some((scope) => scope.ownerId !== LOCAL_OWNER_ID || scope.accountId !== "local"
    || !rows.some((row) => row.collectionId === scope.collectionId && row.grantId === scope.grantId && row.grantRevision === scope.grantRevision))) throw new KnowledgeAccessError();
  const grants = [];
  for (const scope of selection.scopes) {
    const [grant] = await tx.select({ revision: knowledgeGrants.revision, status: knowledgeGrants.status }).from(knowledgeGrants)
      .innerJoin(knowledgeCollections, and(eq(knowledgeCollections.id, knowledgeGrants.collectionId),
        eq(knowledgeCollections.ownerId, LOCAL_OWNER_ID), eq(knowledgeCollections.accountId, scope.accountId)))
      .where(and(eq(knowledgeGrants.id, scope.grantId), eq(knowledgeGrants.collectionId, scope.collectionId), eq(knowledgeGrants.ownerId, LOCAL_OWNER_ID))).limit(1);
    if (!grant || grant.revision < scope.grantRevision || !["active", "revoked"].includes(grant.status)) throw new KnowledgeAccessError();
    grants.push({ scope, available: grant.revision === scope.grantRevision && grant.status === "active" });
  }
  // Explicit selection metadata remains inspectable after revocation; no source
  // titles or bodies are loaded here, and export does not grant retrieval.
  return { version: "conversation-knowledge-v1" as const, revision: head.revision, topic: selection.topic, grants };
}
export async function exportConversationKnowledge(conversationId: string) {
  return getDatabase().transaction((tx) => exportConversationKnowledgeInSnapshot(tx, conversationId), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function setConversationKnowledge(conversationId: string, expectedRevision: string | null,
  input: { topic: string; scopes: KnowledgeScope[] } | null) {
  const selection = input === null ? null : knowledgeSelectionSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    await lock(tx);
    const current = await exportConversationKnowledgeInSnapshot(tx, conversationId);
    if ((current?.revision ?? null) !== expectedRevision) throw new KnowledgeSelectionConflictError();
    if (selection) for (const scope of selection.scopes) if (!await authorizeInSnapshot(tx, scope)) throw new KnowledgeAccessError();
    await tx.delete(conversationKnowledgeSelections).where(and(eq(conversationKnowledgeSelections.conversationId, conversationId), eq(conversationKnowledgeSelections.ownerId, LOCAL_OWNER_ID)));
    await tx.delete(conversationKnowledge).where(and(eq(conversationKnowledge.conversationId, conversationId), eq(conversationKnowledge.ownerId, LOCAL_OWNER_ID)));
    if (!selection) return null;
    const revision = randomUUID();
    await tx.insert(conversationKnowledge).values({ conversationId, ownerId: LOCAL_OWNER_ID, revision,
      selectionCiphertext: encryptJson(selection, `conversation-knowledge:${conversationId}:${revision}:selection`) });
    await tx.insert(conversationKnowledgeSelections).values(selection.scopes.map((scope) => ({ conversationId, ownerId: LOCAL_OWNER_ID,
      collectionId: scope.collectionId, grantId: scope.grantId, grantRevision: scope.grantRevision })));
    return revision;
  });
}
// Used by the application gateway: grant validity alone cannot authorize a
// notebook which the conversation no longer selects.
export function conversationKnowledgeAuthorization(conversationId: string, expectedRevision: string) {
  return { authorize: async (scope: KnowledgeScope) => {
    try {
      const current = await exportConversationKnowledge(conversationId);
      return current?.revision === expectedRevision && current.grants.some((grant) => grant.available && sameKnowledgeScope(grant.scope, scope));
    } catch { return false; }
  } };
}
