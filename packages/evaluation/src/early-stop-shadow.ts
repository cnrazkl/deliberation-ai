import { createHash } from "node:crypto";
import type { CouncilReport, CouncilReviewResult, CrossReviewPromptPlan } from "@deliberation-ai/domain";

type ReviewMember = { id: string; councilRole: "analyst" | "red-team" };

export type EarlyStopShadowReason =
  | "no_future_round"
  | "insufficient_history"
  | "initial_member_incomplete"
  | "review_barrier_incomplete"
  | "review_input_unverifiable"
  | "protocol_changed"
  | "mandatory_red_team_incomplete"
  | "review_content_changed"
  | "unresolved_challenge"
  | "semantic_materiality_unassessed"
  | "accuracy_effect_unmeasured";

export type EarlyStopShadowAssessment = {
  version: "early-stop-shadow-v1";
  afterRound: 1 | 2;
  observation: "unavailable" | "changed" | "exact_repeat";
  automaticStopAllowed: false;
  reasons: EarlyStopShadowReason[];
};

const normalized = (text: string): string => text.normalize("NFKC").trim().replace(/\s+/g, " ");

function reviewSignature(review: CouncilReviewResult): string {
  return JSON.stringify({
    summary: normalized(review.parsed.summary),
    claims: review.parsed.claims.map((claim) => ({
      targetMemberId: claim.targetMemberId,
      reviewStance: claim.reviewStance,
      kind: claim.kind,
      statement: normalized(claim.statement),
      quote: normalized(claim.quote),
    })),
    selfRevisions: "selfRevisions" in review.parsed
      ? review.parsed.selfRevisions.map((revision) => ({
          sourceClaimIndex: revision.sourceClaimIndex,
          action: revision.action,
          statement: normalized(revision.statement),
          reason: normalized(revision.reason),
        }))
      : null,
    citations: review.citations.map((citation) => ({ url: citation.url, title: citation.title ?? null }))
      .sort((left, right) => left.url.localeCompare(right.url)),
  });
}

function completeRoundPacket(
  report: CouncilReport,
  members: ReviewMember[],
  round: 1 | 2,
): { reviews: Map<string, CouncilReviewResult>; complete: boolean; promptComplete: boolean } {
  const reviews = report.reviews.filter((review) => review.round === round);
  const plans = (report.reviewPromptPlans ?? []).filter((plan) => plan.round === round);
  const memberIds = members.map((member) => member.id);
  const reviewByMember = new Map(reviews.map((review) => [review.reviewerMemberId, review]));
  const planByMember = new Map(plans.map((plan) => [plan.reviewerMemberId, plan]));
  const complete = reviews.length === memberIds.length && reviewByMember.size === memberIds.length &&
    memberIds.every((id) => {
      const review = reviewByMember.get(id);
      const targets = review?.parsed.claims.map((claim) => claim.targetMemberId) ?? [];
      const expected = memberIds.filter((peerId) => peerId !== id);
      return review && targets.length >= expected.length && expected.every((target) => targets.includes(target)) &&
        targets.every((target) => expected.includes(target));
    });
  const promptComplete = plans.length === memberIds.length && planByMember.size === memberIds.length &&
    memberIds.every((id) => {
      const plan: CrossReviewPromptPlan | undefined = planByMember.get(id);
      if (!plan || !plan.instructions || !plan.input) return false;
      const expectedPeers = memberIds.filter((peerId) => peerId !== id);
      const expectedFingerprint = createHash("sha256").update(JSON.stringify({
        version: plan.version, ...(round > 1 ? { round } : {}), reviewerMemberId: id,
        peerMemberIds: expectedPeers, instructions: plan.instructions, input: plan.input,
      })).digest("hex");
      return (plan.version === "cross-review-v3" || plan.version === (round === 1 ? "cross-review-v1" : "cross-review-v2")) &&
        plan.fingerprint === expectedFingerprint && JSON.stringify(plan.peerMemberIds) === JSON.stringify(expectedPeers);
    });
  return { reviews: reviewByMember, complete: Boolean(complete), promptComplete: Boolean(promptComplete) };
}

/** Retrospective structural observation only. No value from this function authorizes a worker to skip a round. */
export function assessEarlyStopShadow(
  report: CouncilReport,
  members: ReviewMember[],
  afterRound: 1 | 2,
  riskProfile: "standard" | "high",
): EarlyStopShadowAssessment {
  const reasons: EarlyStopShadowReason[] = [];
  const execution = report.reviewExecution;
  if (!execution || execution.requestedRounds <= afterRound) reasons.push("no_future_round");
  if (afterRound === 1) reasons.push("insufficient_history");

  const ids = members.map((member) => member.id);
  const completedIds = report.memberResults.map((member) => member.memberId);
  if (ids.length < 2 || ids.length !== completedIds.length || new Set(completedIds).size !== ids.length ||
      ids.some((id) => !completedIds.includes(id)) || report.failures.length > 0) {
    reasons.push("initial_member_incomplete");
  }
  if (riskProfile === "high" && !members.some((member) => member.councilRole === "red-team" && completedIds.includes(member.id))) {
    reasons.push("mandatory_red_team_incomplete");
  }

  const requiredRounds = afterRound === 2 ? [1, 2] as const : [1] as const;
  const packets = requiredRounds.map((round) => completeRoundPacket(report, members, round));
  if (!execution || execution.completedRounds < afterRound ||
      report.reviewFailures.some((failure) => failure.round <= afterRound) || packets.some((packet) => !packet.complete)) {
    reasons.push("review_barrier_incomplete");
  }
  if (packets.some((packet) => !packet.promptComplete)) reasons.push("review_input_unverifiable");
  if (afterRound === 2) {
    const variants = new Set((report.reviewPromptPlans ?? [])
      .filter((plan) => plan.round === 1 || plan.round === 2)
      .map((plan) => plan.version === "cross-review-v3"));
    if (variants.size > 1) {
      reasons.push("protocol_changed");
    }
  }

  let observation: EarlyStopShadowAssessment["observation"] = "unavailable";
  const structuralReady = reasons.length === 0;
  if (afterRound === 2 && structuralReady) {
    const prior = packets[0]!.reviews;
    const current = packets[1]!.reviews;
    observation = ids.every((id) => reviewSignature(prior.get(id)!) === reviewSignature(current.get(id)!))
      ? "exact_repeat" : "changed";
    if (observation === "changed") reasons.push("review_content_changed");
  }
  if (packets.at(-1)?.reviews && [...packets.at(-1)!.reviews.values()].some((review) =>
    review.parsed.claims.some((claim) => claim.reviewStance === "challenge"))) {
    reasons.push("unresolved_challenge");
  }
  // Exact text repetition cannot prove material stability, source coverage, or a safe accuracy effect.
  reasons.push("semantic_materiality_unassessed", "accuracy_effect_unmeasured");
  return { version: "early-stop-shadow-v1", afterRound, observation, automaticStopAllowed: false, reasons };
}
