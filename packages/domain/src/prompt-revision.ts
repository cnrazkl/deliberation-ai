import { assessRequestRisk } from "./risk-preflight";

export const PROMPT_REVISION_VERSION = "prompt-revision-v1";
export type PromptRevision = {
  version: typeof PROMPT_REVISION_VERSION;
  originalQuestion: string;
  candidateQuestion: string;
  choice: "original" | "candidate";
};

const responseFrame = "\n\nYanıt çerçevesi (isteğe bağlı):\n- Belirsiz varsayımları ve eksik bilgileri belirt.\n- Karşı görüşleri ve önemli riskleri koru.\n- Kaynak veya kesinlik uydurma.";

/** A deterministic additive candidate; this is not a semantic optimization claim. */
export function suggestStructuredQuestion(originalQuestion: string): string {
  const original = originalQuestion.trim();
  return original.length + responseFrame.length <= 4_000 ? `${original}${responseFrame}` : original;
}

export function auditPromptRevision(revision: PromptRevision) {
  const original = revision.originalQuestion.trim();
  const candidate = revision.candidateQuestion.trim();
  const first = candidate.indexOf(original);
  const second = first < 0 ? -1 : candidate.indexOf(original, first + original.length);
  const originalPreserved = original.length >= 10 && first >= 0 && second < 0;
  const selectedQuestion = revision.choice === "candidate" ? candidate : original;
  const issues: string[] = [];
  if (revision.version !== PROMPT_REVISION_VERSION) issues.push("Revizyon sürümü geçersiz.");
  if (original.length < 10 || original.length > 4_000 || candidate.length < 10 || candidate.length > 4_000) issues.push("İstem 10–4000 karakter olmalı.");
  if (!originalPreserved) issues.push("Aday, özgün soruyu değiştirmeden ve yalnızca bir kez içermeli.");
  const originalRisk = assessRequestRisk({ question: original, requestedProfile: "standard" });
  const selectedRisk = assessRequestRisk({ question: selectedQuestion, requestedProfile: "standard" });
  return {
    version: PROMPT_REVISION_VERSION,
    originalPreserved,
    selectedQuestion,
    prefix: originalPreserved ? candidate.slice(0, first) : "",
    suffix: originalPreserved ? candidate.slice(first + original.length) : "",
    changed: candidate !== original,
    originalRiskProfile: originalRisk.effectiveProfile,
    selectedRiskProfile: selectedRisk.effectiveProfile,
    issues,
    canSelectCandidate: issues.length === 0,
  };
}
