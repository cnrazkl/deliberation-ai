import { and, asc, eq, sql } from "drizzle-orm";
import { summarizeConversationCouncilUsage, type CouncilUsageRecord } from "@deliberation-ai/domain";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { conversations, conversationRuns, runs, providerOperations as operations, runDeletions } from "./schema";
import { exportRunDeletions } from "./run-deletion";
import { decryptJson } from "./crypto";
import { readTokenDetails } from "./provider-usage";
import { ConversationIntegrityError, ConversationPendingError, ConversationSizeError } from "./conversation-membership";

export type ConversationCouncilUsage = ReturnType<typeof summarizeConversationCouncilUsage> & {
  checkedAt: string; indexedRuns: number; deletedRuns: number; unavailableRuns: number; runsWithoutReceipts: number;
};
export function loadConversationCouncilUsage(conversationId: string): Promise<ConversationCouncilUsage | undefined> {
  return getDatabase().transaction(async (tx) => {
    const [conversation] = await tx.select({ id: conversations.id }).from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, LOCAL_OWNER_ID))).limit(1);
    if (!conversation) return undefined;
    const [pending] = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.ownerId, LOCAL_OWNER_ID),
      sql`not exists (select 1 from conversation_runs cr where cr.owner_id = ${LOCAL_OWNER_ID} and cr.run_id = ${runs.id})`)).limit(1);
    if (pending) throw new ConversationPendingError();
    const members = await tx.select({ runId: conversationRuns.runId, owner: conversationRuns.ownerId, liveId: runs.id, liveOwner: runs.ownerId })
      .from(conversationRuns).leftJoin(runs, eq(runs.id, conversationRuns.runId))
      .where(eq(conversationRuns.conversationId, conversationId)).orderBy(asc(conversationRuns.runId)).limit(201);
    if (members.length > 200) throw new ConversationSizeError();
    if (members.some((item) => item.owner !== LOCAL_OWNER_ID || (item.liveId && item.liveOwner !== LOCAL_OWNER_ID))) throw new ConversationIntegrityError();
    const [foreign] = await tx.select({ id: runDeletions.id }).from(runDeletions)
      .where(and(eq(runDeletions.conversationId, conversationId), sql`${runDeletions.ownerId} <> ${LOCAL_OWNER_ID}`)).limit(1);
    if (foreign) throw new ConversationIntegrityError();
    const audits = await exportRunDeletions(tx, conversationId);
    const membership = new Map(members.map((item) => [item.runId, item]));
    if (audits.some((item) => !membership.has(item.runId) || membership.get(item.runId)!.liveId)) throw new ConversationIntegrityError();
    const predicate = and(eq(conversationRuns.ownerId, LOCAL_OWNER_ID), eq(conversationRuns.conversationId, conversationId));
    const [size] = await tx.select({ count: sql<string>`count(*)::text`, bytes: sql<string>`coalesce(sum(
      octet_length(${operations.provider}) + octet_length(${operations.model}) + octet_length(${operations.status}) +
      coalesce(octet_length(${operations.resultMetadataCiphertext}),0) + 256),0)::text`,
      maxTextBytes: sql<string>`coalesce(max(octet_length(${operations.provider}) + octet_length(${operations.model}) + octet_length(${operations.status})),0)::text` })
      .from(operations).innerJoin(conversationRuns, eq(conversationRuns.runId, operations.runId)).where(predicate);
    if (Number(size!.count) > 10_000 || Number(size!.bytes) > 32 * 1024 * 1024 || Number(size!.maxTextBytes) > 8_192) throw new ConversationSizeError();
    const rows = await tx.select({ id: operations.id, runId: operations.runId, provider: operations.provider, model: operations.model,
      round: operations.round, status: operations.status, inputTokens: operations.inputTokens, outputTokens: operations.outputTokens,
      metadata: operations.resultMetadataCiphertext }).from(operations)
      .innerJoin(conversationRuns, eq(conversationRuns.runId, operations.runId)).where(predicate).orderBy(asc(operations.id));
    const records: CouncilUsageRecord[] = rows.map(({ metadata, runId: _runId, ...item }) => ({ ...item,
      tokenDetails: metadata ? readTokenDetails(decryptJson(metadata, `provider-operation:${item.id}:metadata`)) : null }));
    for (const audit of audits) for (const item of audit.receipts) records.push({ id: item.operationId, provider: item.provider,
      model: item.model, round: item.round, status: item.status, inputTokens: item.inputTokens, outputTokens: item.outputTokens, tokenDetails: item.tokenDetails });
    let summary: ReturnType<typeof summarizeConversationCouncilUsage>;
    try { summary = summarizeConversationCouncilUsage(records); } catch { throw new ConversationIntegrityError(); }
    const audited = new Set(audits.map((item) => item.runId));
    const withReceipts = new Set([...rows.map((item) => item.runId), ...audits.filter((item) => item.receipts.length).map((item) => item.runId)]);
    const result = { ...summary, checkedAt: new Date().toISOString(), indexedRuns: members.length, deletedRuns: audits.length,
      unavailableRuns: members.filter((item) => !item.liveId && !audited.has(item.runId)).length,
      runsWithoutReceipts: members.filter((item) => !withReceipts.has(item.runId)).length };
    if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new ConversationSizeError();
    return result;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
