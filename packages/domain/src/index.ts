export { assessRequestRisk, assertRiskConfiguration, RiskConfigurationError, type RiskInput } from "./risk-preflight";
export { renderPrivateDelivery, assessPrivateDelivery } from "./private-delivery";
export { summarizePrivateUsage, type PrivateUsageCounter } from "./private-usage";
export { summarizeConversationPrivateUsage, PrivateUsageIntegrityError } from "./conversation-private-usage";
export { plannedProviderCalls, executionPlanFits, executionReservationAllowed, ExecutionPlanLimitsError } from "./execution-limits";
export { findCriticalMissingContext, composeClarifiedQuestion, PREFLIGHT_CONTEXT_POLICY_VERSION, preflightQuestionsSchema, missingContextQuestionSchema, MissingContextError, type MissingContextQuestion, type PreflightChoice } from "./missing-context";
export { PROMPT_REVISION_VERSION, suggestStructuredQuestion, auditPromptRevision, type PromptRevision } from "./prompt-revision";
import type {
  CouncilRole,
  CouncilMemberConfig,
  ClaimRelationKind,
  CrossReviewOutput,
  CrossReviewWithRevisionOutput,
  CrossReviewRound,
  EvidenceState,
  ProviderCitation,
  ProviderOutput,
  RunStatus,
  RiskProfile,
  ReviewRoundCount,
  SynthesisCoverage,
} from "@deliberation-ai/contracts";

export type CouncilMemberResult = {
  memberId: string;
  label: string;
  councilRole: CouncilRole;
  agreementSource?: string;
  rawText: string;
  parsed: ProviderOutput;
  citations: ProviderCitation[];
  reusedFromRunId?: string;
};

export type MemberFailure = {
  memberId: string;
  label: string;
  councilRole?: CouncilRole;
  code: string;
  message: string;
  rawText?: string;
};

export type CouncilReviewResult = {
  round: CrossReviewRound;
  reviewerMemberId: string;
  reviewerLabel: string;
  reviewerCouncilRole: CouncilRole;
  rawText: string;
  parsed: CrossReviewOutput | CrossReviewWithRevisionOutput;
  citations: ProviderCitation[];
};

export type ReviewFailure = MemberFailure & { round: CrossReviewRound };

export type CrossReviewPromptPlan = {
  version: "cross-review-v1" | "cross-review-v2" | "cross-review-v3";
  round: CrossReviewRound;
  reviewerMemberId: string;
  reviewerLabel: string;
  peerMemberIds: string[];
  instructions: string;
  input: string;
  fingerprint: string;
};

export type ReviewExecution = {
  requestedRounds: ReviewRoundCount;
  completedRounds: ReviewRoundCount;
  stopReason: "not_requested" | "insufficient_members" | "round_limit" | "prior_round_incomplete";
};

export type ClaimOccurrence = {
  occurrenceId: string;
  memberId: string;
  memberLabel: string;
  councilRole: CouncilRole;
  statement: string;
  quote: string;
  kind: ProviderOutput["claims"][number]["kind"];
};

export type ClaimGroup = {
  claimId: string;
  statement: string;
  kinds: Array<ClaimOccurrence["kind"]>;
  occurrences: ClaimOccurrence[];
  disposition: "represented" | "represented_as_disputed";
  evidenceState: EvidenceState;
  synthesisCoverage: SynthesisCoverage;
  scopeNote?: string;
};

export type ClaimRelation = {
  fromClaimId: string;
  toClaimId: string;
  kind: ClaimRelationKind;
  note: string;
  updatedAt: string;
};

export type ClaimCoverageAudit = {
  sourceClaimCount: number;
  representedOccurrenceCount: number;
  missingOccurrenceIds: string[];
  duplicateOccurrenceIds: string[];
  unexpectedOccurrenceIds: string[];
  alteredOccurrenceIds: string[];
  complete: boolean;
};

export type ReportQualityAssessment = {
  version: "report-quality-v1";
  presentation: "mechanical_claim_ledger" | "needs_source_review";
  mechanicalIntegrity: boolean;
  semanticValidation: "not_run";
  reasons: Array<
    "no_analyst_result" | "partial_execution" | "extraction_coverage_incomplete" | "claim_transfer_incomplete" |
    "invalid_claim_group" | "risk_controls_incomplete" | "unresolved_synthesis" |
    "omitted_synthesis" | "included_without_verified_evidence" |
    "adverse_evidence" | "disputed_included"
  >;
  unresolvedClaimIds: string[];
  omittedClaimIds: string[];
  includedWithoutVerifiedEvidenceClaimIds: string[];
  adverseEvidenceClaimIds: string[];
};

export type CouncilReport = {
  status: RunStatus;
  qualityNotice: string;
  sharedClaims: ClaimGroup[];
  distinctClaims: ClaimGroup[];
  redTeamChallenges: ClaimGroup[];
  memberResults: CouncilMemberResult[];
  failures: MemberFailure[];
  reviews: CouncilReviewResult[];
  reviewFailures: ReviewFailure[];
  reviewPromptPlans?: CrossReviewPromptPlan[];
  reviewExecution?: ReviewExecution;
  claimRelations?: ClaimRelation[];
  claimCoverage?: ClaimCoverageAudit;
  reportQuality?: ReportQualityAssessment;
  riskControls?: {
    profile: "high";
    redTeamCompleted: boolean;
    crossReviewCompleted: boolean;
    claimTransferComplete: boolean;
    complete: boolean;
  };
};

export function applyRiskControls(
  report: CouncilReport,
  profile: RiskProfile,
  configuredMembers: CouncilMemberConfig[],
  reviewRounds: ReviewRoundCount,
): CouncilReport {
  if (profile !== "high") return report;
  const successfulIds = new Set(report.memberResults.map((member) => member.memberId));
  const redTeamCompleted = configuredMembers.some((member) =>
    member.councilRole === "red-team" && report.memberResults.some((result) =>
      result.memberId === member.id && result.councilRole === "red-team"));
  const firstRoundReviews = report.reviews.filter((review) => review.round === 1);
  const reviewsByMember = new Map(firstRoundReviews.map((review) => [review.reviewerMemberId, review]));
  const crossReviewCompleted = reviewRounds >= 1 && successfulIds.size >= 2 &&
    report.reviewFailures.length === 0 &&
    firstRoundReviews.length === successfulIds.size &&
    [...successfulIds].every((id) => {
      const review = reviewsByMember.get(id);
      if (!review) return false;
      const targets = review.parsed.claims.map((claim) => claim.targetMemberId);
      return targets.length === successfulIds.size - 1 &&
        new Set(targets).size === targets.length &&
        targets.every((target) => target !== id && successfulIds.has(target));
    });
  const claimTransferComplete = auditCouncilClaimCoverage(report).complete;
  const complete = report.status === "completed" && redTeamCompleted && crossReviewCompleted && claimTransferComplete;
  return withReportQuality({
    ...report,
    status: report.memberResults.length === 0 ? "failed" : complete ? "completed" : "partially_completed",
    qualityNotice: complete
      ? `${report.qualityNotice} Yüksek risk için seçilen red-team ve çapraz inceleme kontrolleri tamamlandı; bu doğruluk veya uzman onayı değildir.`
      : `${report.qualityNotice} Yüksek risk kontrolleri tamamlanmadı; sonuç tam değerlendirme olarak sunulamaz.`,
    riskControls: { profile: "high", redTeamCompleted, crossReviewCompleted, claimTransferComplete, complete },
  });
}

const normalize = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");

const toClaimId = (index: number, prefix = "claim"): string =>
  `${prefix}-${String(index + 1).padStart(3, "0")}`;

// A seat or credential is not an independent source of agreement. Compatible
// gateway model ids often add an organization prefix to the same model id.
export function agreementSourceForMember(member: CouncilMemberConfig): string {
  const model = member.model.normalize("NFKC").trim().toLocaleLowerCase("en");
  if (member.provider === "fake") {
    return `fixture:${model}:${member.perspective ?? "unknown"}`;
  }
  return `model:${model.split("/").at(-1) ?? model}`;
}

function sourceCount(claim: ClaimGroup, sources: Map<string, string>): number {
  return new Set(
    claim.occurrences.map((item) => sources.get(item.memberId) ?? `member:${item.memberId}`),
  ).size;
}

// A matching sentence is not an unqualified shared position when some analysts
// present it as an objection and others present it as a different claim kind.
// This is a classification conflict, not a semantic contradiction detector.
function hasMixedObjection(claim: ClaimGroup): boolean {
  const kinds = new Set(claim.occurrences.map((item) => item.kind));
  return kinds.has("objection") && kinds.size > 1;
}

function isSharedClaim(claim: ClaimGroup, sources: Map<string, string>): boolean {
  return sourceCount(claim, sources) >= 2 && !hasMixedObjection(claim);
}

export function auditCouncilClaimCoverage(report: CouncilReport): ClaimCoverageAudit {
  const expected = new Map<string, ClaimOccurrence>();
  for (const member of report.memberResults) {
    member.parsed.claims.forEach((claim, index) => {
      const occurrenceId = `${member.memberId}-claim-${index + 1}`;
      expected.set(occurrenceId, {
        occurrenceId,
        memberId: member.memberId,
        memberLabel: member.label,
        councilRole: member.councilRole,
        statement: claim.statement,
        quote: claim.quote,
        kind: claim.kind,
      });
    });
  }
  const observed = [...report.sharedClaims, ...report.distinctClaims, ...report.redTeamChallenges]
    .flatMap((group) => group.occurrences);
  const counts = new Map<string, number>();
  const unexpectedOccurrenceIds: string[] = [];
  const alteredOccurrenceIds: string[] = [];
  for (const occurrence of observed) {
    counts.set(occurrence.occurrenceId, (counts.get(occurrence.occurrenceId) ?? 0) + 1);
    const source = expected.get(occurrence.occurrenceId);
    if (!source) unexpectedOccurrenceIds.push(occurrence.occurrenceId);
    else if (source.memberId !== occurrence.memberId || source.memberLabel !== occurrence.memberLabel ||
      source.councilRole !== occurrence.councilRole || source.statement !== occurrence.statement ||
      source.quote !== occurrence.quote || source.kind !== occurrence.kind) {
      alteredOccurrenceIds.push(occurrence.occurrenceId);
    }
  }
  const missingOccurrenceIds = [...expected.keys()].filter((id) => !counts.has(id));
  const duplicateOccurrenceIds = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  return {
    sourceClaimCount: expected.size,
    representedOccurrenceCount: observed.length,
    missingOccurrenceIds,
    duplicateOccurrenceIds,
    unexpectedOccurrenceIds: [...new Set(unexpectedOccurrenceIds)],
    alteredOccurrenceIds: [...new Set(alteredOccurrenceIds)],
    complete: missingOccurrenceIds.length === 0 && duplicateOccurrenceIds.length === 0 &&
      unexpectedOccurrenceIds.length === 0 && alteredOccurrenceIds.length === 0,
  };
}

export function assessCouncilReportQuality(report: CouncilReport): ReportQualityAssessment {
  const claims = [...report.sharedClaims, ...report.distinctClaims, ...report.redTeamChallenges];
  const ids = claims.map((claim) => claim.claimId);
  const malformedGroup = new Set(ids).size !== ids.length || claims.some((claim) =>
    !claim.claimId.trim() || !claim.statement.trim() || claim.occurrences.length === 0 ||
    claim.occurrences.some((occurrence) => !occurrence.quote.trim()) ||
    (report.redTeamChallenges.includes(claim)
      ? claim.occurrences.some((occurrence) => occurrence.councilRole !== "red-team")
      : claim.occurrences.some((occurrence) => occurrence.councilRole !== "analyst")));
  const transferComplete = auditCouncilClaimCoverage(report).complete;
  const analystCompleted = report.memberResults.some((member) => member.councilRole === "analyst");
  const mechanicalIntegrity = transferComplete && !malformedGroup && analystCompleted;
  const unresolvedClaimIds = claims.filter((claim) => claim.synthesisCoverage === "unresolved").map((claim) => claim.claimId);
  const omittedClaimIds = claims.filter((claim) => claim.synthesisCoverage === "omitted").map((claim) => claim.claimId);
  const includedWithoutVerifiedEvidenceClaimIds = claims.filter((claim) =>
    claim.synthesisCoverage === "included" && claim.evidenceState !== "externally-verified")
    .map((claim) => claim.claimId);
  const adverseEvidenceClaimIds = claims.filter((claim) =>
    claim.evidenceState === "contradicted" || claim.evidenceState === "stale")
    .map((claim) => claim.claimId);
  const reasons: ReportQualityAssessment["reasons"] = [];
  if (!analystCompleted) reasons.push("no_analyst_result");
  if (report.status !== "completed" || report.failures.length > 0 || report.reviewFailures.length > 0) reasons.push("partial_execution");
  if ([...report.failures, ...report.reviewFailures].some((failure) =>
    failure.rawText !== undefined || ["provider_response_invalid", "invalid_response", "incomplete_response"].includes(failure.code))) reasons.push("extraction_coverage_incomplete");
  if (!transferComplete) reasons.push("claim_transfer_incomplete");
  if (malformedGroup) reasons.push("invalid_claim_group");
  if (report.riskControls && !report.riskControls.complete) reasons.push("risk_controls_incomplete");
  if (unresolvedClaimIds.length > 0) reasons.push("unresolved_synthesis");
  if (omittedClaimIds.length > 0) reasons.push("omitted_synthesis");
  if (includedWithoutVerifiedEvidenceClaimIds.length > 0) reasons.push("included_without_verified_evidence");
  if (adverseEvidenceClaimIds.length > 0) reasons.push("adverse_evidence");
  if (claims.some((claim) => claim.synthesisCoverage === "included" && claim.disposition === "represented_as_disputed")) reasons.push("disputed_included");
  return {
    version: "report-quality-v1",
    presentation: mechanicalIntegrity ? "mechanical_claim_ledger" : "needs_source_review",
    mechanicalIntegrity,
    semanticValidation: "not_run",
    reasons,
    unresolvedClaimIds,
    omittedClaimIds,
    includedWithoutVerifiedEvidenceClaimIds,
    adverseEvidenceClaimIds,
  };
}

function withReportQuality(report: CouncilReport): CouncilReport {
  return { ...report, reportQuality: assessCouncilReportQuality(report) };
}

export function reconcileCouncilAgreement(
  report: CouncilReport,
  members: CouncilMemberConfig[],
): CouncilReport {
  const configured = new Map(members.map((member) => [member.id, agreementSourceForMember(member)]));
  const memberResults = report.memberResults.map((result) => {
    const agreementSource = configured.get(result.memberId) ?? result.agreementSource;
    return { ...result, ...(agreementSource ? { agreementSource } : {}) };
  });
  const sources = new Map(memberResults.map((result) => [result.memberId, result.agreementSource ?? `member:${result.memberId}`]));
  const claims = [...report.sharedClaims, ...report.distinctClaims];
  const reconciled: CouncilReport = {
    ...report,
    memberResults,
    sharedClaims: claims.filter((claim) => isSharedClaim(claim, sources)),
    distinctClaims: claims.filter((claim) => !isSharedClaim(claim, sources)),
  };
  return withReportQuality({ ...reconciled, claimCoverage: auditCouncilClaimCoverage(reconciled) });
}

function groupClaims(members: CouncilMemberResult[], prefix = "claim"): ClaimGroup[] {
  const grouped = new Map<string, ClaimOccurrence[]>();
  for (const member of members) {
    member.parsed.claims.forEach((claim, index) => {
      const occurrence: ClaimOccurrence = {
        occurrenceId: `${member.memberId}-claim-${index + 1}`,
        memberId: member.memberId,
        memberLabel: member.label,
        councilRole: member.councilRole,
        statement: claim.statement,
        quote: claim.quote,
        kind: claim.kind,
      };
      const key = normalize(claim.statement);
      grouped.set(key, [...(grouped.get(key) ?? []), occurrence]);
    });
  }
  return [...grouped.values()].map((occurrences, index) => {
    const kinds = [...new Set(occurrences.map((item) => item.kind))];
    return {
      claimId: toClaimId(index, prefix),
      statement: occurrences[0]?.statement ?? "",
      kinds,
      occurrences,
      disposition: kinds.includes("objection")
        ? "represented_as_disputed"
        : "represented",
      evidenceState: "unsupported",
      synthesisCoverage: "unresolved",
    };
  });
}

export function updateCouncilReportEvidenceState(
  report: CouncilReport,
  claimId: string,
  evidenceState: EvidenceState,
): CouncilReport | undefined {
  let found = false;
  const updateGroups = (groups: ClaimGroup[]): ClaimGroup[] =>
    groups.map((claim) => {
      if (claim.claimId !== claimId) return claim;
      found = true;
      return { ...claim, evidenceState };
    });
  const updated = {
    ...report,
    sharedClaims: updateGroups(report.sharedClaims),
    distinctClaims: updateGroups(report.distinctClaims),
    redTeamChallenges: updateGroups(report.redTeamChallenges),
  };
  return found ? withReportQuality(updated) : undefined;
}

export function updateCouncilReportSynthesisCoverage(
  report: CouncilReport,
  claimId: string,
  synthesisCoverage: SynthesisCoverage,
): CouncilReport | undefined {
  let found = false;
  const updateGroups = (groups: ClaimGroup[]): ClaimGroup[] =>
    groups.map((claim) => {
      if (claim.claimId !== claimId) return claim;
      found = true;
      return { ...claim, synthesisCoverage };
    });
  const updated = {
    ...report,
    sharedClaims: updateGroups(report.sharedClaims),
    distinctClaims: updateGroups(report.distinctClaims),
    redTeamChallenges: updateGroups(report.redTeamChallenges),
  };
  return found ? withReportQuality(updated) : undefined;
}

export function updateCouncilClaimScope(
  report: CouncilReport,
  claimId: string,
  scopeNote: string,
): CouncilReport | undefined {
  const value = scopeNote.trim();
  if (value.length > 500) return undefined;
  let found = false;
  const updateGroups = (groups: ClaimGroup[]): ClaimGroup[] => groups.map((claim) => {
    if (claim.claimId !== claimId) return claim;
    found = true;
    return { ...claim, scopeNote: value };
  });
  const updated = {
    ...report,
    sharedClaims: updateGroups(report.sharedClaims),
    distinctClaims: updateGroups(report.distinctClaims),
    redTeamChallenges: updateGroups(report.redTeamChallenges),
  };
  return found ? updated : undefined;
}

function allClaimIds(report: CouncilReport): Set<string> {
  return new Set([...report.sharedClaims, ...report.distinctClaims, ...report.redTeamChallenges]
    .map((claim) => claim.claimId));
}

function sameClaimPair(left: Pick<ClaimRelation, "fromClaimId" | "toClaimId">, right: Pick<ClaimRelation, "fromClaimId" | "toClaimId">): boolean {
  return (left.fromClaimId === right.fromClaimId && left.toClaimId === right.toClaimId) ||
    (left.fromClaimId === right.toClaimId && left.toClaimId === right.fromClaimId);
}

export function upsertCouncilClaimRelation(report: CouncilReport, relation: ClaimRelation): CouncilReport | undefined {
  const ids = allClaimIds(report);
  if (!ids.has(relation.fromClaimId) || !ids.has(relation.toClaimId) ||
    relation.fromClaimId === relation.toClaimId || relation.note.trim().length === 0 ||
    relation.note.length > 500) return undefined;
  const existing = report.claimRelations ?? [];
  if (existing.length >= 100 && !existing.some((item) => sameClaimPair(item, relation))) return undefined;
  return {
    ...report,
    claimRelations: [...existing.filter((item) => !sameClaimPair(item, relation)), relation],
  };
}

export function removeCouncilClaimRelation(
  report: CouncilReport,
  pair: Pick<ClaimRelation, "fromClaimId" | "toClaimId">,
): CouncilReport | undefined {
  const existing = report.claimRelations ?? [];
  if (!existing.some((item) => sameClaimPair(item, pair))) return undefined;
  return { ...report, claimRelations: existing.filter((item) => !sameClaimPair(item, pair)) };
}

export function buildCouncilReport(
  memberResults: CouncilMemberResult[],
  failures: MemberFailure[],
  reviews: CouncilReviewResult[] = [],
  reviewFailures: ReviewFailure[] = [],
  reviewPromptPlans: CrossReviewPromptPlan[] = [],
  reviewExecution?: ReviewExecution,
): CouncilReport {
  const analystResults = memberResults.filter((member) => member.councilRole === "analyst");
  const redTeamResults = memberResults.filter((member) => member.councilRole === "red-team");
  const claims = groupClaims(analystResults);
  const redTeamChallenges = groupClaims(redTeamResults, "red-team").map((claim) => ({
    ...claim,
    disposition: "represented_as_disputed" as const,
  }));
  const sources = new Map(memberResults.map((member) => [
    member.memberId,
    member.agreementSource ?? `member:${member.memberId}`,
  ]));

  const status: RunStatus =
    memberResults.length === 0
      ? "failed"
      : failures.length > 0 || reviewFailures.length > 0 || memberResults.length < 2
        ? "partially_completed"
        : "completed";
  const malformedOutput = [...failures, ...reviewFailures].some((failure) =>
    failure.rawText !== undefined || ["provider_response_invalid", "invalid_response", "incomplete_response"].includes(failure.code));
  const extractionNotice = malformedOutput
    ? " Geçersiz model çıktısı nedeniyle iddia çıkarımının tamlığı doğrulanamadı; varsa işlenemeyen ham metin hata ayrıntısında saklandı."
    : "";

  const report: CouncilReport = {
    status,
    qualityNotice:
      status === "completed"
        ? `Bu çıktı ${analystResults.length} analist, ${redTeamResults.length} red-team üyesi ve ${reviews.length} çapraz incelemenin izlenebilir çıktılarını ayırır; doğrulanmış gerçeklik iddiası taşımaz.`
        : status === "partially_completed"
          ? `${memberResults.length} üye tamamlandı, ${failures.length} üye tamamlanamadı; ${reviews.length} çapraz inceleme tamamlandı, ${reviewFailures.length} çapraz inceleme tamamlanamadı; bu tam konsey sonucu değildir.${extractionNotice}`
          : `Kullanılabilir üye çıktısı oluşmadı.${extractionNotice}`,
    sharedClaims: claims
      .filter((claim) => isSharedClaim(claim, sources))
      .map((claim) => ({ ...claim, synthesisCoverage: "included" as const })),
    distinctClaims: claims.filter(
      (claim) => !isSharedClaim(claim, sources),
    ),
    redTeamChallenges,
    memberResults,
    failures,
    reviews,
    reviewFailures,
    reviewPromptPlans,
    ...(reviewExecution ? { reviewExecution } : {}),
  };
  return withReportQuality({ ...report, claimCoverage: auditCouncilClaimCoverage(report), claimRelations: [] });
}
export * from "./token-cost";
export * from "./billing";
export * from "./billing-statement";
export * from "./billing-statement-history";
export * from "./billing-account";
export * from "./billing-payment";
