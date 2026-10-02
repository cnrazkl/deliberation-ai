import { describe, expect, it } from "vitest";
import { buildCouncilReport, type CouncilMemberResult } from "@deliberation-ai/domain";
import { councilCoverageAssessmentSchema, councilCoverageCorpusSchema, evaluateCouncilCoverage } from "./council-coverage";

const contractRunId = "00000000-0000-4000-8000-000000000001";
const permitRunId = "00000000-0000-4000-8000-000000000002";

function report(memberId: string, statement: string) {
  const member: CouncilMemberResult = {
    memberId,
    label: memberId,
    councilRole: "analyst",
    rawText: statement,
    parsed: { summary: statement, claims: [{ statement, kind: "shared", quote: statement }] },
    citations: [],
  };
  return buildCouncilReport([member], []);
}

function runs() {
  return [
    { caseId: "case-contract", runId: contractRunId, report: report("member-a", "Bildirim yazılı yapılmalıdır.") },
    { caseId: "case-permit", runId: permitRunId, report: report("member-b", "The permit was renewed.") },
  ];
}

function span(sourceText: string, text: string) {
  const start = sourceText.indexOf(text);
  return { start, end: start + text.length, text };
}

function corpus() {
  const trSource = "Sözleşme 30 gün içinde feshedilebilir. Bildirim yazılı yapılmalıdır.";
  const enSource = "The permit was not renewed.";
  const backupSource = "Yedek plan üç aşamada uygulanır.";
  return {
    schemaVersion: "council-coverage-v1",
    description: "Yalnız ölçüm mekanizmasını sınayan sentetik örnekler",
    cases: [
      { id: "case-contract", sourceId: "source-contract", split: "development", language: "tr", riskTags: ["numeric", "condition"], question: "Sözleşmedeki fesih ve bildirim koşulları nelerdir?", sourceText: trSource, goldClaims: [
        { id: "gold-termination", statement: "Sözleşme 30 gün içinde feshedilebilir.", critical: true, evidenceSpans: [span(trSource, "30 gün içinde feshedilebilir")] },
        { id: "gold-notice", statement: "Bildirim yazılı yapılmalıdır.", critical: false, evidenceSpans: [span(trSource, "Bildirim yazılı yapılmalıdır")] },
      ] },
      { id: "case-permit", sourceId: "source-permit", split: "held_out", language: "en", riskTags: ["negation"], question: "Was the permit renewed for the next period?", sourceText: enSource, goldClaims: [
        { id: "gold-permit", statement: "The permit was not renewed.", critical: true, evidenceSpans: [span(enSource, "not renewed")] },
      ] },
      { id: "case-backup", sourceId: "source-backup", split: "held_out", language: "tr", riskTags: ["condition"], question: "Yedek planın uygulanma düzeni nasıl?", sourceText: backupSource, goldClaims: [
        { id: "gold-backup", statement: "Yedek plan üç aşamada uygulanır.", critical: true, evidenceSpans: [span(backupSource, "üç aşamada uygulanır")] },
      ] },
    ],
  };
}

function assessment() {
  return { schemaVersion: "council-coverage-assessment-v1", cases: [
    { caseId: "case-contract", status: "assessed", runId: contractRunId, reviewerId: "human-a", judgments: [
      { goldClaimId: "gold-termination", decision: "missing", occurrenceIds: [], rationale: "Fesih süresi raporda bulunmuyor." },
      { goldClaimId: "gold-notice", decision: "represented", occurrenceIds: ["member-a-claim-1"], rationale: "Yazılı bildirim raporda açıkça var." },
    ] },
    { caseId: "case-permit", status: "assessed", runId: permitRunId, reviewerId: "human-b", judgments: [
      { goldClaimId: "gold-permit", decision: "uncertain", occurrenceIds: [], rationale: "Yanıtın olumsuzluğu koruyup korumadığı belirsiz." },
    ] },
    { caseId: "case-backup", status: "not_assessed", reason: "run_failed" },
  ] };
}

describe("council source-level coverage evaluation", () => {
  it("reports conservative recall bounds and critical losses without treating an unassessed run as a model answer", () => {
    const result = evaluateCouncilCoverage(corpus(), assessment(), runs());
    expect(result.overall).toMatchObject({
      goldClaimCount: 4,
      representedCount: 1,
      missingCount: 1,
      uncertainCount: 1,
      notAssessedCount: 1,
      criticalMissingCount: 1,
      criticalUncertainCount: 1,
      criticalNotAssessedCount: 1,
      recallLowerBound: 0.25,
      recallUpperBound: 0.75,
    });
    expect(result.byLanguage.tr?.goldClaimCount).toBe(3);
    expect(result.byRiskTag.negation?.uncertainCount).toBe(1);
  });

  it("rejects altered evidence offsets and source leakage between splits", () => {
    const altered = corpus();
    altered.cases[0]!.goldClaims[0]!.evidenceSpans[0]!.start += 1;
    expect(councilCoverageCorpusSchema.safeParse(altered).success).toBe(false);
    const leaked = corpus();
    leaked.cases[1]!.sourceId = leaked.cases[0]!.sourceId;
    expect(councilCoverageCorpusSchema.safeParse(leaked).success).toBe(false);
  });

  it("requires one explicit human judgment per gold claim and ids from the actual report", () => {
    const missing = assessment();
    missing.cases[0]!.judgments?.pop();
    expect(() => evaluateCouncilCoverage(corpus(), missing, runs())).toThrow("Her gold id");
    const invented = assessment();
    invented.cases[0]!.judgments![1]!.occurrenceIds = ["invented-claim"];
    expect(() => evaluateCouncilCoverage(corpus(), invented, runs())).toThrow("rapor envanterinde");
    const duplicated = assessment();
    duplicated.cases.push(structuredClone(duplicated.cases[0]!));
    expect(() => evaluateCouncilCoverage(corpus(), duplicated, runs())).toThrow("birebir eşleşmeli");
  });

  it("rejects caller-provided occurrence inventories and mismatched or extra run snapshots", () => {
    const manualInventory = assessment();
    Object.assign(manualInventory.cases[0]!, { observedOccurrenceIds: ["invented-claim"] });
    expect(councilCoverageAssessmentSchema.safeParse(manualInventory).success).toBe(false);
    const wrongRun = assessment();
    wrongRun.cases[0]!.runId = permitRunId;
    expect(() => evaluateCouncilCoverage(corpus(), wrongRun, runs())).toThrow("doğru run raporuna");
    const extraRun = runs();
    extraRun.push({ caseId: "case-backup", runId: "00000000-0000-4000-8000-000000000003", report: report("member-c", "Yedek plan") });
    expect(() => evaluateCouncilCoverage(corpus(), assessment(), extraRun)).toThrow("Değerlendirilmemiş vakaya rapor");
  });

  it("rejects a report whose claim ledger no longer matches the validated member output", () => {
    const altered = runs();
    altered[0]!.report.distinctClaims[0]!.occurrences[0]!.statement = "Değiştirildi";
    expect(() => evaluateCouncilCoverage(corpus(), assessment(), altered)).toThrow("iddia aktarımı eksik veya bozuk");
  });
});
