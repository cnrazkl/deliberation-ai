import { describe, expect, it, vi } from "vitest";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { planContradictionReview, runContradictionReview, scoreContradictionReview, type ContradictionReviewPlan } from "./contradiction-review";
import { createContradictionLabelWorksheet, compileContradictionLabelWorksheet, createContradictionAdjudicationWorksheet, compileContradictionAdjudicationWorksheet } from "./contradiction-labeling";

function report() {
  return buildCouncilReport([
    { memberId: "analyst", label: "Private model label", councilRole: "analyst", rawText: "private raw text", citations: [], parsed: {
      summary: "Permit", claims: [{ statement: "The permit is valid in 2025.", quote: "valid", kind: "shared" },
        { statement: "The permit is not valid in 2025.", quote: "not valid", kind: "objection" }],
    } },
    { memberId: "red", label: "Red team", councilRole: "red-team", rawText: "private raw text", citations: [], parsed: {
      summary: "Scope", claims: [{ statement: "The permit is valid in 2024.", quote: "2024", kind: "objection" }],
    } },
  ], []);
}
const settings = { maxPairs: 3, sourceSetSha256: "a".repeat(64), evaluatorVersion: "fixture-v1" };
function batch(plan: ContradictionReviewPlan) {
  return { fingerprint: plan.fingerprint, results: plan.pairs.map((pair) => ({ pairId: pair.id,
    relation: "unresolved", comparableScope: "unknown", leftQuote: pair.left.statement, rightQuote: pair.right.statement, rationale: "Synthetic fixture" })) };
}

describe("bounded semantic contradiction shadow design", () => {
  it("preserves minority pairs, masks model identities and invalidates changed scopes, sources and versions", async () => {
    const original = report(); const before = structuredClone(original);
    const plan = planContradictionReview(original, settings);
    expect(plan.pairs).toHaveLength(3);
    const evaluate = vi.fn(async ({ data }: { data: string }) => {
      expect(data).not.toContain("Private model label"); expect(data).not.toContain("private raw text");
      return batch(plan);
    });
    expect((await runContradictionReview(plan, { version: settings.evaluatorVersion, evaluate })).outcomes.every((item) => item.status === "assessed")).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1); expect(original).toEqual(before);
    const scoped = structuredClone(original); scoped.redTeamChallenges[0]!.scopeNote = "Different jurisdiction";
    expect(planContradictionReview(scoped, settings).fingerprint).not.toBe(plan.fingerprint);
    expect(planContradictionReview(original, { ...settings, sourceSetSha256: "b".repeat(64) }).fingerprint).not.toBe(plan.fingerprint);
    await expect(runContradictionReview(plan, { version: "other", evaluate })).rejects.toThrow("sürümü");
  });

  it("records budget omissions as unassessed and measures candidate misses across ALL pairs", async () => {
    const plan = planContradictionReview(report(), { ...settings, maxPairs: 0 });
    const evaluate = vi.fn(); const result = await runContradictionReview(plan, { version: settings.evaluatorVersion, evaluate });
    expect(evaluate).not.toHaveBeenCalled();
    const gold = plan.allPairIds.map((pairId) => ({ pairId, relation: "contradiction", critical: true }));
    const score = scoreContradictionReview(plan, result, gold);
    expect(score).toMatchObject({ candidateRecall: 0, contradictionRecall: 0, notAssessedCount: 3 });
    expect(score.criticalMissedPairIds).toHaveLength(3);
    expect(() => scoreContradictionReview(plan, result, gold.slice(1))).toThrow("bütün çiftleri");
  });

  it.each(["unknown-id", "duplicate", "quote", "scope", "stale", "throw"])("keeps %s failure unassessed without retrying", async (failure) => {
    const plan = planContradictionReview(report(), settings); const value = batch(plan);
    if (failure === "unknown-id") value.results[0]!.pairId = "invented";
    if (failure === "duplicate") value.results[0]!.pairId = value.results[1]!.pairId;
    if (failure === "quote") value.results[0]!.leftQuote = "invented quote";
    if (failure === "scope") value.results[0]!.relation = "contradiction";
    if (failure === "stale") value.fingerprint = "b".repeat(64);
    const evaluate = vi.fn(async () => { if (failure === "throw") throw new Error("sensitive provider detail"); return value; });
    const result = await runContradictionReview(plan, { version: settings.evaluatorVersion, evaluate });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(result.outcomes.every((item) => item.status === "not_assessed" && item.reason === "failed_or_invalid")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });

  it("rejects altered claim ledgers and keeps empty denominators unavailable", async () => {
    const altered = report(); altered.distinctClaims[0]!.occurrences = [];
    expect(() => planContradictionReview(altered, settings)).toThrow("bozuk");
    const plan = planContradictionReview(report(), settings);
    const result = await runContradictionReview(plan, { version: settings.evaluatorVersion, evaluate: async () => batch(plan) });
    const score = scoreContradictionReview(plan, result, plan.allPairIds.map((pairId) => ({ pairId, relation: "compatible", critical: false })));
    expect(score.contradictionRecall).toBeNull(); expect(score.candidateRecall).toBeNull(); expect(score.unresolvedCount).toBe(3);
  });

  it("reports false alarms and detected contradictions separately from candidate coverage", async () => {
    const plan = planContradictionReview(report(), settings);
    const value = batch(plan);
    value.results.forEach((item) => { item.relation = "contradiction"; item.comparableScope = "yes"; });
    const result = await runContradictionReview(plan, { version: settings.evaluatorVersion, evaluate: async () => value });
    const score = scoreContradictionReview(plan, result, plan.allPairIds.map((pairId, index) => ({ pairId, relation: index === 0 ? "contradiction" : "compatible", critical: true })));
    expect(score).toMatchObject({ candidateRecall: 1, contradictionRecall: 1, falseAlarmCount: 2, falseAlarmRate: 1, criticalMissedPairIds: [] });
  });

  it("requires independent pair reviews and third-person adjudication without prefilled decisions or selection hints", () => {
    const plan = planContradictionReview(report(), { ...settings, maxPairs: 1 });
    const draft = createContradictionLabelWorksheet(plan);
    expect(draft.pairs).toHaveLength(3);
    expect(JSON.stringify(draft)).not.toContain("priority");
    expect(draft.pairs.every((pair) => pair.decision === null)).toBe(true);
    expect(() => compileContradictionLabelWorksheet(plan, draft)).toThrow();
    const review = (reviewerId: string) => ({ ...draft, reviewerId, pairs: draft.pairs.map((pair) => ({ ...pair,
      decision: { relation: "unresolved", comparableScope: "unknown", critical: true, rationale: "Synthetic reviewer decision" },
    })) });
    const a = review("person-a"), b = review("person-b");
    expect(() => createContradictionAdjudicationWorksheet(plan, [a, a])).toThrow("bağımsız");
    const adjudication = createContradictionAdjudicationWorksheet(plan, [a, b]);
    expect(() => compileContradictionAdjudicationWorksheet(plan, [a, b], adjudication)).toThrow();
    const completed = { ...adjudication, adjudicatorId: "person-c", pairs: adjudication.pairs.map((pair) => ({ ...pair, decision: {
      relation: "unresolved", comparableScope: "unknown", critical: true, rationale: "Synthetic final reasoning",
    } })) };
    expect(compileContradictionAdjudicationWorksheet(plan, [a, b], completed).gold).toHaveLength(3);
    expect(() => compileContradictionAdjudicationWorksheet(plan, [a, b], { ...completed, adjudicatorId: "person-a" })).toThrow("Ayrı hakem");
    const changed = structuredClone(b); changed.pairs[0]!.decision.rationale = "Changed review";
    expect(() => compileContradictionAdjudicationWorksheet(plan, [a, changed], completed)).toThrow("değiştirilmemiş");
  });
});
