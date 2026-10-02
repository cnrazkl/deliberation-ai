import { describe, expect, it } from "vitest";
import type { RunRecord } from "@deliberation-ai/application";
import { createRunExport } from "./run-export";
import { buildCompactedContinuation, freezeContinuation, prepareContinuationCompaction } from "@deliberation-ai/application";

const report: NonNullable<RunRecord["report"]> = {
  status: "completed",
  qualityNotice: "İki üye tamamlandı.",
  sharedClaims: [],
  distinctClaims: [],
  redTeamChallenges: [],
  memberResults: [],
  failures: [],
  reviews: [],
  reviewFailures: [],
};

const run: RunRecord = {
  runId: "00000000-0000-4000-8000-000000000001",
  idempotencyKey: "internal-idempotency-key",
  requestHash: "internal-request-hash",
  question: "Hangi seçeneği uygulamalıyım?",
  promptVersion: "council-v1",
  promptFingerprint: "first-round-fingerprint",
  riskProfile: "standard",
  snapshotId: "internal-snapshot-id",
  memberCount: 2,
  memoryEntryCount: 1,
  attachmentCount: 1,
  toolResultCount: 0,
  createdAt: "2026-09-26T00:00:00.000Z",
  status: "completed",
  report,
};

describe("local run export", () => {
  it("exports the private original and omission provenance separately from the delivered summary", () => {
    const packet = prepareContinuationCompaction({ sourceRunId: run.runId, sourceRiskProfile: "standard", content: JSON.stringify({ sourceRunId: run.runId, question: run.question, status: "completed", promptVersion: run.promptVersion, promptFingerprint: "a".repeat(64), report: { minority: "Private original alternative" }, continuationContext: null }) });
    const { context, archive } = buildCompactedContinuation(packet, { version: "manual-continuation-compaction-v1", summary: "A reviewed summary with uncertainty retained.", reviewed: true });
    const exported = createRunExport({ ...run, continuationContext: context, continuationArchive: archive });
    expect(exported.continuationArchive).toEqual(archive);
    expect(exported.continuationArchive!.packet.originalContent).toContain("Private original alternative");
    expect(exported.continuationContext!.content).not.toContain("Private original alternative");
  });
  it("exports the exact frozen historical input without needing the live source", () => {
    const continuationContext = freezeContinuation({ sourceRunId: run.runId, sourceRiskProfile: "standard", content: "Earlier full report" });
    expect(createRunExport({ ...run, continuationContext }).continuationContext).toEqual(continuationContext);
  });
  it("keeps the report and provenance while excluding internal run keys and attachment bytes", () => {
    const exported = createRunExport(run);
    expect(exported).toMatchObject({
      schemaVersion: "deliberationai-run-export-v1",
      runId: run.runId,
      question: run.question,
      attachmentCount: 1,
      report,
    });
    expect(exported.exportedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(Object.keys(exported)).not.toEqual(expect.arrayContaining(["idempotencyKey", "requestHash", "snapshotId", "attachments", "apiKey"]));
    expect(JSON.stringify(exported)).not.toContain("internal-idempotency-key");
    expect(JSON.stringify(exported)).not.toContain("internal-request-hash");
    expect(JSON.stringify(exported)).not.toContain("internal-snapshot-id");
  });

  it("refuses an unfinished run", () => {
    expect(() => createRunExport({ ...run, status: "running", report: null })).toThrow("hazır değil");
  });
});
