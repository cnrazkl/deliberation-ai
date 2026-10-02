import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { compileExternalCouncilIntake, renderCouncilCoverageQuestion, sha256 } from "./external-council-intake";
import { evaluateCouncilCorrectness, prepareCouncilMeasurement, independenceAttestationSchema } from "./council-correctness";
import { createCouncilCoverageReviewWorksheet, compileCouncilCoverageReviewWorksheet } from "./council-coverage-labeling";
import { compileCouncilAssessmentWorksheet, createCouncilAssessmentWorksheet } from "./council-assessment-worksheet";
import { councilCoverageCorpusSchema, type CouncilCoverageRun } from "./council-coverage";

function suite() {
  return JSON.parse(readFileSync(new URL("../../../docs/evaluation/COUNCIL_EXTERNAL_SUITE.json", import.meta.url), "utf8"));
}

function fixture() {
  const cases = Array.from({ length: 40 }, (_, index) => ({
    id: `case-${index}`, sourceId: `source-${index}`, split: index < 20 ? "development" : "held_out",
    language: index % 4 === 0 ? "en" : "tr", riskTags: ["source_conflict"], question: `Kaynak ${index} için doğru sonuç hangisi?`,
    sourceText: "Permit denied.", goldClaims: [{ id: "gold-permit", statement: "Permit denied.", critical: true,
      evidenceSpans: [{ start: 0, end: 14, text: "Permit denied." }] }],
  }));
  const corpus = councilCoverageCorpusSchema.parse({ schemaVersion: "council-coverage-v1", description: "Synthetic gate arithmetic only", cases });
  const reports: CouncilCoverageRun[] = corpus.cases.map((item, i) => ({ caseId: item.id,
    runId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    report: buildCouncilReport([{ memberId: "m1", label: "m1", councilRole: "analyst", rawText: "Permit denied.", citations: [],
      parsed: { summary: "Permit denied.", claims: [{ statement: "Permit denied.", quote: "Permit denied.", kind: "shared" }] } }], []),
  }));
  const assessment = { schemaVersion: "council-coverage-assessment-v1", cases: reports.map((run) => ({
    caseId: run.caseId, runId: run.runId, status: "assessed", reviewerId: "synthetic-human", judgments: [
      { goldClaimId: "gold-permit", decision: "represented", occurrenceIds: ["m1-claim-1"], rationale: "Synthetic exact-match fixture only." },
    ],
  })) };
  return { corpus, reports, assessment };
}

describe("external correctness preparation", () => {
  it("freezes 40 source-bound questions in six domains with separated families and no fabricated human labels", () => {
    const result = compileExternalCouncilIntake(suite());
    expect(result.manifest).toMatchObject({ sourceCount: 11, caseCount: 40,
      bySplit: { development: 20, held_out: 20 }, byLanguage: { tr: 26, en: 10, mixed: 4 } });
    expect(result.manifest.domains).toHaveLength(6);
    expect(Object.values(result.manifest.byRiskTag).every((count) => count > 0)).toBe(true);
    const plan = prepareCouncilMeasurement(suite());
    expect(plan.cases.every((item) => item.question.length <= 4_000 && sha256(item.question) === item.questionSha256 && item.runId === null)).toBe(true);
    const worksheet = createCouncilCoverageReviewWorksheet(result.intake, "a");
    expect(worksheet.cases.every((item) => item.claims.length === 0)).toBe(true);
    expect(() => compileCouncilCoverageReviewWorksheet(result.intake, worksheet)).toThrow();
  });

  it("rejects altered source bytes, family leakage, URL aliases and oversized prompts", () => {
    const changed = suite(); changed.sources[0].text += " changed";
    expect(() => compileExternalCouncilIntake(changed)).toThrow("özeti");
    const leaked = suite(); leaked.cases[0].split = "development";
    expect(() => compileExternalCouncilIntake(leaked)).toThrow("sızıyor");
    const alias = suite(); alias.sources[1].url = `${alias.sources[0].url}?view=print`;
    expect(() => compileExternalCouncilIntake(alias)).toThrow("URL");
    expect(() => renderCouncilCoverageQuestion({ question: "A question", sourceText: "x".repeat(4_000) })).toThrow("4000");
  });

  it("does not conflate source preservation with measured accuracy or missing slices with zero", () => {
    const { corpus, assessment, reports } = fixture();
    const result = evaluateCouncilCorrectness(corpus, assessment, reports);
    expect(result.status).toBe("passed"); // Arithmetic fixture, not the persisted measurement CLI.
    expect(result.scores.byLanguage.mixed?.recallLowerBound).toBeNull();
    assessment.cases[20]!.judgments[0] = { goldClaimId: "gold-permit", decision: "missing", occurrenceIds: [], rationale: "Critical omission" };
    expect(evaluateCouncilCorrectness(corpus, assessment, reports).status).toBe("failed");
    assessment.cases[20]!.judgments[0]!.decision = "uncertain";
    expect(evaluateCouncilCorrectness(corpus, assessment, reports).status).toBe("blocked");
    assessment.cases[21]!.judgments[0] = { goldClaimId: "gold-permit", decision: "missing", occurrenceIds: [], rationale: "Known critical loss remains a failure even with pending judgments" };
    expect(evaluateCouncilCorrectness(corpus, assessment, reports).status).toBe("failed");
  });

  it("keeps held-out failure visible even with a passing pooled recall", () => {
    const { corpus, assessment, reports } = fixture();
    for (const index of [20, 21]) {
      corpus.cases[index]!.goldClaims[0]!.critical = false;
      assessment.cases[index]!.judgments[0] = { goldClaimId: "gold-permit", decision: "missing", occurrenceIds: [], rationale: "Missing" };
    }
    const result = evaluateCouncilCorrectness(corpus, assessment, reports);
    expect(result.scores.overall.recallLowerBound).toBe(0.95);
    expect(result.checks.find((check) => check.id === "held_out_recall")?.status).toBe("failed");
  });

  it("requires real decisions and refuses stale reports, altered gold and invented occurrence ids", () => {
    const { corpus, reports } = fixture();
    const worksheet = createCouncilAssessmentWorksheet(corpus, reports);
    expect(() => compileCouncilAssessmentWorksheet(corpus, reports, worksheet)).toThrow();
    const completed = { ...worksheet, reviewerId: "human", cases: worksheet.cases.map((item) => ({ ...item,
      judgments: item.judgments.map((judgment) => ({ ...judgment, decision: "represented", occurrenceIds: ["m1-claim-1"], rationale: "Matches" })),
    })) };
    const assessment = compileCouncilAssessmentWorksheet(corpus, reports, completed);
    expect(evaluateCouncilCorrectness(corpus, assessment, reports).status).toBe("passed");
    const stale = structuredClone(reports); stale[0]!.report.qualityNotice += " changed";
    expect(() => compileCouncilAssessmentWorksheet(corpus, stale, completed)).toThrow("değişmiş");
    const changedGold = structuredClone(completed); changedGold.cases[0]!.judgments[0]!.statement = "Permit approved";
    expect(() => compileCouncilAssessmentWorksheet(corpus, reports, changedGold)).toThrow("değişmiş");
    completed.cases[0]!.judgments[0]!.occurrenceIds = ["invented"];
    expect(() => evaluateCouncilCorrectness(corpus, compileCouncilAssessmentWorksheet(corpus, reports, completed), reports)).toThrow("envanterinde");
  });

  it("keeps missing runs unassessed and requires an explicit human independence attestation", () => {
    const { corpus } = fixture();
    const worksheet = { ...createCouncilAssessmentWorksheet(corpus, []), reviewerId: "human" };
    const result = evaluateCouncilCorrectness(corpus, compileCouncilAssessmentWorksheet(corpus, [], worksheet), []);
    expect(result.status).toBe("blocked");
    expect(result.scores.overall.notAssessedCount).toBe(40);
    expect(independenceAttestationSchema.safeParse({ independentHumans: false }).success).toBe(false);
  });
});
