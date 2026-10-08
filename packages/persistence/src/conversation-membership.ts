import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDatabase } from "./database";
import { getOwnerId } from "./owner";
import { conversations, conversationRuns, runs } from "./schema";
import { projectRunBranch, runBranchFields } from "./run-branches";

export type ConversationTransaction = Parameters<Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]>[0];
export class ConversationPendingError extends Error {}
export class ConversationIntegrityError extends Error {}
export class ConversationSizeError extends Error {}

export async function lockConversationMembership(tx: ConversationTransaction) {
  // Always acquired before source-row locks, including during legacy migration.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${getOwnerId()}), hashtext('conversation-membership-v1'))`);
}

export async function attachRunToConversation(tx: ConversationTransaction, row: typeof runs.$inferSelect, selectedConversationId?: string) {
  const branch = projectRunBranch(row);
  let conversationId: string;
  if (row.branchSourceRunId) {
    const [parent] = await tx.select({ conversationId: conversationRuns.conversationId }).from(conversationRuns)
      .innerJoin(conversations, and(eq(conversations.id, conversationRuns.conversationId), eq(conversations.ownerId, getOwnerId())))
      .where(and(eq(conversationRuns.ownerId, getOwnerId()), eq(conversationRuns.runId, row.branchSourceRunId))).limit(1);
    if (!parent) throw new ConversationPendingError();
    conversationId = parent.conversationId;
    if (selectedConversationId && conversationId !== selectedConversationId) throw new ConversationIntegrityError();
  } else if (selectedConversationId) {
    const [selected] = await tx.select({ id: conversations.id }).from(conversations)
      .where(and(eq(conversations.id, selectedConversationId), eq(conversations.ownerId, getOwnerId()))).limit(1);
    if (!selected) throw new ConversationIntegrityError(); conversationId = selected.id;
    const [membership] = await tx.select({ id: conversationRuns.runId }).from(conversationRuns)
      .where(eq(conversationRuns.conversationId, selected.id)).limit(1);
    if (!membership) await tx.update(conversations).set({ anchorRunId: row.id }).where(eq(conversations.id, selected.id));
  } else {
    conversationId = randomUUID();
    await tx.insert(conversations).values({ id: conversationId, ownerId: getOwnerId(), anchorRunId: row.id, origin: "native",
      createdAt: sql`(select created_at from runs where id = ${row.id} and owner_id = ${getOwnerId()})` });
  }
  await tx.insert(conversationRuns).values({ ownerId: getOwnerId(), runId: row.id, conversationId,
    sourceRunId: row.branchSourceRunId, kind: branch.kind,
    createdAt: sql`(select created_at from runs where id = ${row.id} and owner_id = ${getOwnerId()})` });
}

export async function indexExistingConversations(): Promise<number> {
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const [inventory] = await tx.select({ count: sql<string>`count(*)::text`, bytes: sql<string>`coalesce(sum(
      coalesce(octet_length(${runs.continuationContextCiphertext}), 0) + coalesce(octet_length(${runs.followUpCiphertext}), 0)), 0)::text` })
      .from(runs).where(eq(runs.ownerId, getOwnerId()));
    if (Number(inventory?.count) > 10_000 || Number(inventory?.bytes) > 128 * 1024 * 1024) throw new ConversationSizeError();
    // Metadata and only the two bounded provenance snapshots; never report bodies.
    const rows = await tx.select(runBranchFields).from(runs).where(eq(runs.ownerId, getOwnerId()))
      .orderBy(asc(runs.id)).limit(10_001).for("update");
    if (rows.length > 10_000) throw new ConversationSizeError();
    const memberships = await tx.select().from(conversationRuns).where(eq(conversationRuns.ownerId, getOwnerId())).limit(10_001);
    if (memberships.length > 10_000) throw new ConversationSizeError();
    const assigned = new Map(memberships.map((row) => [row.runId, row.conversationId]));
    const stored = new Map(rows.map((row) => [row.id, row]));
    const existingMemberships = new Map(memberships.map((member) => [member.runId, member]));
    for (const row of rows) {
      projectRunBranch(row);
      const member = existingMemberships.get(row.id);
      if (member && (row.branchSourceRunId !== member.sourceRunId || row.branchKind !== member.kind || row.createdAt.getTime() !== member.createdAt.getTime())) throw new ConversationIntegrityError();
    }
    // Preserve PostgreSQL microseconds rather than rounding through JS Date.
    // Repair only equivalent millisecond projections from the initial rollout.
    await tx.execute(sql`update conversation_runs cr set created_at = r.created_at from runs r
      where cr.owner_id = ${getOwnerId()} and r.owner_id = cr.owner_id and r.id = cr.run_id
      and cr.created_at <> r.created_at
      and date_trunc('milliseconds', cr.created_at) = date_trunc('milliseconds', r.created_at)`);
    let indexed = 0;
    for (const initial of rows) {
      if (assigned.has(initial.id)) continue;
      const path: typeof rows = [];
      const visited = new Set<string>();
      let id = initial.id;
      while (!assigned.has(id)) {
        if (visited.has(id)) throw new ConversationIntegrityError();
        visited.add(id);
        const row = stored.get(id);
        if (!row) break;
        path.push(row);
        if (!row.branchSourceRunId) break;
        id = row.branchSourceRunId;
      }
      let conversationId = assigned.get(id);
      if (!conversationId) {
        // A missing boundary has an anchor, not an invented report or message.
        const [existing] = await tx.select().from(conversations).where(and(eq(conversations.ownerId, getOwnerId()), eq(conversations.anchorRunId, id))).limit(1);
        conversationId = existing?.id ?? randomUUID();
        if (!existing) await tx.insert(conversations).values({ id: conversationId, ownerId: getOwnerId(),
          anchorRunId: id, origin: "legacy-reconstructed", createdAt: path.at(-1)!.createdAt });
      }
      for (const row of path.reverse()) {
        await tx.insert(conversationRuns).values({ ownerId: getOwnerId(), runId: row.id, conversationId,
          sourceRunId: row.branchSourceRunId, kind: row.branchKind!,
          createdAt: sql`(select created_at from runs where id = ${row.id} and owner_id = ${getOwnerId()})` });
        assigned.set(row.id, conversationId);
        indexed++;
      }
    }
    return indexed;
  });
}
