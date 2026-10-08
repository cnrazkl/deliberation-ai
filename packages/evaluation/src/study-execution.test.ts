import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { prepareStudyExecution,matchesFrozenStudyReviewPolicy } from "./study-execution";
import { prepareReviewRoundComparison } from "./review-round-comparison";
const suite: unknown = JSON.parse(readFileSync(new URL("../../../docs/evaluation/COUNCIL_EXTERNAL_SUITE.json", import.meta.url), "utf8"));
const standard = prepareReviewRoundComparison(suite).cases.find((item) => item.effectiveRiskProfile === "standard")!;
const selection = { kind: "rounds" as const, caseIds: [standard.caseId], memberCount: 2, maxCalls: 20, outputTokens: 4_096 };
it("freezes all eligible round arms, retains partial cohort and unknown quality/cost", () => {
  const plan = prepareStudyExecution(suite, selection);
  expect(plan.arms.map((arm) => arm.reviewRounds)).toEqual([0, 1, 2, 3]); expect(plan.plannedCalls).toBe(20);
  expect(plan).toMatchObject({ selectedCases: 1, totalCases: 40, accuracy: null, invoiceCost: "unknown", humanAcceptance: "not_assessed" });
  expect(prepareStudyExecution(suite, { ...selection, outputTokens: 2_048 }).fingerprint).not.toBe(plan.fingerprint);
});
it("cannot drop high-risk controls, duplicate cases or exceed a call ceiling", () => {
  const high = prepareReviewRoundComparison(suite).cases.find((item) => item.effectiveRiskProfile === "high")!;
  expect(prepareStudyExecution(suite, { ...selection, caseIds: [high.caseId] }).arms.map((arm) => arm.reviewRounds)).toEqual([1, 2, 3]);
  for (const changed of [{ maxCalls: 19 }, { caseIds: [standard.caseId, standard.caseId] }, { caseIds: ["invented"] }, { outputTokens: 4_097 }, { memberCount: 7 }, { approval: true }])
    expect(() => prepareStudyExecution(suite, { ...selection, ...changed })).toThrow();
});
it("freezes original/additive paired questions separately without semantic drift approval", () => {
  const plan = prepareStudyExecution(suite, { ...selection, kind: "prompt", maxCalls: 8 });
  expect(plan.arms.map((arm) => arm.arm)).toEqual(["original", "candidate"]);
  expect(plan.arms[1]!.question).toContain(plan.arms[0]!.question); expect(plan.plannedCalls).toBe(8);
  expect(plan.humanAcceptance).toBe("not_assessed");
});
it("bounds and freezes diagnostic concurrency without changing eligible controls or call reservations", () => {
  const sequential = prepareStudyExecution(suite, selection);
  const concurrent = prepareStudyExecution(suite, { ...selection, maxConcurrentArms: 4 });
  expect(concurrent.fingerprint).not.toBe(sequential.fingerprint);
  expect(concurrent.arms).toEqual(sequential.arms);
  expect(concurrent.plannedCalls).toBe(sequential.plannedCalls);
  for (const maxConcurrentArms of [0, 5, 1.5]) expect(() => prepareStudyExecution(suite, { ...selection, maxConcurrentArms })).toThrow();
});
it("rejects stale worker review instructions and missing/duplicate/foreign saved policies",()=>{
  const frozen=[{memberId:"member-a",round:1,instructions:"current frozen policy"}];
  const actual=[{reviewerMemberId:"member-a",round:1,instructions:"current frozen policy"}];
  const attempted=[{memberId:"member-a",round:1}];
  expect(matchesFrozenStudyReviewPolicy(frozen,actual,attempted)).toBe(true);
  expect(matchesFrozenStudyReviewPolicy(frozen,[{...actual[0]!,instructions:"previous worker policy"}],attempted)).toBe(false);
  expect(matchesFrozenStudyReviewPolicy(frozen,[],attempted)).toBe(false);
  expect(matchesFrozenStudyReviewPolicy(frozen,[...actual,...actual],attempted)).toBe(false);
  expect(matchesFrozenStudyReviewPolicy(frozen,[{...actual[0]!,round:2}],attempted)).toBe(false);
});
