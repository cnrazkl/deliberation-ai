import { describe, expect, it } from "vitest";
import { auditPromptRevision, PROMPT_REVISION_VERSION, suggestStructuredQuestion } from "./prompt-revision";

describe("prompt revision audit", () => {
  it("proposes only additive instructions and shows exact additions", () => {
    const originalQuestion = "Bu kararı hangi kanıtlara göre vermeliyim?";
    const candidateQuestion = suggestStructuredQuestion(originalQuestion);
    const audit = auditPromptRevision({ version: PROMPT_REVISION_VERSION, originalQuestion, candidateQuestion, choice: "candidate" });
    expect(audit).toMatchObject({ originalPreserved: true, changed: true, prefix: "", canSelectCandidate: true });
    expect(audit.suffix).toContain("Kaynak veya kesinlik uydurma.");
    expect(audit.selectedQuestion).toBe(candidateQuestion);
  });

  it("rejects omission and cannot lower the original lexical risk floor", () => {
    const originalQuestion = "İlaç dozunu değiştirmeli miyim?";
    expect(auditPromptRevision({ version: PROMPT_REVISION_VERSION, originalQuestion,
      candidateQuestion: "Dozu değiştir.", choice: "candidate" })).toMatchObject({ originalPreserved: false, canSelectCandidate: false });
    const selected = auditPromptRevision({ version: PROMPT_REVISION_VERSION, originalQuestion,
      candidateQuestion: suggestStructuredQuestion(originalQuestion), choice: "candidate" });
    expect(selected.originalRiskProfile).toBe("high");
    expect(selected.selectedRiskProfile).toBe("high");
  });
});
