import { describe, expect, it } from "vitest";
import {
  evaluationCorpusSchema,
  evaluatePredictions,
  pairedDocumentBootstrap,
  type EvaluationPrediction,
} from "./index";
import { buildPerfectFixturePredictions, offlineFixtureCorpus } from "./fixtures";

describe("offline decision evaluation", () => {
  it("accepts the Turkish-first fixture and keeps documents in one split", () => {
    const parsed = evaluationCorpusSchema.parse(offlineFixtureCorpus);
    expect(parsed.items.filter((item) => item.language === "tr").length).toBeGreaterThan(
      parsed.items.filter((item) => item.language !== "tr").length,
    );
    const splitByDocument = new Map<string, string>();
    for (const item of parsed.items) {
      expect(splitByDocument.get(item.documentId) ?? item.split).toBe(item.split);
      splitByDocument.set(item.documentId, item.split);
    }
  });

  it("rejects document leakage and evidence spans not present in the excerpt", () => {
    const leaking = structuredClone(offlineFixtureCorpus);
    const firstDocument = leaking.items[0]?.documentId;
    const sameDocument = leaking.items.find((item, index) => index > 0 && item.documentId === firstDocument);
    expect(sameDocument).toBeDefined();
    if (sameDocument) sameDocument.split = "held_out";
    expect(evaluationCorpusSchema.safeParse(leaking).success).toBe(false);

    const invalidSpan = structuredClone(offlineFixtureCorpus);
    const supporting = invalidSpan.items.find((item) => item.goldLabel === "supports");
    expect(supporting).toBeDefined();
    if (supporting) supporting.evidenceSpans = [{ text: "Kaynakta olmayan ifade", kind: "support" }];
    expect(evaluationCorpusSchema.safeParse(invalidSpan).success).toBe(false);
  });

  it("computes confusion, safety, calibration, language, and risk metrics deterministically", () => {
    const before = JSON.stringify(offlineFixtureCorpus);
    const report = evaluatePredictions(
      offlineFixtureCorpus,
      buildPerfectFixturePredictions(),
      "held_out",
    );
    expect(report.metrics.total).toBe(13);
    expect(report.metrics.coverage).toBe(1);
    expect(report.metrics.accuracy).toBe(1);
    expect(report.metrics.falseSupportRate).toBe(0);
    expect(report.metrics.supportPrecision).toBe(1);
    expect(report.metrics.contradictionRecall).toBe(1);
    expect(report.metrics.macroF1).toBe(1);
    expect(report.metrics.multiclassBrier).toBeCloseTo(0.0075);
    expect(report.metrics.expectedCalibrationError).toBeCloseTo(0.15);
    expect(report.byLanguage.tr?.total).toBe(10);
    expect(report.byRiskTag.prompt_injection?.total).toBe(3);
    expect(JSON.stringify(offlineFixtureCorpus)).toBe(before);
  });

  it("keeps an operational failure separate from semantic insufficient evidence", () => {
    const predictions = buildPerfectFixturePredictions();
    const semanticItem = offlineFixtureCorpus.items.find(
      (item) => item.split === "held_out" && item.goldLabel === "insufficient_evidence",
    );
    expect(semanticItem).toBeDefined();
    const changed = predictions.map((prediction) =>
      prediction.itemId === semanticItem?.id
        ? {
            itemId: prediction.itemId,
            status: "not_assessed" as const,
            reason: "provider_failure" as const,
          }
        : prediction,
    );
    const report = evaluatePredictions(offlineFixtureCorpus, changed, "held_out");
    expect(report.metrics.notAssessed).toBe(1);
    expect(report.metrics.confusion.insufficient_evidence.not_assessed).toBe(1);
    expect(report.metrics.confusion.insufficient_evidence.insufficient_evidence).toBe(1);
    expect(report.metrics.coverage).toBeCloseTo(12 / 13);
  });

  it("reports critical false support instead of treating it as verification", () => {
    const predictions = buildPerfectFixturePredictions();
    const target = offlineFixtureCorpus.items.find(
      (item) => item.split === "held_out" && item.critical && item.goldLabel !== "supports",
    );
    expect(target).toBeDefined();
    const changed: EvaluationPrediction[] = predictions.map((prediction) =>
      prediction.itemId === target?.id
        ? {
            itemId: prediction.itemId,
            status: "assessed",
            label: "supports",
            probabilities: {
              supports: 0.7,
              contradicts: 0.1,
              insufficient_evidence: 0.1,
              not_applicable: 0.1,
            },
          }
        : prediction,
    );
    const report = evaluatePredictions(offlineFixtureCorpus, changed, "held_out");
    expect(report.metrics.criticalFalseSupportItemIds).toEqual([target?.id]);
    expect(report.metrics.falseSupportRate).toBeGreaterThan(0);
  });

  it("requires one valid prediction per item", () => {
    const missing = buildPerfectFixturePredictions().slice(1);
    expect(() => evaluatePredictions(offlineFixtureCorpus, missing, "held_out")).toThrow(
      /Eksik tahmin/,
    );
    const invalid = structuredClone(buildPerfectFixturePredictions());
    const first = invalid[0];
    if (first?.status === "assessed") first.probabilities.supports = 0.99;
    expect(() => evaluatePredictions(offlineFixtureCorpus, invalid, "held_out")).toThrow();
  });

  it("builds repeatable paired document-clustered intervals", () => {
    const baseline = buildPerfectFixturePredictions();
    const candidate = structuredClone(baseline);
    const target = offlineFixtureCorpus.items.find(
      (item) => item.split === "held_out" && item.goldLabel !== "supports",
    );
    const index = candidate.findIndex((prediction) => prediction.itemId === target?.id);
    if (index >= 0 && target) {
      candidate[index] = {
        itemId: target.id,
        status: "assessed",
        label: "supports",
        probabilities: {
          supports: 0.7,
          contradicts: 0.1,
          insufficient_evidence: 0.1,
          not_applicable: 0.1,
        },
      };
    }
    const first = pairedDocumentBootstrap(
      offlineFixtureCorpus,
      candidate,
      baseline,
      "falseSupportRate",
      { iterations: 200, seed: 42 },
    );
    const second = pairedDocumentBootstrap(
      offlineFixtureCorpus,
      candidate,
      baseline,
      "falseSupportRate",
      { iterations: 200, seed: 42 },
    );
    expect(first).toEqual(second);
    expect(first.documentCount).toBe(6);
    expect(first.candidateMinusBaseline).toBeGreaterThan(0);
  });
});
