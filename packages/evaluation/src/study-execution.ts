import { prepareReviewRoundComparison } from "./review-round-comparison";
import { preparePromptComparison } from "./prompt-comparison";
import { sha256 } from "./external-council-intake";
import { z } from "zod";

export type StudySelection = { kind: "rounds" | "prompt"; caseIds: string[]; memberCount: number; maxCalls: number; outputTokens: number; maxConcurrentArms?: number | undefined };
/** No gold is generated. A selected subset remains a diagnostic, never the whole study. */
export function prepareStudyExecution(suite: unknown, selection: StudySelection) {
  selection = z.object({ kind: z.enum(["rounds", "prompt"]), caseIds: z.array(z.string().min(1).max(120)).min(1).max(40),
    memberCount: z.number().int().min(2).max(6), maxCalls: z.number().int().min(1).max(2_000),
    outputTokens: z.number().int().min(128).max(4_096), maxConcurrentArms: z.number().int().min(1).max(4).optional() }).strict().parse(selection);
  if (new Set(selection.caseIds).size !== selection.caseIds.length) throw new Error("Duplicate study case");
  const comparison = prepareReviewRoundComparison(suite);
  const prompt = selection.kind === "prompt" ? preparePromptComparison(suite) : null;
  const arms = selection.caseIds.flatMap((caseId) => {
    const original = comparison.cases.find((item) => item.caseId === caseId);
    if (!original) throw new Error("Unknown frozen case");
    if (selection.kind === "rounds") return original.eligibleRounds.map((reviewRounds) => ({
      caseId, arm: `round-${reviewRounds}`, question: original.question, riskProfile: original.effectiveRiskProfile, reviewRounds,
    }));
    const paired = prompt!.cases.find((item) => item.caseId === caseId)!;
    return ["original", "candidate"].map((arm) => ({ caseId, arm,
      question: arm === "original" ? paired.originalQuestion : paired.candidateQuestion,
      riskProfile: original.effectiveRiskProfile, reviewRounds: 1 as const }));
  });
  const plannedCalls = arms.reduce((sum, arm) => sum + selection.memberCount * (1 + arm.reviewRounds), 0);
  if (plannedCalls > selection.maxCalls) throw new Error("Study call ceiling exceeded");
  const frozen = { version: "study-execution-v1", suiteSha256: comparison.suiteSha256,
    promptPlanSha256: prompt?.planSha256 ?? null, selection, arms, plannedCalls,
    selectedCases: selection.caseIds.length, totalCases: comparison.cases.length,
    humanAcceptance: "not_assessed", accuracy: null, invoiceCost: "unknown" };
  return { ...frozen, fingerprint: sha256(JSON.stringify(frozen)) };
}
export type StudyExecutionPlan = ReturnType<typeof prepareStudyExecution>;

export function matchesFrozenStudyReviewPolicy(expected: {memberId:string;round:number;instructions:string}[],
  actual: {reviewerMemberId:string;round:number;instructions:string}[],attempted: {memberId:string;round:number}[]): boolean {
  const frozen=new Map(expected.map(item=>[`${item.memberId}:${item.round}`,item.instructions]));
  const seen=new Set<string>();
  for (const item of actual) {
    const key=`${item.reviewerMemberId}:${item.round}`;
    if (seen.has(key) || frozen.get(key)!==item.instructions) return false;
    seen.add(key);
  }
  return attempted.every(item=>seen.has(`${item.memberId}:${item.round}`));
}
