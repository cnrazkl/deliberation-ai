import { synthesisDraftSchema, synthesisReviewSchema, type SynthesisDraft, type SynthesisReview } from "@deliberation-ai/contracts";
import { auditCouncilClaimCoverage, type CouncilReport } from "./index";

/** Only the supplied claim ledger is checked. No external truth or source admission. */
export function synthesisSource(question: string, report: CouncilReport) {
  const groups = [
    ...report.sharedClaims.map((claim) => ({ claim, category: "shared" as const })),
    ...report.distinctClaims.map((claim) => ({ claim, category: "distinct" as const })),
    ...report.redTeamChallenges.map((claim) => ({ claim, category: "red_team" as const })),
  ];
  const source = {
    question, status: report.status, qualityNotice: report.qualityNotice,
    claims: groups.map(({ claim, category }) => ({
      claimId: claim.claimId, statement: claim.statement, scope: claim.scopeNote ?? "", category,
      disposition: claim.disposition, evidenceState: claim.evidenceState, coverage: claim.synthesisCoverage,
      occurrences: claim.occurrences.map(({ occurrenceId, memberId, councilRole, quote }) => ({ occurrenceId, memberId, councilRole, quote })),
    })),
    relations: report.claimRelations ?? [],
    reviews: report.reviews.map(({ round, reviewerMemberId, parsed }) => ({ round, reviewerMemberId, parsed })),
  };
  const complete = auditCouncilClaimCoverage(report).complete;
  const ids = source.claims.map((claim) => claim.claimId);
  const eligible = ["completed", "partially_completed"].includes(report.status) && complete &&
    ids.length > 0 && ids.length <= 12 && new Set(ids).size === ids.length &&
    question.length <= 4_000 && JSON.stringify(source).length <= 12_000 &&
    (!report.riskControls || report.riskControls.complete);
  // High-risk incomplete controls and malformed ledgers cannot get a model draft.
  return { source, eligible,
    fallback: [complete ? "# İzlenebilir iddia defteri" : "# İddia defteri kaynak incelemesi gerektiriyor", "Bu defter doğruluk veya uzlaşma onayı değildir.", report.qualityNotice,
      ...source.claims.map((claim) => `\n## ${claim.claimId}\n${claim.statement}\n\nTür: ${claim.category}; kanıt: ${claim.evidenceState}; kapsam: ${claim.scope || "belirtilmedi"}; sentez: ${claim.coverage}.\nKaynaklar: ${claim.occurrences.map((item) => item.occurrenceId).join(", ")}`),
      ...(!complete ? ["## Aktarım denetimi geçmedi: özgün yapılandırılmış üye iddiaları",
        ...report.memberResults.flatMap((member) => member.parsed.claims.map((claim, index) =>
          `${member.memberId}/${index}: ${claim.statement}\nTür: ${claim.kind}; alıntı: ${claim.quote}`))] : []),
    ].join("\n\n") };
}
export type SynthesisSource = ReturnType<typeof synthesisSource>["source"];

export function validateSynthesisDraft(source: SynthesisSource, fingerprint: string, input: unknown): SynthesisDraft {
  const draft = synthesisDraftSchema.parse(input);
  const inventory = new Set(source.claims.map((claim) => claim.claimId));
  const represented = new Set(draft.paragraphs.flatMap((paragraph) => paragraph.claimIds));
  if (draft.sourceFingerprint !== fingerprint || represented.size !== inventory.size ||
    [...represented].some((id) => !inventory.has(id)) || draft.paragraphs.some((paragraph) =>
      new Set(paragraph.claimIds).size !== paragraph.claimIds.length)) throw new Error("Synthesis coverage mismatch");
  return draft;
}
export function validateSynthesisReview(source: SynthesisSource, draft: SynthesisDraft, draftSha256: string, input: unknown): SynthesisReview {
  const review = synthesisReviewSchema.parse(input);
  if (review.sourceFingerprint !== draft.sourceFingerprint || review.draftSha256 !== draftSha256 ||
    review.checks.length !== draft.paragraphs.length || new Set(review.checks.map((check) => check.paragraphIndex)).size !== review.checks.length) {
    throw new Error("Synthesis review binding mismatch");
  }
  const claims = new Map(source.claims.map((claim) => [claim.claimId, claim]));
  for (const check of review.checks) {
    const paragraph = draft.paragraphs[check.paragraphIndex];
    if (!paragraph || check.quotes.length !== paragraph.claimIds.length || new Set(check.quotes.map((quote) => quote.claimId)).size !== check.quotes.length ||
      check.quotes.some((quote) => !paragraph.claimIds.includes(quote.claimId) || !claims.get(quote.claimId)?.statement.includes(quote.quote))) {
      throw new Error("Synthesis review quote mismatch");
    }
  }
  return review;
}

export function renderSynthesisCandidate(source: SynthesisSource, draft: SynthesisDraft): string {
  const warnings = source.claims.filter((claim) => claim.evidenceState !== "externally-verified" || claim.category !== "shared" || claim.disposition === "represented_as_disputed");
  return ["# Model tarafından incelenmiş sentez taslağı", "İnsan onayı ve doğruluk kanıtı değildir. Asıl iddialar ve karşı görüşler aşağıdaki defterde korunur.",
    ...draft.paragraphs.map((paragraph) => `${paragraph.text}\n\nİddia bağlantıları: ${paragraph.claimIds.join(", ")}`),
    "## Belirsizlik ve karşı görüşler", ...warnings.map((claim) => `- ${claim.claimId}: ${claim.category}; ${claim.evidenceState}; ${claim.coverage}. ${claim.statement}`),
  ].join("\n\n");
}
