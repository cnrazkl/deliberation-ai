import { z } from "zod";

const count = z.number().int().nonnegative();
const sampleSchema = z.object({
  caseId: z.string().min(1), phase: z.enum(["new-pool", "reused-pool"]),
  durationMs: z.number().finite().nonnegative(), status: z.enum(["prepared", "failed"]),
  excerptCount: count.max(6).nullable(), excerptCharacters: count.max(9_000).nullable(),
  checkedCitations: count.max(6).nullable(), omissions: count.nullable(),
  packetFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  failureClass: z.enum(["access", "capacity", "stale", "validation", "other"]).nullable(),
}).strict().superRefine((sample, ctx) => {
  const fields = [sample.excerptCount, sample.excerptCharacters, sample.checkedCitations, sample.omissions, sample.packetFingerprint];
  if (sample.status === "failed" ? fields.some((value) => value !== null) || sample.failureClass === null : fields.some((value) => value === null) || sample.failureClass !== null
    || sample.status === "prepared" && sample.checkedCitations !== sample.excerptCount) {
    ctx.addIssue({ code: "custom", message: "Prepared samples require checked citations; failures retain unknown values." });
  }
});
export type KnowledgeBenchmarkSample = z.infer<typeof sampleSchema>;

const inputSchema = z.object({
  schemaVersion: z.literal("knowledge-local-benchmark-v1"),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  caseIds: z.array(z.string().min(1)).min(30).max(100),
  baselineCharacters: count, sourceBundleCount: count.positive(),
  baselineRssBytes: count, sampledMaxRssBytes: count,
  samples: z.array(sampleSchema).max(200),
}).strict();

/** Engineering observations only: no human gold, model scores or monetary claims. */
export function summarizeKnowledgeBenchmark(input: unknown) {
  const value = inputSchema.parse(input);
  if (new Set(value.caseIds).size !== value.caseIds.length || value.sampledMaxRssBytes < value.baselineRssBytes) throw new Error("Invalid benchmark inventory.");
  const expected = new Set(value.caseIds.flatMap((id) => [JSON.stringify([id, "new-pool"]), JSON.stringify([id, "reused-pool"])]));
  for (const sample of value.samples) {
    if (!expected.delete(JSON.stringify([sample.caseId, sample.phase]))) throw new Error("Duplicate or unknown benchmark sample.");
  }
  if (expected.size) throw new Error("Every frozen case needs both preparation attempts, including failures.");
  const phases = (["new-pool", "reused-pool"] as const).map((phase) => {
    const samples = value.samples.filter((sample) => sample.phase === phase);
    const ordered = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const p95Ms = ordered[Math.ceil(ordered.length * 0.95) - 1]!;
    return { phase, attempts: samples.length, failures: samples.filter((sample) => sample.status === "failed").length,
      p95Ms, latencyTargetObserved: p95Ms <= 2_000 && samples.every((sample) => sample.status === "prepared") };
  });
  return { ...value, phases,
    sampledRssIncreaseBytes: value.sampledMaxRssBytes - value.baselineRssBytes,
    processPeakRssBytes: null, operatingSystemColdCache: "not_measured" as const,
    providerCalls: 0, observedProviderUsage: null, monetaryCost: null,
    humanLabels: "not_assessed" as const, citationEntailment: "not_assessed" as const,
    criticalRecall: "not_assessed" as const, modelAnswerCoverage: "not_assessed" as const,
    setupMaintenance: "not_measured" as const, releaseAcceptance: "blocked" as const,
  };
}
