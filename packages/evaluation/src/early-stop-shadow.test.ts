import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { buildCouncilReport, type CouncilMemberResult, type CouncilReviewResult, type CrossReviewPromptPlan } from "@deliberation-ai/domain";
import { assessEarlyStopShadow } from "./early-stop-shadow";

const members = [
  { id: "analyst-a", councilRole: "analyst" as const },
  { id: "analyst-b", councilRole: "analyst" as const },
];

function reportFixture() {
  const initial: CouncilMemberResult[] = members.map((member) => ({
    memberId: member.id, label: member.id, councilRole: member.councilRole,
    rawText: "fixture", citations: [],
    parsed: { summary: `İlk özet ${member.id}`, claims: [{ statement: `İlk iddia ${member.id}`, kind: "risk", quote: `İlk iddia ${member.id}` }] },
  }));
  const reviews: CouncilReviewResult[] = ([1, 2, 3] as const).flatMap((round) => members.map((member) => ({
    round, reviewerMemberId: member.id, reviewerLabel: member.id, reviewerCouncilRole: member.councilRole,
    rawText: "fixture", citations: [],
    parsed: { summary: "Aynı koşullar", claims: [{ statement: "Koşul yeniden kontrol edilmeli", kind: "objection" as const,
      quote: "İlk iddia", targetMemberId: member.id === "analyst-a" ? "analyst-b" : "analyst-a", reviewStance: "qualify" as const }] },
  })));
  const plans: CrossReviewPromptPlan[] = reviews.map((review) => {
    const version = review.round === 1 ? "cross-review-v1" : "cross-review-v2";
    const peerMemberIds = [review.reviewerMemberId === "analyst-a" ? "analyst-b" : "analyst-a"];
    const instructions = "Review prompt";
    const input = "{}";
    const fingerprint = createHash("sha256").update(JSON.stringify({
      version, ...(review.round > 1 ? { round: review.round } : {}),
      reviewerMemberId: review.reviewerMemberId, peerMemberIds, instructions, input,
    })).digest("hex");
    return { version, round: review.round, reviewerMemberId: review.reviewerMemberId,
      reviewerLabel: review.reviewerLabel, peerMemberIds, instructions, input, fingerprint };
  });
  return buildCouncilReport(initial, [], reviews, [], plans, {
    requestedRounds: 3, completedRounds: 3, stopReason: "round_limit",
  });
}

describe("retrospective early-stop shadow", () => {
  test("flags exact parsed repetition without ever authorizing automatic stopping", () => {
    const result = assessEarlyStopShadow(reportFixture(), members, 2, "standard");
    expect(result.observation).toBe("exact_repeat");
    expect(result.automaticStopAllowed).toBe(false);
    expect(result.reasons).toContain("semantic_materiality_unassessed");
    expect(result.reasons).toContain("accuracy_effect_unmeasured");
  });

  test("detects changed claims and self-revision proposals without dropping earlier views", () => {
    const report = reportFixture();
    const changed = report.reviews.find((review) => review.round === 2 && review.reviewerMemberId === "analyst-a")!;
    changed.parsed = { ...changed.parsed, claims: [{ ...changed.parsed.claims[0]!, statement: "Yeni zaman koşulu", reviewStance: "challenge" }],
      selfRevisions: [{ sourceClaimIndex: 0, action: "qualify", statement: "Yeni koşullu iddia", reason: "Yeni bilgi" }] };
    const result = assessEarlyStopShadow(report, members, 2, "standard");
    expect(result.observation).toBe("changed");
    expect(result.reasons).toContain("review_content_changed");
    expect(result.reasons).toContain("unresolved_challenge");
    expect(report.memberResults[0]?.parsed.claims[0]?.statement).toBe("İlk iddia analyst-a");
  });

  test("does not infer stability from one round or an incomplete review packet", () => {
    const report = reportFixture();
    expect(assessEarlyStopShadow(report, members, 1, "standard")).toMatchObject({
      observation: "unavailable", automaticStopAllowed: false,
      reasons: expect.arrayContaining(["insufficient_history"]),
    });
    report.reviewPromptPlans = report.reviewPromptPlans!.filter((plan) => !(plan.round === 2 && plan.reviewerMemberId === "analyst-b"));
    expect(assessEarlyStopShadow(report, members, 2, "standard")).toMatchObject({
      observation: "unavailable", reasons: expect.arrayContaining(["review_input_unverifiable"]),
    });
  });

  test("fails closed on altered prompt provenance or mixed review protocols", () => {
    const report = reportFixture();
    report.reviewPromptPlans![2]!.fingerprint = "0".repeat(64);
    expect(assessEarlyStopShadow(report, members, 2, "standard")).toMatchObject({
      observation: "unavailable", reasons: expect.arrayContaining(["review_input_unverifiable"]),
    });
    const mixed = reportFixture();
    mixed.reviewPromptPlans![2]!.version = "cross-review-v3";
    expect(assessEarlyStopShadow(mixed, members, 2, "standard")).toMatchObject({
      observation: "unavailable", reasons: expect.arrayContaining(["protocol_changed"]),
    });
  });

  test("requires completed member work and the mandatory high-risk red-team", () => {
    const report = reportFixture();
    report.failures.push({ memberId: "analyst-c", label: "C", code: "provider_error", message: "failed" });
    const result = assessEarlyStopShadow(report, members, 2, "high");
    expect(result.observation).toBe("unavailable");
    expect(result.reasons).toEqual(expect.arrayContaining(["initial_member_incomplete", "mandatory_red_team_incomplete"]));
  });
});
