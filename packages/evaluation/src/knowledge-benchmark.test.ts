import { expect, test } from "vitest";
import { summarizeKnowledgeBenchmark } from "./knowledge-benchmark";

const caseIds = Array.from({ length: 40 }, (_, index) => `case-${index}`);
const samples = caseIds.flatMap((caseId, index) => (["new-pool", "reused-pool"] as const).map((phase) => ({
  caseId, phase, durationMs: (index + 1) * 100, status: "prepared", excerptCount: 1, excerptCharacters: 100,
  checkedCitations: 1, omissions: 0, packetFingerprint: "b".repeat(64), failureClass: null,
})));
const input = { schemaVersion: "knowledge-local-benchmark-v1", planSha256: "a".repeat(64), caseIds,
  baselineCharacters: 10_000, sourceBundleCount: 10, baselineRssBytes: 100, sampledMaxRssBytes: 120, samples };

test("uses nearest-rank p95 and retains blocked quality, unknown cost and unknown true memory peak", () => {
  const result = summarizeKnowledgeBenchmark(input);
  expect(result.phases).toEqual(["new-pool", "reused-pool"].map((phase) => ({ phase, attempts: 40, failures: 0, p95Ms: 3800, latencyTargetObserved: false })));
  expect(result).toMatchObject({ sampledRssIncreaseBytes: 20, processPeakRssBytes: null, monetaryCost: null,
    observedProviderUsage: null, citationEntailment: "not_assessed", releaseAcceptance: "blocked" });
});

test("requires every paired frozen case, rejecting missing, duplicate and substituted measurements", () => {
  for (const changed of [samples.slice(1), [...samples, samples[0]], [samples[0], ...samples.slice(0, -1)],
    samples.map((sample, index) => index === 0 ? { ...sample, caseId: "foreign" } : sample)]) {
    expect(() => summarizeKnowledgeBenchmark({ ...input, samples: changed })).toThrow();
  }
});

test("failed attempts retain unknown counts and stay in the latency denominator", () => {
  const changed = samples.map((sample, index) => index === 0 ? { ...sample, status: "failed", durationMs: 90_000,
    excerptCount: null, excerptCharacters: null, checkedCitations: null, omissions: null, packetFingerprint: null, failureClass: "capacity" } : sample);
  const result = summarizeKnowledgeBenchmark({ ...input, samples: changed });
  expect(result.phases[0]).toMatchObject({ attempts: 40, failures: 1, p95Ms: 3900 });
  expect(result.samples[0]?.excerptCharacters).toBeNull();
  expect(() => summarizeKnowledgeBenchmark({ ...input, samples: changed.map((sample, index) => index === 0 ? { ...sample, excerptCount: 0 } : sample) })).toThrow();
});

test("unchecked citations, invalid memory and non-finite durations cannot pass observation validation", () => {
  expect(() => summarizeKnowledgeBenchmark({ ...input, sampledMaxRssBytes: 99 })).toThrow();
  for (const change of [{ checkedCitations: 0 }, { durationMs: Infinity }, { excerptCount: 7 }]) {
    expect(() => summarizeKnowledgeBenchmark({ ...input, samples: [{ ...samples[0], ...change }, ...samples.slice(1)] })).toThrow();
  }
});
