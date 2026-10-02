import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { councilCoverageCorpusSchema } from "./council-coverage";
import {
  assembleAdjudicatedCouncilCoverageCorpus,
  compileCouncilCoverageAdjudicationWorksheet,
  compileCouncilCoverageReviewWorksheet,
  createCouncilCoverageAdjudicationWorksheet,
  createCouncilCoverageReviewWorksheet,
} from "./council-coverage-labeling";

const sourceText = "Başvuru 30 gün içinde yazılı yapılmalıdır.";
const sourceSha256 = createHash("sha256").update(sourceText).digest("hex");
const span = { start: 0, end: sourceText.length, text: sourceText };

function labels() {
  const intake = {
    schemaVersion: "council-coverage-intake-v1",
    description: "Sentetik çift etiketleme akışı",
    cases: [{
      id: "case-written-request", sourceId: "source-written-request", sourceRef: "repo:test-source",
      capturedAt: "2026-09-26T00:00:00.000Z", sourceSha256,
      split: "development", language: "tr", riskTags: ["numeric", "condition"],
      question: "Başvurunun süresi ve biçimi nedir?", sourceText,
    }],
  };
  const reviews = ["reviewer-a", "reviewer-b"].map((reviewerId, index) => ({
    schemaVersion: "council-coverage-review-v1",
    reviewerId,
    cases: [{ caseId: "case-written-request", claims: [{
      id: `review-${index + 1}`, statement: sourceText, critical: true, evidenceSpans: [{ ...span }],
    }] }],
  }));
  const adjudication = {
    schemaVersion: "council-coverage-adjudication-v1",
    adjudicatorId: "reviewer-c",
    cases: [{ caseId: "case-written-request", goldClaims: [{
      id: "gold-written-request", statement: sourceText, critical: true, evidenceSpans: [{ ...span }],
      reviewRefs: [
        { reviewerId: "reviewer-a", claimId: "review-1" },
        { reviewerId: "reviewer-b", claimId: "review-2" },
      ],
    }], rejectedReviewRefs: [] as Array<{ reviewerId: string; claimId: string; rationale: string }> }],
  };
  return { intake, reviews, adjudication };
}

describe("council coverage labeling gate", () => {
  it("prepares a third-party worksheet and assembles only explicit adjudicated claims", () => {
    const { intake, reviews } = labels();
    const worksheet = createCouncilCoverageAdjudicationWorksheet(intake, reviews);
    expect(worksheet.cases[0]).not.toHaveProperty("split");
    expect(worksheet.cases[0]?.reviewClaims.map((claim) => claim.reviewerId)).toEqual(["reviewer-a", "reviewer-b"]);
    expect(worksheet.cases[0]?.goldClaims).toEqual([]);
    worksheet.adjudicatorId = "reviewer-c";
    worksheet.cases[0]!.goldClaims = [{
      statement: sourceText,
      critical: true,
      evidenceQuotes: ["30 gün"],
      reviewRefs: [
        { reviewerId: "reviewer-a", claimId: "review-1" },
        { reviewerId: "reviewer-b", claimId: "review-2" },
      ],
    }];
    const result = compileCouncilCoverageAdjudicationWorksheet(intake, reviews, worksheet);
    expect(result.adjudication.cases[0]?.goldClaims[0]?.evidenceSpans[0]?.start).toBe(sourceText.indexOf("30 gün"));
    expect(result.corpus.cases[0]?.goldClaims[0]?.id).toBe("gold-001");
    expect(result.labelingManifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects missing, stale and unaccounted adjudication decisions", () => {
    const { intake, reviews } = labels();
    const worksheet = createCouncilCoverageAdjudicationWorksheet(intake, reviews);
    expect(() => compileCouncilCoverageAdjudicationWorksheet(intake, reviews, worksheet))
      .toThrow("farklı bir uyuşmazlık çözümleyici");
    worksheet.adjudicatorId = "reviewer-c";
    expect(() => compileCouncilCoverageAdjudicationWorksheet(intake, reviews, worksheet))
      .toThrow("nihai insan iddiası");
    worksheet.cases[0]!.goldClaims = [{
      statement: sourceText,
      critical: true,
      evidenceQuotes: ["30 gün"],
      reviewRefs: [{ reviewerId: "reviewer-a", claimId: "review-1" }],
      disagreementRationale: "İkinci incelemeci iddiayı ayrı değerlendirdi.",
    }];
    expect(() => compileCouncilCoverageAdjudicationWorksheet(intake, reviews, worksheet))
      .toThrow("Her incelemeci iddiası");
    worksheet.cases[0]!.rejectedReviewRefs = [{
      reviewerId: "reviewer-b", claimId: "review-2", rationale: "Aynı iddia tekrarlandı.",
    }];
    expect(compileCouncilCoverageAdjudicationWorksheet(intake, reviews, worksheet).corpus.cases).toHaveLength(1);
    const changedReview = structuredClone(worksheet);
    changedReview.cases[0]!.reviewClaims[0]!.statement += " değişti";
    expect(() => compileCouncilCoverageAdjudicationWorksheet(intake, reviews, changedReview))
      .toThrow("incelemeci iddiası değiştirildi");
    const changedVersion = structuredClone(worksheet);
    changedVersion.reviewsSha256 = "0".repeat(64);
    expect(() => compileCouncilCoverageAdjudicationWorksheet(intake, reviews, changedVersion))
      .toThrow("inceleme sürümüyle eşleşmiyor");
  });

  it("prepares a blind worksheet and compiles exact quotes into UTF-16 source spans", () => {
    const { intake } = labels();
    intake.cases[0]!.sourceText = `🧪 ${sourceText}`;
    intake.cases[0]!.sourceSha256 = createHash("sha256").update(intake.cases[0]!.sourceText).digest("hex");
    const worksheet = createCouncilCoverageReviewWorksheet(intake, "a");
    expect(worksheet.cases[0]).not.toHaveProperty("split");
    expect(worksheet.cases[0]).not.toHaveProperty("riskTags");
    expect(worksheet.cases[0]?.claims).toEqual([]);
    worksheet.reviewerId = "human-reviewer-a";
    worksheet.cases[0]!.claims = [{
      statement: "Başvuru süresi 30 gündür.", critical: true, evidenceQuotes: ["30 gün"],
    }];
    const compiled = compileCouncilCoverageReviewWorksheet(intake, worksheet);
    expect(compiled.cases[0]?.claims[0]?.evidenceSpans[0]).toEqual({
      start: intake.cases[0]!.sourceText.indexOf("30 gün"),
      end: intake.cases[0]!.sourceText.indexOf("30 gün") + "30 gün".length,
      text: "30 gün",
    });
  });

  it("rejects incomplete, altered and ambiguous reviewer worksheets", () => {
    const { intake } = labels();
    const worksheet = createCouncilCoverageReviewWorksheet(intake, "b");
    expect(() => compileCouncilCoverageReviewWorksheet(intake, worksheet)).toThrow("İncelemeci kimliği");
    worksheet.reviewerId = "human-reviewer-b";
    expect(() => compileCouncilCoverageReviewWorksheet(intake, worksheet)).toThrow("en az bir insan iddiası");
    worksheet.cases[0]!.claims = [{ statement: "Başvuru yazılıdır.", critical: true, evidenceQuotes: ["yazılı"] }];
    const changed = structuredClone(worksheet);
    changed.cases[0]!.question += " Değişti.";
    expect(() => compileCouncilCoverageReviewWorksheet(intake, changed)).toThrow("kaynak veya soru değiştirildi");
    const ambiguous = structuredClone(worksheet);
    ambiguous.cases[0]!.claims[0]!.evidenceQuotes = ["a"];
    expect(() => compileCouncilCoverageReviewWorksheet(intake, ambiguous)).toThrow("tam bir kez");
  });

  it("assembles a source-fingerprinted corpus only after two reviews and separate adjudication", () => {
    const { intake, reviews, adjudication } = labels();
    const assembled = assembleAdjudicatedCouncilCoverageCorpus(intake, reviews, adjudication);
    expect(assembled.corpus.cases[0]?.sourceSnapshot?.sha256).toBe(sourceSha256);
    expect(assembled.corpus.cases[0]?.goldClaims).toHaveLength(1);
    expect(assembled.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(assembled.labelingManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(assembleAdjudicatedCouncilCoverageCorpus(intake, reviews, adjudication).manifestSha256)
      .toBe(assembled.manifestSha256);
  });

  it("rejects changed source text, source leakage and altered evidence offsets", () => {
    const changed = labels();
    changed.intake.cases[0]!.sourceText += " Ek metin";
    expect(() => assembleAdjudicatedCouncilCoverageCorpus(changed.intake, changed.reviews, changed.adjudication))
      .toThrow("Kaynak metin özeti");
    const badSpan = labels();
    badSpan.reviews[0]!.cases[0]!.claims[0]!.evidenceSpans[0]!.start = 1;
    expect(() => assembleAdjudicatedCouncilCoverageCorpus(badSpan.intake, badSpan.reviews, badSpan.adjudication))
      .toThrow("kaynak aralığı");
    const valid = labels();
    const { corpus } = assembleAdjudicatedCouncilCoverageCorpus(valid.intake, valid.reviews, valid.adjudication);
    const leaked = structuredClone(corpus);
    leaked.cases.push({ ...structuredClone(leaked.cases[0]!), id: "case-leaked", sourceId: "source-other", split: "held_out" });
    expect(councilCoverageCorpusSchema.safeParse(leaked).success).toBe(false);
  });

  it("requires every reviewer claim to be accounted for and every disagreement explained", () => {
    const duplicatePeople = labels();
    duplicatePeople.adjudication.adjudicatorId = "reviewer-a";
    expect(() => assembleAdjudicatedCouncilCoverageCorpus(duplicatePeople.intake, duplicatePeople.reviews, duplicatePeople.adjudication))
      .toThrow("İki farklı incelemeci");
    const singleSupport = labels();
    singleSupport.adjudication.cases[0]!.goldClaims[0]!.reviewRefs.pop();
    expect(() => assembleAdjudicatedCouncilCoverageCorpus(singleSupport.intake, singleSupport.reviews, singleSupport.adjudication))
      .toThrow("uyuşmazlık gerekçesi");
    Object.assign(singleSupport.adjudication.cases[0]!.goldClaims[0]!, { disagreementRationale: "İkinci incelemeci kapsamı farklı yorumladı." });
    expect(() => assembleAdjudicatedCouncilCoverageCorpus(singleSupport.intake, singleSupport.reviews, singleSupport.adjudication))
      .toThrow("Her incelemeci iddiası");
    singleSupport.adjudication.cases[0]!.rejectedReviewRefs.push({
      reviewerId: "reviewer-b", claimId: "review-2", rationale: "Aynı koşulu ikinci kez sayıyor.",
    });
    expect(assembleAdjudicatedCouncilCoverageCorpus(singleSupport.intake, singleSupport.reviews, singleSupport.adjudication).corpus.cases)
      .toHaveLength(1);
  });
});
