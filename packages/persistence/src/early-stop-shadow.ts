import { assessEarlyStopShadow } from "@deliberation-ai/evaluation";
import { findDurableRunEvaluationSnapshot } from "./run-repository";

/** Owner-scoped, read-only retrospective inspection. Never enqueues or skips model work. */
export async function inspectStoredEarlyStopShadow(runId: string) {
  const snapshot = await findDurableRunEvaluationSnapshot(runId);
  if (!snapshot?.run.report || !["completed", "partially_completed", "failed"].includes(snapshot.run.status)) {
    throw new Error("Tamamlanmış ve sahibine ait bir konsey raporu gerekli.");
  }
  const report = snapshot.run.report;
  const requestedRounds = report.reviewExecution?.requestedRounds ?? 0;
  return {
    version: "early-stop-shadow-v1" as const,
    runId,
    requestedRounds,
    automaticEarlyStopEnabled: false as const,
    accuracyStatus: "not_measured" as const,
    assessments: ([1, 2] as const).filter((round) => round < requestedRounds)
      .map((round) => assessEarlyStopShadow(report, snapshot.members, round, snapshot.run.riskProfile)),
  };
}
