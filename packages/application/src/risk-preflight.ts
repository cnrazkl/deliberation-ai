import { createHash } from "node:crypto";
import { assessRequestRisk, type RiskInput } from "@deliberation-ai/domain";

export function buildRiskPreflight(input: RiskInput & { promptFingerprint: string; reviewRounds: number }) {
  const assessment = assessRequestRisk(input);
  const fingerprint = createHash("sha256").update(JSON.stringify({ assessment, promptFingerprint: input.promptFingerprint, reviewRounds: input.reviewRounds })).digest("hex");
  return { assessment, fingerprint };
}
