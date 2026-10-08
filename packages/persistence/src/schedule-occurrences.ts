import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { localSchedules } from "./schema";
import { getOwnerId } from "./owner";
import type { ConversationTransaction } from "./conversation-membership";

export class ScheduleOccurrenceUnavailableError extends Error {}
export type ScheduleOccurrenceFence = { id: string; fingerprint: string; occurrenceAt: string; now: Date };
export const scheduleSnapshotHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function scheduleOccurrenceKey(id: string, occurrenceAt: string) {
  // Keep historical millisecond keys; retain extra precision when it is present.
  return `schedule:${id}:${occurrenceAt.replace(/(\.\d{3})000Z$/, "$1Z")}`;
}
export async function assertScheduleOccurrence(tx: ConversationTransaction, fence: ScheduleOccurrenceFence, key: string) {
  const [current] = await tx.select({ row: localSchedules, exact: sql<unknown>`to_jsonb(${localSchedules})` }).from(localSchedules)
    .where(and(eq(localSchedules.id, fence.id), eq(localSchedules.ownerId, getOwnerId()))).for("update").limit(1);
  if (!current || current.row.deletedAt || current.row.status !== "active" || scheduleSnapshotHash(current.exact) !== fence.fingerprint ||
      key !== scheduleOccurrenceKey(fence.id, fence.occurrenceAt)) throw new ScheduleOccurrenceUnavailableError();
}
export async function completeScheduleOccurrence(tx: ConversationTransaction, fence: ScheduleOccurrenceFence, runId: string) {
  const changed = await tx.update(localSchedules).set({ lastRunId: runId, lastRunAt: sql`${fence.occurrenceAt}::timestamptz`,
    nextRunAt: sql`${localSchedules.nextRunAt} + case when ${localSchedules.cadence}='weekly' then interval '168 hours' else interval '24 hours' end`, updatedAt: fence.now })
    .where(and(eq(localSchedules.id, fence.id), eq(localSchedules.ownerId, getOwnerId()), isNull(localSchedules.deletedAt),
      eq(localSchedules.status, "active"), sql`${localSchedules.nextRunAt}=${fence.occurrenceAt}::timestamptz`)).returning({ id: localSchedules.id });
  if (changed.length !== 1) throw new ScheduleOccurrenceUnavailableError();
}
