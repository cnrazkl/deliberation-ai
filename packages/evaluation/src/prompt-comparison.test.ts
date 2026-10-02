import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compilePromptDriftAdjudication, compilePromptDriftWorksheet, createPromptDriftAdjudication,
  createPromptDriftWorksheet, preparePromptComparison,
} from "./prompt-comparison";

const suite = () => JSON.parse(readFileSync(new URL("../../../docs/evaluation/COUNCIL_EXTERNAL_SUITE.json", import.meta.url), "utf8"));

function reviewed(plan: ReturnType<typeof preparePromptComparison>, slot: "a" | "b", reviewerId: string) {
  const worksheet = createPromptDriftWorksheet(plan, slot);
  return compilePromptDriftWorksheet(plan, { ...worksheet, reviewerId,
    cases: worksheet.cases.map((item) => ({ ...item, decision: "meaning_preserved",
      rationale: "Sentetik test kararı; gerçek insan incelemesi değildir." })) });
}

describe("paired prompt comparison preparation", () => {
  it("freezes 40 source-bound original/candidate pairs without output claims", () => {
    const plan = preparePromptComparison(suite());
    expect(plan.cases).toHaveLength(40);
    expect(plan.planSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.cases.every((item) => item.candidateQuestion.startsWith(item.originalQuestion) &&
      item.candidateQuestion.length > item.originalQuestion.length && item.candidateQuestion.length <= 4_000)).toBe(true);
    expect(plan.cases.filter((item) => item.split === "held_out")).toHaveLength(20);
    const blank = createPromptDriftWorksheet(plan, "a");
    expect(blank.cases.every((item) => item.decision === null)).toBe(true);
    expect(() => compilePromptDriftWorksheet(plan, blank)).toThrow();
  });

  it("rejects edited prompts and requires two distinct reviewers and a third adjudicator", () => {
    const plan = preparePromptComparison(suite());
    const a = reviewed(plan, "a", "synthetic-a");
    const b = reviewed(plan, "b", "synthetic-b");
    const tampered = createPromptDriftWorksheet(plan, "a");
    tampered.cases[0]!.candidateQuestion = "Değiştirilmiş metin";
    expect(() => compilePromptDriftWorksheet(plan, { ...tampered, reviewerId: "synthetic-a",
      cases: tampered.cases.map((item) => ({ ...item, decision: "meaning_preserved", rationale: "Yeterince uzun sentetik gerekçe." })) })).toThrow("eşleşmiyor");
    expect(() => createPromptDriftAdjudication(plan, a, reviewed(plan, "b", a.reviewerId))).toThrow("ayrı");
    expect(() => createPromptDriftAdjudication(plan, { ...a, cases: [{ ...a.cases[0]!, decision: "uncertain" }, ...a.cases.slice(1)] }, b)).toThrow("özeti");
    const blank = createPromptDriftAdjudication(plan, a, b);
    expect(() => compilePromptDriftAdjudication(plan, a, b, blank)).toThrow();
    const filled = { ...blank, adjudicatorId: "synthetic-third",
      cases: blank.cases.map((item) => ({ ...item, finalDecision: "meaning_preserved",
        rationale: "Sentetik karar; yalnızca yapısal doğrulama sınanıyor." })) };
    expect(compilePromptDriftAdjudication(plan, a, b, filled)).toMatchObject({
      semanticStatus: "declared_preserved", unresolvedCount: 0,
    });
    expect(() => compilePromptDriftAdjudication(plan, a, b, { ...filled, adjudicatorId: a.reviewerId })).toThrow("eşleşmiyor");
    const disputed = { ...filled, cases: filled.cases.map((item, index) => index === 0
      ? { ...item, finalDecision: "uncertain" } : item) };
    expect(compilePromptDriftAdjudication(plan, a, b, disputed)).toMatchObject({ semanticStatus: "blocked", unresolvedCount: 1 });
  });
});
