import type { RunRecord } from "@deliberation-ai/application";

export function createRunExport(run: RunRecord) {
  if (!run.report || !["completed", "partially_completed", "failed", "cancelled"].includes(run.status)) {
    throw new Error("Bu çalışma için indirilebilir rapor henüz hazır değil.");
  }

  return {
    schemaVersion: "deliberationai-run-export-v1" as const,
    exportedAt: new Date().toISOString(),
    runId: run.runId,
    createdAt: run.createdAt,
    status: run.status,
    question: run.question,
    riskProfile: run.riskProfile,
    riskAssessment: run.riskAssessment ?? null,
    preflightDecision: run.preflightDecision ?? null,
    promptRevision: run.promptRevision ?? null,
    promptVersion: run.promptVersion,
    promptFingerprint: run.promptFingerprint,
    continuationContext: run.continuationContext ?? null,
    continuationArchive: run.continuationArchive ?? null,
    memberCount: run.memberCount,
    memoryEntryCount: run.memoryEntryCount,
    attachmentCount: run.attachmentCount,
    toolResultCount: run.toolResultCount,
    report: run.report,
  };
}
