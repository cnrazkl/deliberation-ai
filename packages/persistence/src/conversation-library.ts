import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "./database";
import { decryptText } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { conversations, runs } from "./schema";
import { ConversationPendingError } from "./conversation-membership";
import type { RunHistoryPage } from "./run-repository";

export const CONVERSATION_LIBRARY_PAGE_SIZE = 20;
export type ConversationLibraryItem = {
  conversationId: string;
  createdAt: string;
  origin: "native" | "legacy-reconstructed";
  recordedRunCount: number;
  availableRunCount: number;
  unavailableRunCount: number;
  latestAvailableRun: {
    runId: string;
    question: string;
    status: RunHistoryPage["runs"][number]["status"];
  } | null;
};
export type ConversationLibraryPage = { conversations: ConversationLibraryItem[]; nextCursor: string | null };

type LibraryRow = {
  id: string; createdAt: string; origin: ConversationLibraryItem["origin"];
  recordedRunCount: number; availableRunCount: number;
  runId: string | null; question: string | null; questionCiphertext: string | null;
  status: RunHistoryPage["runs"][number]["status"] | null;
};

/** Read only metadata and one question per visible conversation; never load report/archive bodies. */
export async function listConversations(beforeConversationId?: string): Promise<ConversationLibraryPage | undefined> {
  return getDatabase().transaction(async (tx) => {
    if (beforeConversationId) {
      const [cursor] = await tx.select({ id: conversations.id }).from(conversations)
        .where(and(eq(conversations.ownerId, LOCAL_OWNER_ID), eq(conversations.id, beforeConversationId))).limit(1);
      if (!cursor) return undefined;
    }
    const pending = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.ownerId, LOCAL_OWNER_ID),
      sql`not exists (select 1 from conversation_runs cr where cr.owner_id = ${LOCAL_OWNER_ID} and cr.run_id = ${runs.id})`,
    )).limit(1);
    if (pending.length) throw new ConversationPendingError();

    // Compare timestamps inside PostgreSQL: a JS Date would lose sub-millisecond precision.
    const before = beforeConversationId ? sql`and (c.created_at, c.id) < (
      select created_at, id from conversations where owner_id = ${LOCAL_OWNER_ID} and id = ${beforeConversationId}::uuid
    )` : sql``;
    const result = await tx.execute<LibraryRow>(sql`
      select c.id, c.created_at as "createdAt", c.origin,
        counts.recorded::integer as "recordedRunCount", counts.available::integer as "availableRunCount",
        latest.id as "runId", latest.question, latest.question_ciphertext as "questionCiphertext", latest.status
      from (
        select id, created_at, origin from conversations c
        where c.owner_id = ${LOCAL_OWNER_ID} ${before}
        order by c.created_at desc, c.id desc limit ${CONVERSATION_LIBRARY_PAGE_SIZE + 1}
      ) c
      cross join lateral (
        select count(*) as recorded, count(r.id) as available
        from conversation_runs cr left join runs r on r.id = cr.run_id and r.owner_id = ${LOCAL_OWNER_ID}
        where cr.owner_id = ${LOCAL_OWNER_ID} and cr.conversation_id = c.id
      ) counts
      left join lateral (
        select r.id, r.question, r.question_ciphertext, r.status
        from conversation_runs cr join runs r on r.id = cr.run_id and r.owner_id = ${LOCAL_OWNER_ID}
        where cr.owner_id = ${LOCAL_OWNER_ID} and cr.conversation_id = c.id
        order by cr.created_at desc, cr.run_id desc limit 1
      ) latest on true
      order by c.created_at desc, c.id desc
    `);
    const pageRows = result.rows.slice(0, CONVERSATION_LIBRARY_PAGE_SIZE);
    return {
      conversations: pageRows.map((row) => ({
        conversationId: row.id, createdAt: new Date(row.createdAt).toISOString(), origin: row.origin,
        recordedRunCount: row.recordedRunCount, availableRunCount: row.availableRunCount,
        unavailableRunCount: row.recordedRunCount - row.availableRunCount,
        latestAvailableRun: row.runId && row.status ? {
          runId: row.runId, status: row.status,
          question: row.questionCiphertext ? decryptText(row.questionCiphertext, `run:${row.runId}:question`) : row.question ?? "",
        } : null,
      })),
      nextCursor: result.rows.length > CONVERSATION_LIBRARY_PAGE_SIZE ? pageRows.at(-1)!.id : null,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
