import { describe, expect, it } from "vitest";
import {
  agreementSourceForMember,
  assessCouncilReportQuality,
  applyRiskControls,
  auditCouncilClaimCoverage,
  buildCouncilReport,
  removeCouncilClaimRelation,
  reconcileCouncilAgreement,
  updateCouncilClaimScope,
  updateCouncilReportEvidenceState,
  updateCouncilReportSynthesisCoverage,
  upsertCouncilClaimRelation,
  type CouncilMemberResult,
} from "./index";
import type { CouncilMemberConfig } from "@deliberation-ai/contracts";

const member = (
  memberId: string,
  label: string,
  claims: CouncilMemberResult["parsed"]["claims"],
  councilRole: CouncilMemberResult["councilRole"] = "analyst",
): CouncilMemberResult => ({
  memberId,
  label,
  councilRole,
  citations: [],
  rawText: JSON.stringify({ claims }),
  parsed: { summary: `${label} summary`, claims },
});

describe("buildCouncilReport", () => {
  const remoteMember = (id: string, model: string): CouncilMemberConfig => ({
    id,
    label: id,
    role: "Bağımsız analist",
    provider: "openai-compatible",
    model,
    connectionId: "00000000-0000-4000-8000-000000000001",
    reasoningLevel: "default",
    webSearchMode: "off",
    councilRole: "analyst",
  });

  it("does not promote repeated seats of one model to independent agreement", () => {
    const first = remoteMember("seat-a", "qwen3.5-35b-a3b");
    const second = remoteMember("seat-b", "qwen/qwen3.5-35b-a3b");
    const statement = "Koşulları önce doğrula.";
    const results = [first, second].map((configured) => ({
      ...member(configured.id, configured.label, [
        { statement, kind: "shared" as const, quote: statement },
      ]),
      agreementSource: agreementSourceForMember(configured),
    }));
    const report = buildCouncilReport(results, []);

    expect(report.sharedClaims).toHaveLength(0);
    expect(report.distinctClaims).toHaveLength(1);
    expect(report.distinctClaims[0]?.occurrences.map((item) => item.memberId)).toEqual([
      "seat-a", "seat-b",
    ]);
    expect(report.distinctClaims[0]?.synthesisCoverage).toBe("unresolved");
  });

  it("reclassifies a historical report using its frozen models without deleting annotations", () => {
    const statement = "Koşulları önce doğrula.";
    const legacy = buildCouncilReport([
      member("seat-a", "A", [{ statement, kind: "shared", quote: statement }]),
      member("seat-b", "B", [{ statement, kind: "shared", quote: statement }]),
    ], []);
    const corrected = reconcileCouncilAgreement(legacy, [
      remoteMember("seat-a", "same-model"),
      remoteMember("seat-b", "same-model"),
    ]);

    expect(legacy.sharedClaims).toHaveLength(1);
    expect(corrected.sharedClaims).toHaveLength(0);
    expect(corrected.distinctClaims[0]?.claimId).toBe(legacy.sharedClaims[0]?.claimId);
    expect(corrected.distinctClaims[0]?.occurrences).toHaveLength(2);
    expect(corrected.distinctClaims[0]?.evidenceState).toBe("unsupported");
    expect(corrected.distinctClaims[0]?.synthesisCoverage).toBe("included");
  });

  it("deduplicates a shared claim while retaining both provenances", () => {
    const report = buildCouncilReport(
      [
        member("a", "Model A", [
          { statement: "Koşulları önce doğrula.", kind: "shared", quote: "Koşulları önce doğrula." },
        ]),
        member("b", "Model B", [
          { statement: "Koşulları önce doğrula.", kind: "shared", quote: "Koşulları önce doğrula." },
        ]),
      ],
      [],
    );

    expect(report.status).toBe("completed");
    expect(report.sharedClaims).toHaveLength(1);
    expect(report.sharedClaims[0]?.occurrences.map((item) => item.memberId)).toEqual(["a", "b"]);
    expect(report.sharedClaims[0]?.evidenceState).toBe("unsupported");
    expect(report.sharedClaims[0]?.synthesisCoverage).toBe("included");
    expect(report.reportQuality).toMatchObject({
      version: "report-quality-v1",
      presentation: "mechanical_claim_ledger",
      mechanicalIntegrity: true,
      semanticValidation: "not_run",
      includedWithoutVerifiedEvidenceClaimIds: [report.sharedClaims[0]?.claimId],
    });
  });

  it("keeps report completion separate from evidence and synthesis readiness", () => {
    const report = buildCouncilReport([
      member("a", "Analist A", [{ statement: "Ortak", kind: "shared", quote: "Kaynak A" }]),
      member("b", "Analist B", [
        { statement: "Ortak", kind: "shared", quote: "Kaynak B" },
        { statement: "Ayrı risk", kind: "risk", quote: "Kaynak B risk" },
      ]),
    ], []);
    expect(report.status).toBe("completed");
    expect(report.reportQuality?.reasons).toEqual([
      "unresolved_synthesis", "included_without_verified_evidence",
    ]);
    const verified = updateCouncilReportEvidenceState(report, report.sharedClaims[0]!.claimId, "externally-verified")!;
    expect(verified.reportQuality?.includedWithoutVerifiedEvidenceClaimIds).toEqual([]);
    const omitted = updateCouncilReportSynthesisCoverage(verified, report.distinctClaims[0]!.claimId, "omitted")!;
    expect(omitted.reportQuality?.reasons).toEqual(["omitted_synthesis"]);
    expect(omitted.reportQuality?.semanticValidation).toBe("not_run");
  });

  it("switches to source review when the mechanical claim ledger is corrupt", () => {
    const report = buildCouncilReport([
      member("a", "Analist A", [{ statement: "Bir iddia", kind: "risk", quote: "Alıntı" }]),
      member("b", "Analist B", [{ statement: "Başka iddia", kind: "risk", quote: "Alıntı B" }]),
    ], []);
    const missing = { ...report, distinctClaims: report.distinctClaims.slice(1) };
    expect(assessCouncilReportQuality(missing)).toMatchObject({
      presentation: "needs_source_review",
      mechanicalIntegrity: false,
      reasons: expect.arrayContaining(["claim_transfer_incomplete"]),
    });
    const wrongRole = { ...report, redTeamChallenges: [report.distinctClaims[0]!] };
    expect(assessCouncilReportQuality(wrongRole).reasons).toContain("invalid_claim_group");
    const noAnalyst = buildCouncilReport([
      member("r", "Red Team", [{ statement: "İtiraz", kind: "objection", quote: "Alıntı" }], "red-team"),
    ], []);
    expect(noAnalyst.reportQuality?.reasons).toContain("no_analyst_result");
  });

  it("keeps a mixed objection classification out of shared claims without losing either occurrence", () => {
    const statement = "Ek doğrulama olmadan ilerlemeyin.";
    const results = [
      { ...member("a", "Model A", [{ statement, kind: "recommendation", quote: "Önce doğrulayın." }]), agreementSource: "model:a" },
      { ...member("b", "Model B", [{ statement, kind: "objection", quote: "Doğrulama eksik." }]), agreementSource: "model:b" },
    ];
    const report = buildCouncilReport(results, []);

    expect(report.sharedClaims).toHaveLength(0);
    expect(report.distinctClaims).toHaveLength(1);
    expect(report.distinctClaims[0]).toMatchObject({
      kinds: ["recommendation", "objection"],
      disposition: "represented_as_disputed",
      synthesisCoverage: "unresolved",
    });
    expect(report.distinctClaims[0]?.occurrences.map((item) => [item.memberId, item.quote])).toEqual([
      ["a", "Önce doğrulayın."],
      ["b", "Doğrulama eksik."],
    ]);
    expect(report.memberResults).toEqual(results);
  });

  it("keeps matching objections shared when there is no classification conflict", () => {
    const statement = "Bu koşul yeterli değil.";
    const report = buildCouncilReport([
      { ...member("a", "Model A", [{ statement, kind: "objection", quote: statement }]), agreementSource: "model:a" },
      { ...member("b", "Model B", [{ statement, kind: "objection", quote: statement }]), agreementSource: "model:b" },
    ], []);

    expect(report.sharedClaims).toHaveLength(1);
    expect(report.distinctClaims).toHaveLength(0);
  });

  it("reclassifies an older mixed-kind shared claim without rewriting its annotations", () => {
    const statement = "Ek doğrulama olmadan ilerlemeyin.";
    const current = buildCouncilReport([
      member("a", "Model A", [{ statement, kind: "recommendation", quote: statement }]),
      member("b", "Model B", [{ statement, kind: "objection", quote: statement }]),
    ], []);
    const claim = current.distinctClaims[0]!;
    const legacy = {
      ...current,
      sharedClaims: [{ ...claim, evidenceState: "model-supported" as const, synthesisCoverage: "included" as const }],
      distinctClaims: [],
    };
    const corrected = reconcileCouncilAgreement(legacy, [remoteMember("a", "model-a"), remoteMember("b", "model-b")]);

    expect(corrected.sharedClaims).toHaveLength(0);
    expect(corrected.distinctClaims[0]).toMatchObject({
      claimId: claim.claimId,
      evidenceState: "model-supported",
      synthesisCoverage: "included",
    });
    expect(corrected.distinctClaims[0]?.occurrences).toHaveLength(2);
  });

  it("updates evidence explicitly without deriving it from member repetition", () => {
    const report = buildCouncilReport(
      [
        member("a", "Model A", [
          { statement: "Ortak iddia", kind: "shared", quote: "Ortak iddia" },
        ]),
        member("b", "Model B", [
          { statement: "Ortak iddia", kind: "shared", quote: "Ortak iddia" },
        ]),
      ],
      [],
    );
    const claimId = report.sharedClaims[0]?.claimId;
    expect(claimId).toBeDefined();
    const updated = updateCouncilReportEvidenceState(
      report,
      claimId!,
      "externally-verified",
    );
    expect(updated?.sharedClaims[0]?.evidenceState).toBe("externally-verified");
    expect(report.sharedClaims[0]?.evidenceState).toBe("unsupported");
  });

  it("tracks synthesis coverage without discarding unresolved claims", () => {
    const report = buildCouncilReport(
      [
        member("a", "Model A", [
          { statement: "Ortak iddia", kind: "shared", quote: "Ortak iddia" },
          { statement: "Tekil iddia", kind: "risk", quote: "Tekil iddia" },
        ]),
        member("b", "Model B", [
          { statement: "Ortak iddia", kind: "shared", quote: "Ortak iddia" },
        ]),
      ],
      [],
    );
    expect(report.sharedClaims[0]?.synthesisCoverage).toBe("included");
    expect(report.distinctClaims[0]?.synthesisCoverage).toBe("unresolved");
    const claimId = report.distinctClaims[0]?.claimId;
    const updated = updateCouncilReportSynthesisCoverage(report, claimId!, "omitted");
    expect(updated?.distinctClaims[0]?.synthesisCoverage).toBe("omitted");
    expect(updated?.distinctClaims).toHaveLength(1);
    expect(report.distinctClaims[0]?.synthesisCoverage).toBe("unresolved");
  });

  it("does not claim consensus when only one member succeeds", () => {
    const report = buildCouncilReport(
      [
        member("a", "Model A", [
          { statement: "Bir öneri", kind: "recommendation", quote: "Bir öneri" },
        ]),
      ],
      [{ memberId: "b", label: "Model B", code: "provider_error", message: "fixture failure" }],
    );

    expect(report.status).toBe("partially_completed");
    expect(report.sharedClaims).toHaveLength(0);
    expect(report.qualityNotice).toContain("tam konsey sonucu değildir");
  });

  it("names failed reviews and malformed extraction in the partial quality notice", () => {
    const report = buildCouncilReport(
      [
        member("a", "Model A", [{ statement: "Bir iddia", kind: "risk", quote: "Bir iddia" }]),
        member("b", "Model B", [{ statement: "Başka iddia", kind: "risk", quote: "Başka iddia" }]),
      ],
      [],
      [],
      [{ memberId: "a", label: "Model A", code: "provider_response_invalid", message: "Geçersiz JSON", round: 1, rawText: "{broken}" }],
    );
    expect(report.status).toBe("partially_completed");
    expect(report.qualityNotice).toContain("1 çapraz inceleme tamamlanamadı");
    expect(report.qualityNotice).toContain("iddia çıkarımının tamlığı doğrulanamadı");
    expect(report.reportQuality?.reasons).toContain("extraction_coverage_incomplete");
    expect(report.reviewFailures[0]?.rawText).toBe("{broken}");
  });

  it("keeps red-team challenges outside analyst agreement groups", () => {
    const statement = "Aynı koşul önce doğrulanmalı.";
    const report = buildCouncilReport(
      [
        member("a", "Analist", [
          { statement, kind: "recommendation", quote: statement },
        ]),
        member(
          "b",
          "Red Team",
          [{ statement, kind: "objection", quote: statement }],
          "red-team",
        ),
      ],
      [],
    );
    expect(report.sharedClaims).toHaveLength(0);
    expect(report.distinctClaims).toHaveLength(1);
    expect(report.redTeamChallenges).toHaveLength(1);
    expect(report.redTeamChallenges[0]?.occurrences[0]?.councilRole).toBe("red-team");
  });

  it("accounts for every structured model claim, including red-team claims", () => {
    const report = buildCouncilReport([
      member("a", "Analist", [
        { statement: "Ortak", kind: "shared", quote: "alıntı a" },
        { statement: "Risk", kind: "risk", quote: "alıntı risk" },
      ]),
      member("b", "Analist B", [{ statement: "Ortak", kind: "shared", quote: "alıntı b" }]),
      member("c", "Red Team", [{ statement: "İtiraz", kind: "objection", quote: "alıntı c" }], "red-team"),
    ], []);
    expect(report.claimCoverage).toMatchObject({ sourceClaimCount: 4, representedOccurrenceCount: 4, complete: true });

    const missing = { ...report, redTeamChallenges: [] };
    expect(auditCouncilClaimCoverage(missing)).toMatchObject({ complete: false, missingOccurrenceIds: ["c-claim-1"] });
    const duplicated = { ...report, distinctClaims: [...report.distinctClaims, report.distinctClaims[0]!] };
    expect(auditCouncilClaimCoverage(duplicated).duplicateOccurrenceIds).toEqual(["a-claim-2"]);
    const altered = { ...report, sharedClaims: [{
      ...report.sharedClaims[0]!,
      occurrences: [{ ...report.sharedClaims[0]!.occurrences[0]!, quote: "farklı alıntı" }, report.sharedClaims[0]!.occurrences[1]!],
    }] };
    expect(auditCouncilClaimCoverage(altered).alteredOccurrenceIds).toEqual(["a-claim-1"]);
  });

  it("stores owner scope and one relation per claim pair without changing evidence", () => {
    const report = buildCouncilReport([
      member("a", "Analist", [
        { statement: "Öneri", kind: "recommendation", quote: "öneri" },
        { statement: "Sınır", kind: "risk", quote: "sınır" },
      ]),
    ], []);
    const firstId = report.distinctClaims[0]!.claimId;
    const secondId = report.distinctClaims[1]!.claimId;
    const scoped = updateCouncilClaimScope(report, firstId, "  Yalnızca koşul sağlanırsa.  ")!;
    expect(scoped.distinctClaims[0]).toMatchObject({ scopeNote: "Yalnızca koşul sağlanırsa.", evidenceState: "unsupported" });
    expect(report.distinctClaims[0]!.scopeNote).toBeUndefined();
    expect(updateCouncilClaimScope(report, "missing", "metin")).toBeUndefined();

    const first = upsertCouncilClaimRelation(scoped, { fromClaimId: firstId, toClaimId: secondId, kind: "qualifies", note: "Koşula bağlı", updatedAt: "2026-09-25T00:00:00Z" })!;
    const replacement = upsertCouncilClaimRelation(first, { fromClaimId: secondId, toClaimId: firstId, kind: "contradicts", note: "Farklı yorum", updatedAt: "2026-09-25T01:00:00Z" })!;
    expect(replacement.claimRelations).toHaveLength(1);
    expect(replacement.claimRelations?.[0]).toMatchObject({ kind: "contradicts", note: "Farklı yorum" });
    expect(replacement.distinctClaims[0]?.evidenceState).toBe("unsupported");
    expect(upsertCouncilClaimRelation(report, { fromClaimId: firstId, toClaimId: firstId, kind: "supports", note: "geçersiz", updatedAt: "now" })).toBeUndefined();
    expect(upsertCouncilClaimRelation(report, { fromClaimId: firstId, toClaimId: "missing", kind: "supports", note: "geçersiz", updatedAt: "now" })).toBeUndefined();
    expect(removeCouncilClaimRelation(replacement, { fromClaimId: firstId, toClaimId: secondId })?.claimRelations).toEqual([]);
  });

  it("withholds a complete high-risk result unless red-team and every cross-review finish", () => {
    const analyst = member("a", "Analist", [{ statement: "Öneri", kind: "recommendation", quote: "öneri" }]);
    const redTeam = member("b", "Red Team", [{ statement: "İtiraz", kind: "objection", quote: "itiraz" }], "red-team");
    const configured = [
      { id: "a", label: "Analist", role: "Analist", provider: "fake" as const, model: "fixture", perspective: "risk" as const, reasoningLevel: "default" as const, webSearchMode: "off" as const, councilRole: "analyst" as const },
      { id: "b", label: "Red Team", role: "Red Team", provider: "fake" as const, model: "fixture", perspective: "evidence" as const, reasoningLevel: "default" as const, webSearchMode: "off" as const, councilRole: "red-team" as const },
    ];
    const base = buildCouncilReport([analyst, redTeam], []);
    expect(base.status).toBe("completed");
    const missingReview = applyRiskControls(base, "high", configured, 1);
    expect(missingReview.status).toBe("partially_completed");
    expect(missingReview.riskControls).toMatchObject({ redTeamCompleted: true, crossReviewCompleted: false, complete: false });

    const reviews = [analyst, redTeam].map((reviewer) => ({
      round: 1 as const,
      reviewerMemberId: reviewer.memberId,
      reviewerLabel: reviewer.label,
      reviewerCouncilRole: reviewer.councilRole,
      rawText: "fixture",
      parsed: { summary: "İnceleme", claims: [{ targetMemberId: reviewer.memberId === "a" ? "b" : "a", reviewStance: "challenge" as const, statement: "İtiraz", kind: "objection" as const, quote: "fixture" }] },
      citations: [],
    }));
    const complete = applyRiskControls(buildCouncilReport([analyst, redTeam], [], reviews), "high", configured, 1);
    expect(complete.status).toBe("completed");
    expect(complete.riskControls?.complete).toBe(true);
    const incompletePeerReview = applyRiskControls(buildCouncilReport([analyst, redTeam], [], [
      { ...reviews[0]!, parsed: { ...reviews[0]!.parsed, claims: [] } }, reviews[1]!,
    ]), "high", configured, 1);
    expect(incompletePeerReview.riskControls?.crossReviewCompleted).toBe(false);
    expect(incompletePeerReview.status).toBe("partially_completed");
    const lostClaim = applyRiskControls({ ...buildCouncilReport([analyst, redTeam], [], reviews), redTeamChallenges: [] }, "high", configured, 1);
    expect(lostClaim.riskControls?.claimTransferComplete).toBe(false);
    expect(lostClaim.status).toBe("partially_completed");
    expect(complete.qualityNotice).toContain("doğruluk veya uzman onayı değildir");
    const noRedTeam = applyRiskControls(buildCouncilReport([analyst], []), "high", configured, 1);
    expect(noRedTeam.riskControls?.redTeamCompleted).toBe(false);
    expect(noRedTeam.status).toBe("partially_completed");
    expect(applyRiskControls(base, "standard", configured, 0)).toBe(base);
  });
});
