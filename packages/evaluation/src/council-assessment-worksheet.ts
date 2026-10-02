import { z } from "zod";
import { auditCouncilClaimCoverage } from "@deliberation-ai/domain";
import { councilCoverageCorpusSchema, councilCoverageAssessmentSchema, type CouncilCoverageRun } from "./council-coverage";
import { sha256 } from "./external-council-intake";

export const councilMeasurementRunMapSchema = z.object({
  schemaVersion: z.literal("council-measurement-run-map-v1"),
  corpusSha256: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(z.object({ caseId: z.string(), runId: z.uuid().nullable() }).strict()).min(1),
}).strict();

export function createCouncilAssessmentWorksheet(corpusInput: unknown, reports: readonly CouncilCoverageRun[]) {
  const corpus = councilCoverageCorpusSchema.parse(corpusInput);
  const byCase = new Map(reports.map((run) => [run.caseId, run]));
  if (byCase.size !== reports.length || new Set(reports.map((run) => run.runId)).size !== reports.length ||
    reports.some((run) => !corpus.cases.some((item) => item.id === run.caseId) || !auditCouncilClaimCoverage(run.report).complete)) {
    throw new Error("Çalışma dosyası benzersiz, geçerli raporlar gerektirir.");
  }
  return {
    schemaVersion: "council-assessment-worksheet-v1",
    corpusSha256: sha256(JSON.stringify(corpus)), reviewerId: "",
    cases: corpus.cases.map((item) => {
      const run = byCase.get(item.id);
      return {
        caseId: item.id, runId: run?.runId ?? null, reportSha256: run ? sha256(JSON.stringify(run.report)) : null,
        question: item.question, sourceText: item.sourceText, report: run?.report ?? null,
        judgments: item.goldClaims.map((claim) => ({ goldClaimId: claim.id, statement: claim.statement,
          decision: null, occurrenceIds: [], rationale: "" })),
      };
    }),
  };
}

export function compileCouncilAssessmentWorksheet(corpusInput: unknown, reports: readonly CouncilCoverageRun[], input: unknown) {
  const expected = createCouncilAssessmentWorksheet(corpusInput, reports);
  const worksheet = z.object({
    schemaVersion: z.literal("council-assessment-worksheet-v1"), corpusSha256: z.string(),
    reviewerId: z.string().trim().min(1),
    cases: z.array(z.object({
      caseId: z.string(), runId: z.uuid().nullable(), reportSha256: z.string().nullable(),
      question: z.string(), sourceText: z.string(), report: z.unknown(),
      judgments: z.array(z.object({ goldClaimId: z.string(), statement: z.string(),
        decision: z.enum(["represented", "missing", "uncertain"]).nullable(),
        occurrenceIds: z.array(z.string()), rationale: z.string(),
      }).strict()),
    }).strict()),
  }).strict().parse(input);
  if (worksheet.corpusSha256 !== expected.corpusSha256 || worksheet.cases.length !== expected.cases.length ||
      new Set(worksheet.cases.map((item) => item.caseId)).size !== expected.cases.length) throw new Error("Çalışma dosyası korpusla eşleşmiyor.");
  return councilCoverageAssessmentSchema.parse({
    schemaVersion: "council-coverage-assessment-v1",
    cases: expected.cases.map((item) => {
      const current = worksheet.cases.find((candidate) => candidate.caseId === item.caseId);
      if (!current || current.runId !== item.runId || current.reportSha256 !== item.reportSha256 ||
        current.question !== item.question || current.sourceText !== item.sourceText ||
        JSON.stringify(current.report) !== JSON.stringify(item.report) ||
        current.judgments.length !== item.judgments.length ||
        new Set(current.judgments.map((judgment) => judgment.goldClaimId)).size !== item.judgments.length ||
        current.judgments.some((judgment) => !item.judgments.some((gold) => gold.goldClaimId === judgment.goldClaimId && gold.statement === judgment.statement))) {
        throw new Error("Kaynak, gold veya rapor değişmiş; yeni inceleme dosyası gerekli.");
      }
      if (!item.runId) {
        if (current.judgments.some((judgment) => judgment.decision !== null || judgment.occurrenceIds.length || judgment.rationale)) {
          throw new Error("Raporu olmayan vaka değerlendirilemez.");
        }
        return { caseId: item.caseId, status: "not_assessed", reason: "output_unavailable" };
      }
      return { caseId: item.caseId, status: "assessed", runId: item.runId, reviewerId: worksheet.reviewerId,
        judgments: current.judgments.map(({ statement: _statement, ...judgment }) => judgment) };
    }),
  });
}
