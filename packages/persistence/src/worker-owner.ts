import { eq } from "drizzle-orm";
import { getDatabase } from "./database";
import { runs, decisionAssessments, conversationPrivateBranches, localSchedules } from "./schema";
import { withLiveOwner } from "./owner-lifecycle";
import { dispatchDueLocalSchedules } from "./local-schedules";

// Host worker entry only: the owner is loaded from the persisted job target, never
// trusted from queue data or HTTP input. Missing targets cause no owner fallback.
export async function withWorkerOwner<T>(kind: "run" | "private" | "decision", id: string, work: () => Promise<T>): Promise<T | undefined> {
  const table = kind === "run" ? runs : kind === "private" ? conversationPrivateBranches : decisionAssessments;
  const [row] = await getDatabase().select({ ownerId: table.ownerId }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) return undefined;
  return withLiveOwner(row.ownerId, work);
}
export async function dispatchAllUserSchedules(now = new Date()) {
  const owners = await getDatabase().selectDistinct({ ownerId: localSchedules.ownerId }).from(localSchedules);
  let dispatched = 0, failed = 0;
  for (const owner of owners) {
    const result = await withLiveOwner(owner.ownerId, () => dispatchDueLocalSchedules(now));
    dispatched += result.dispatched; failed += result.failed;
  }
  return { dispatched, failed };
}
