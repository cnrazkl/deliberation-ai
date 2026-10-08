import { and, count, eq, inArray, lt, sql } from "drizzle-orm";
import { getDatabase } from "./database";
import { getOwnerId } from "./owner";
import { RUN_COUNCIL_QUEUE, RUN_DECISION_ASSESSMENT_QUEUE } from "./queue";
import { decisionAssessments, runs } from "./schema";

const TERMINAL_STATUSES = ["completed", "partially_completed", "failed", "cancelled"] as const;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const JOB_DELETE_BATCH_SIZE = 500;

export interface PruneExpiredRunsOptions {
  retentionDays: number;
  now?: Date;
  apply?: boolean;
  /** Restricts deletion to an explicitly known set, used by fixture-only integration tests. */
  onlyRunIds?: readonly string[];
}

export async function pruneExpiredRuns(options: PruneExpiredRunsOptions): Promise<{
  cutoff: Date;
  count: number;
  applied: boolean;
}> {
  const { retentionDays, now = new Date(), apply = false, onlyRunIds } = options;
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    throw new Error("RUN_RETENTION_DAYS must be a positive integer.");
  }
  if (!Number.isFinite(now.getTime())) throw new Error("Current time must be a valid date.");
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Retention cutoff must be a valid date.");
  if (onlyRunIds?.length === 0) return { cutoff, count: 0, applied: apply };

  const predicate = and(
    eq(runs.ownerId, getOwnerId()),
    inArray(runs.status, TERMINAL_STATUSES),
    lt(runs.finishedAt, cutoff),
    // Retention must not erase the operator's record of an in-flight or
    // ambiguous provider call, even if the parent run is terminal.
    sql`NOT EXISTS (SELECT 1 FROM provider_operations po WHERE po.run_id = ${runs.id}
      AND po.status IN ('prepared', 'submitted', 'outcome_unknown', 'retry_authorized'))`,
    sql`NOT EXISTS (SELECT 1 FROM decision_assessments da WHERE da.run_id = ${runs.id}
      AND da.status IN ('queued', 'running', 'outcome_unknown'))`,
    sql`NOT EXISTS (SELECT 1 FROM decision_operations dop
      JOIN decision_assessments da ON da.id = dop.assessment_id
      WHERE da.run_id = ${runs.id}
      AND dop.status IN ('prepared', 'submitted', 'outcome_unknown', 'retry_authorized'))`,
    onlyRunIds ? inArray(runs.id, [...onlyRunIds]) : undefined,
  );
  const db = getDatabase();
  if (apply) {
    const deletedCount = await db.transaction(async (tx) => {
      const eligible = await tx.select({ id: runs.id, queueJobId: runs.queueJobId })
        .from(runs).where(predicate).for("update");
      if (eligible.length === 0) return 0;
      const runIds = eligible.map((row) => row.id);
      const assessmentJobs = await tx.select({ queueJobId: decisionAssessments.queueJobId })
        .from(decisionAssessments).where(inArray(decisionAssessments.runId, runIds));
      const queueJobs = [
        [RUN_COUNCIL_QUEUE, eligible.map((row) => row.queueJobId)],
        [RUN_DECISION_ASSESSMENT_QUEUE, assessmentJobs.map((row) => row.queueJobId)],
      ] as const;
      for (const [queue, candidateIds] of queueJobs) {
        const ids = [...new Set(candidateIds.filter((id): id is string => id !== null))];
        if (ids.some((id) => !JOB_ID.test(id))) throw new Error("A stored queue job id is invalid.");
        for (let start = 0; start < ids.length; start += JOB_DELETE_BATCH_SIZE) {
          const batch = ids.slice(start, start + JOB_DELETE_BATCH_SIZE);
          await tx.execute(sql`DELETE FROM pgboss.job WHERE name = ${queue}
            AND id IN (${sql.join(batch.map((id) => sql`${id}::uuid`), sql`, `)})`);
        }
      }
      const deleted = await tx.delete(runs).where(inArray(runs.id, runIds)).returning({ id: runs.id });
      if (deleted.length !== eligible.length) throw new Error("Retention deletion count changed unexpectedly.");
      return deleted.length;
    });
    return { cutoff, count: deletedCount, applied: true };
  }
  const [preview] = await db.select({ count: count() }).from(runs).where(predicate);
  return { cutoff, count: preview?.count ?? 0, applied: false };
}
