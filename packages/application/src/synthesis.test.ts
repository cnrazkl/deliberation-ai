import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildCouncilReport, validateSynthesisDraft, validateSynthesisReview } from "@deliberation-ai/domain";
import { prepareSynthesis, runReviewedSynthesis, type SynthesisTextPort } from "./synthesis";
import type { SynthesisTextOutcome } from "@deliberation-ai/providers";
import type { SynthesisDraft } from "@deliberation-ai/contracts";

function report() {
  return buildCouncilReport([
    { memberId: "a", label: "private label", councilRole: "analyst", rawText: "private raw", citations: [], parsed: {
      summary: "A", claims: [{ statement: "The valve is open at 10.", quote: "open at 10", kind: "recommendation" },
        { statement: "The measurement is uncertain.", quote: "uncertain", kind: "risk" }] } },
    { memberId: "r", label: "private red", councilRole: "red-team", rawText: "private raw", citations: [], parsed: {
      summary: "R", claims: [{ statement: "The valve is closed at 10.", quote: "closed at 10", kind: "objection" }] } },
  ], []);
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const returned = (value: unknown, keepMetadata = false): SynthesisTextOutcome => {
  const wire = value !== null && typeof value === "object" ? { ...value } as Record<string, unknown> : value;
  if (!keepMetadata && wire !== null && typeof wire === "object") {
    delete (wire as Record<string, unknown>).sourceFingerprint; delete (wire as Record<string, unknown>).draftSha256;
  }
  return { status: "returned", result: { text: JSON.stringify(wire), model: "offline", remoteResponseId: "fixture",
    inputTokens: null, outputTokens: 120, tokenDetails: null, finishReason: "stop" } };
};
function draft(plan = prepareSynthesis("Test", report())): SynthesisDraft {
  return { sourceFingerprint: plan.fingerprint, paragraphs: plan.source.claims.map((claim) => ({ text: claim.statement, claimIds: [claim.claimId] })) };
}
function review(plan: ReturnType<typeof prepareSynthesis>, candidate: SynthesisDraft, rejected = false) {
  return { sourceFingerprint: plan.fingerprint, draftSha256: hash(candidate), checks: candidate.paragraphs.map((paragraph, paragraphIndex) => ({
    paragraphIndex, verdict: rejected ? "uncertain" : "preserved", rationale: "Offline model observation",
    quotes: paragraph.claimIds.map((claimId) => ({ claimId, quote: plan.source.claims.find((claim) => claim.claimId === claimId)!.statement })),
  })) };
}
function port(identity: string, callback: SynthesisTextPort["call"]): SynthesisTextPort { return { identity, call: vi.fn(callback) }; }

describe("reviewed synthesis with bounded repair and claim-ledger fallback", () => {
  it("retains all minority/red-team/uncertain claims without mutating canonical output or leaking raw/model labels", async () => {
    const original = report(); const before = structuredClone(original); const plan = prepareSynthesis("Test", original); const candidate = draft(plan);
    const generator = port("generator", async (_stage, input) => {
      expect(input.data).not.toMatch(/private raw|private label|private red/); return returned(candidate);
    });
    const reviewer = port("reviewer", async () => returned(review(plan, candidate)));
    const result = await runReviewedSynthesis(plan, generator, reviewer);
    expect(result).toMatchObject({ status: "model_reviewed_candidate", semanticValidation: "model_judgment_only", humanAcceptance: "not_assessed" });
    expect(result.fallback).toContain("closed at 10"); expect(result.renderedCandidate).toContain("unsupported");
    expect(result.attempts).toHaveLength(2); expect(original).toEqual(before);
    expect(result.reviews[0]).toMatchObject({ sourceFingerprint: plan.fingerprint, draftSha256: hash(candidate) });
    expect(JSON.parse(result.attempts[1]!.data)).not.toHaveProperty("draftSha256");
  });
  it("attempts only one repair and rechecks the repaired meaning using the same reviewer", async () => {
    const plan = prepareSynthesis("Test", report()); const candidate = draft(plan);
    const generator = port("a", async () => returned(candidate));
    const reviewer = port("b", async (stage) => returned(review(plan, candidate, stage === "review")));
    const result = await runReviewedSynthesis(plan, generator, reviewer);
    expect(result.status).toBe("model_reviewed_candidate");
    expect(result.attempts.map((attempt) => attempt.stage)).toEqual(["draft", "review", "repair", "repair_review"]);
  });
  it("refuses a historical protocol before dispatch and rejects provider-authored binding metadata", async () => {
    const plan = prepareSynthesis("Test", report()); const candidate = draft(plan);
    const generator = port("a", async () => returned(candidate)); const reviewer = port("b", async () => returned(review(plan, candidate), true));
    expect(await runReviewedSynthesis({ ...plan, version: "reviewed-synthesis-v2" }, generator, reviewer)).toMatchObject({ reason: "source_version_changed" });
    expect(generator.call).not.toHaveBeenCalled();
    expect(await runReviewedSynthesis(plan, generator, reviewer)).toMatchObject({ reason: "review_invalid", status: "fallback" });
    expect(reviewer.call).toHaveBeenCalledTimes(1);
  });
  it("falls back after the single repair is still uncertain, preserving rejected drafts and reviews", async () => {
    const plan = prepareSynthesis("Test", report()); const candidate = draft(plan);
    const result = await runReviewedSynthesis(plan, port("a", async () => returned(candidate)), port("b", async () => returned(review(plan, candidate, true))));
    expect(result).toMatchObject({ status: "fallback", reason: "repair_not_accepted", candidate: null });
    expect(result.candidates).toHaveLength(2); expect(result.reviews).toHaveLength(2); expect(result.attempts).toHaveLength(4);
  });
  it("repairs known returned invalid JSON once but never repairs unknown network outcomes", async () => {
    const plan = prepareSynthesis("Test", report()); const candidate = draft(plan);
    const generator = port("a", async (stage) => returned(stage === "draft" ? "invalid" : candidate));
    const result = await runReviewedSynthesis(plan, generator, port("b", async () => returned(review(plan, candidate))));
    expect(result.status).toBe("model_reviewed_candidate"); expect(result.attempts.map((attempt) => attempt.stage)).toEqual(["draft", "repair", "repair_review"]);
    const unknown = port("a", async () => ({ status: "failed", outcome: "unknown", code: "network_unknown", inputTokens: null, outputTokens: null }));
    const reviewer = port("b", async () => returned({}));
    expect(await runReviewedSynthesis(plan, unknown, reviewer)).toMatchObject({ status: "fallback", reason: "remote_outcome_unknown" });
    expect(unknown.call).toHaveBeenCalledTimes(1); expect(reviewer.call).not.toHaveBeenCalled();
  });
  it.each(["missing", "stale", "quote", "index", "duplicate", "oversized_rationale"])("rejects %s reviewer bindings without another provider call", async (kind) => {
    const plan = prepareSynthesis("Test", report()); const candidate = draft(plan); const response = review(plan, candidate);
    if (kind === "missing") response.checks.pop();
    if (kind === "stale") response.draftSha256 = "b".repeat(64);
    if (kind === "quote") response.checks[0]!.quotes[0]!.quote = "invented quote";
    if (kind === "index") response.checks[0]!.paragraphIndex = 7;
    if (kind === "duplicate") response.checks[1] = structuredClone(response.checks[0]!);
    if (kind === "oversized_rationale") response.checks[0]!.rationale = "x".repeat(401);
    const result = await runReviewedSynthesis(plan, port("a", async () => returned(candidate)), port("b", async () => returned(response, kind === "stale")));
    expect(result).toMatchObject({ status: "fallback", reason: "review_invalid" }); expect(result.attempts).toHaveLength(2);
  });
  it("rejects missing/unknown/duplicate draft claims and exact-quote swapping", () => {
    const plan = prepareSynthesis("Test", report()); const candidate = draft(plan);
    expect(() => validateSynthesisDraft(plan.source, plan.fingerprint, { ...candidate, paragraphs: candidate.paragraphs.slice(1) })).toThrow();
    const altered = structuredClone(candidate); altered.paragraphs[0]!.claimIds = ["invented"];
    expect(() => validateSynthesisDraft(plan.source, plan.fingerprint, altered)).toThrow();
    altered.paragraphs[0]!.claimIds = [candidate.paragraphs[0]!.claimIds[0]!, candidate.paragraphs[0]!.claimIds[0]!];
    expect(() => validateSynthesisDraft(plan.source, plan.fingerprint, altered)).toThrow();
    const response = review(plan, candidate); response.checks[0]!.quotes[0]!.quote = plan.source.claims[1]!.statement;
    expect(() => validateSynthesisReview(plan.source, candidate, hash(candidate), response)).toThrow();
  });
  it("admits only distinct reviewer targets and bounded trustworthy sources before any network call", async () => {
    const original = report(); original.distinctClaims[0]!.occurrences = [];
    const generator = port("same", async () => returned({})); const reviewer = port("same", async () => returned({}));
    expect(await runReviewedSynthesis(prepareSynthesis("Test", original), generator, reviewer)).toMatchObject({ reason: "source_ineligible" });
    expect(prepareSynthesis("Test", original).fallback).toContain("özgün yapılandırılmış üye iddiaları");
    expect(await runReviewedSynthesis(prepareSynthesis("Test", report()), generator, reviewer)).toMatchObject({ reason: "distinct_reviewer_required" });
    expect(await runReviewedSynthesis(prepareSynthesis("x".repeat(4_001), report()), generator, reviewer)).toMatchObject({ reason: "source_ineligible" });
    expect(generator.call).not.toHaveBeenCalled(); expect(reviewer.call).not.toHaveBeenCalled();
  });
  it("binds changes to annotations, scope, source questions and parsed review observations", () => {
    const original = report(); const plan = prepareSynthesis("Test", original);
    const scoped = structuredClone(original); scoped.distinctClaims[0]!.scopeNote = "Other time";
    expect(prepareSynthesis("Test", scoped).fingerprint).not.toBe(plan.fingerprint);
    const annotated = structuredClone(original); annotated.distinctClaims[0]!.synthesisCoverage = "omitted";
    expect(prepareSynthesis("Test", annotated).fingerprint).not.toBe(plan.fingerprint);
    expect(prepareSynthesis("Another question", original).fingerprint).not.toBe(plan.fingerprint);
    const high = { ...original, riskControls: { profile: "high" as const, redTeamCompleted: true, crossReviewCompleted: false, claimTransferComplete: true, complete: false } };
    expect(prepareSynthesis("Test", high).eligible).toBe(false);
    expect(prepareSynthesis("Test", high).fingerprint).not.toBe(plan.fingerprint);
    const complete = { ...high, riskControls: { ...high.riskControls, complete: true } };
    expect(prepareSynthesis("Test", complete).fingerprint).not.toBe(prepareSynthesis("Test", high).fingerprint);
  });
  it("requires durable submission before calling and preserves the fallback on a failed persistence/revalidation boundary", async () => {
    const plan = prepareSynthesis("Test", report()); const candidate = draft(plan);
    const generator = port("a", async () => returned(candidate)); const reviewer = port("b", async () => returned(review(plan, candidate)));
    const before = vi.fn(async () => { throw new Error("sensitive local detail"); });
    const blocked = await runReviewedSynthesis(plan, generator, reviewer, { before, after: async () => {} });
    expect(blocked).toMatchObject({ reason: "local_guard_or_journal_unavailable", status: "fallback" }); expect(generator.call).not.toHaveBeenCalled();
    const result = await runReviewedSynthesis(plan, generator, reviewer, { before: async () => {}, after: async () => { throw new Error("source changed"); } });
    expect(result.status).toBe("fallback"); expect(result.attempts).toHaveLength(1); expect(reviewer.call).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("source changed");
  });
  it.each(["length", "cap"])("never repairs %s output and keeps actual usage", async (kind) => {
    const plan = prepareSynthesis("Test", report()); const outcome = returned(draft(plan));
    if (outcome.status !== "returned") throw new Error("Fixture");
    if (kind === "length") outcome.result.finishReason = "length";
    else outcome.result.outputTokens = 5_000;
    const result = await runReviewedSynthesis(plan, port("a", async () => outcome), port("b", async () => returned({})));
    expect(result).toMatchObject({ reason: "generation_incomplete_or_cap_exceeded", status: "fallback" }); expect(result.attempts).toHaveLength(1);
  });
});
