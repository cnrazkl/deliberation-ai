import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareReviewRoundComparison, validateReviewRoundComparisonPlan } from "./review-round-comparison";

const suite = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"), "utf8")) as unknown;
const runId = "11111111-1111-4111-8111-111111111111";

describe("review-round comparison preparation", () => {
  it("freezes the external questions and excludes the forbidden zero-round high-risk cell", () => {
    const plan = prepareReviewRoundComparison(suite);
    expect(plan.cases).toHaveLength(40);
    const high = plan.cases.find((item) => item.effectiveRiskProfile === "high");
    const standard = plan.cases.find((item) => item.effectiveRiskProfile === "standard");
    expect(high?.eligibleRounds).toEqual([1, 2, 3]);
    expect(standard?.eligibleRounds).toEqual([0, 1, 2, 3]);
    expect(validateReviewRoundComparisonPlan(suite, plan)).toEqual(plan);
    const forbidden = structuredClone(plan);
    forbidden.cases.find((item) => item.effectiveRiskProfile === "high")!.runIds["0"] = runId;
    expect(() => validateReviewRoundComparisonPlan(suite, forbidden)).toThrow("sıfır");
  });

  it("rejects changed source questions and reused run ids", () => {
    const plan = prepareReviewRoundComparison(suite);
    const changed = structuredClone(plan);
    changed.cases[0]!.question += " ek";
    expect(() => validateReviewRoundComparisonPlan(suite, changed)).toThrow("değişmiş");
    const reused = structuredClone(plan);
    reused.cases[0]!.runIds["1"] = runId;
    reused.cases[1]!.runIds["1"] = runId;
    expect(() => validateReviewRoundComparisonPlan(suite, reused)).toThrow("iki karşılaştırma");
  });
});
