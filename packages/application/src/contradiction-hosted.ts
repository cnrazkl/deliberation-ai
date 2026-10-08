import { SYNTHESIS_OUTPUT_TOKENS } from "@deliberation-ai/contracts";
import type { SynthesisTextPort, SynthesisJournal } from "./synthesis";
import type { SynthesisTextOutcome } from "@deliberation-ai/providers";

export const HOSTED_CONTRADICTION_VERSION = "hosted-contradiction-v2";
export const HOSTED_CONTRADICTION_SUFFIX = "Copy the supplied fingerprint exactly; do not calculate it. Return strict JSON only, no markdown. relation is exactly contradiction, compatible or unresolved. comparableScope is a string exactly yes, no or unknown, never a boolean. Use at most 12 results and at most 400 characters per rationale. Every selected pair needs one result; no invented pair IDs. This is a shadow model observation, not an independent label or truth certification.";

/** Structural evaluation port: no provider wire value or production claim mutation. */
export function createHostedContradictionEvaluator(port: SynthesisTextPort, journal: SynthesisJournal) {
  return { version: HOSTED_CONTRADICTION_VERSION,
    async evaluate(input: { instructions: string; data: string }): Promise<unknown> {
      if (input.data.length > 12_000) throw new Error("Contradiction input bound");
      const frozen = { instructions: `${input.instructions} ${HOSTED_CONTRADICTION_SUFFIX}`, data: input.data };
      await journal.before("review", frozen);
      let outcome: SynthesisTextOutcome;
      try { outcome = await port.call("review", frozen); }
      catch { outcome = { status: "failed", outcome: "unknown", code: "contradiction_transport_unavailable", inputTokens: null, outputTokens: null }; }
      await journal.after({ stage: "review", ...frozen, outcome });
      if (outcome.status !== "returned" || outcome.result.finishReason !== "stop" ||
        (outcome.result.outputTokens ?? 0) > SYNTHESIS_OUTPUT_TOKENS) throw new Error("Unusable contradiction response");
      return JSON.parse(outcome.result.text) as unknown;
    } };
}
