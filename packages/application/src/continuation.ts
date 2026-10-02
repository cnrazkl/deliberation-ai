import { createHash } from "node:crypto";
import { frozenContinuationSchema, MAX_CONTINUATION_BYTES, type FrozenContinuation, type RiskProfile } from "@deliberation-ai/contracts";

export function fingerprintContinuation(input: Omit<FrozenContinuation, "sha256">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function freezeContinuation(input: { sourceRunId: string; sourceRiskProfile: RiskProfile; content: string; version?: FrozenContinuation["version"] }): FrozenContinuation {
  if (Buffer.byteLength(input.content, "utf8") > MAX_CONTINUATION_BYTES) {
    throw new Error("Geçmiş bağlam 256 KiB sınırını aşıyor; otomatik kısaltma yapılmadı.");
  }
  const value = { version: input.version ?? "run-continuation-v1", sourceRunId: input.sourceRunId, sourceRiskProfile: input.sourceRiskProfile, content: input.content };
  return frozenContinuationSchema.parse({ ...value, sha256: fingerprintContinuation(value) });
}

export function validateContinuation(value: unknown): FrozenContinuation {
  const context = frozenContinuationSchema.parse(value);
  const expected = freezeContinuation({ version: context.version, sourceRunId: context.sourceRunId, sourceRiskProfile: context.sourceRiskProfile, content: context.content });
  if (context.sha256 !== expected.sha256) throw new Error("Kaydedilen geçmiş bağlam doğrulanamadı.");
  return context;
}
