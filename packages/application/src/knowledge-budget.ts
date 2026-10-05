import { getEncoding } from "js-tiktoken";
import type { RoundZeroPromptPlan } from "./prompt-plan";
const encoding = getEncoding("o200k_base");
export function assertKnowledgeInputBudget(plan: RoundZeroPromptPlan) {
  // A local planning ceiling, not a provider tokenizer or a guaranteed model window.
  if (plan.members.some((member) => encoding.encode(member.instructions).length + encoding.encode(member.userInput).length > 24_000))
    throw new Error("Kaynak paketli girdi 24.000 tahmini token sınırını aşıyor; bağlamı daraltın.");
}
