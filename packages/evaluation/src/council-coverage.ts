import { createHash } from "node:crypto";
import { z } from "zod";
import { auditCouncilClaimCoverage, type CouncilReport } from "@deliberation-ai/domain";

export const councilCoverageRiskTagSchema = z.enum([
  "negation", "numeric", "temporal", "entity", "condition", "minority", "red_team", "source_conflict",
]);

const goldClaimSchema = z.object({
  id: z.string().regex(/^gold-[a-z0-9-]+$/),
  statement: z.string().trim().min(1).max(4_000),
  critical: z.boolean(),
  evidenceSpans: z.array(z.object({
    start: z.number().int().min(0),
    end: z.number().int().positive(),
    text: z.string().min(1),
  })).min(1).max(5),
});

const coverageCaseSchema = z.object({
  id: z.string().regex(/^case-[a-z0-9-]+$/),
  sourceId: z.string().regex(/^source-[a-z0-9-]+$/),
  split: z.enum(["development", "held_out"]),
  language: z.enum(["tr", "en", "mixed"]),
  riskTags: z.array(councilCoverageRiskTagSchema).min(1),
  question: z.string().trim().min(10).max(4_000),
  sourceText: z.string().min(1).max(100_000),
  sourceSnapshot: z.object({
    ref: z.string().trim().min(1).max(2_048),
    capturedAt: z.iso.datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).optional(),
  goldClaims: z.array(goldClaimSchema).min(1),
}).superRefine((item, context) => {
  if (item.sourceSnapshot && createHash("sha256").update(item.sourceText).digest("hex") !== item.sourceSnapshot.sha256) {
    context.addIssue({ code: "custom", message: "Kaynak özeti dondurulmuş metinle eşleşmeli.", path: ["sourceSnapshot", "sha256"] });
  }
  const ids = new Set<string>();
  item.goldClaims.forEach((claim, claimIndex) => {
    if (ids.has(claim.id)) context.addIssue({ code: "custom", message: "Gold id tekrarlandı.", path: ["goldClaims", claimIndex, "id"] });
    ids.add(claim.id);
    claim.evidenceSpans.forEach((span, spanIndex) => {
      if (span.end <= span.start || item.sourceText.slice(span.start, span.end) !== span.text) {
        context.addIssue({ code: "custom", message: "Kaynak aralığı metinle birebir eşleşmeli.", path: ["goldClaims", claimIndex, "evidenceSpans", spanIndex] });
      }
    });
  });
});

export const councilCoverageCorpusSchema = z.object({
  schemaVersion: z.literal("council-coverage-v1"),
  description: z.string().trim().min(1),
  cases: z.array(coverageCaseSchema).min(1),
}).superRefine((corpus, context) => {
  const ids = new Set<string>();
  const sourceSplits = new Map<string, string>();
  const snapshotSplits = new Map<string, string>();
  corpus.cases.forEach((item, index) => {
    if (ids.has(item.id)) context.addIssue({ code: "custom", message: "Vaka id tekrarlandı.", path: ["cases", index, "id"] });
    ids.add(item.id);
    const existing = sourceSplits.get(item.sourceId);
    if (existing && existing !== item.split) {
      context.addIssue({ code: "custom", message: "Aynı kaynak geliştirme ve saklı test arasında bölünemez.", path: ["cases", index, "split"] });
    }
    sourceSplits.set(item.sourceId, item.split);
    if (item.sourceSnapshot) {
      const sourceRef = item.sourceSnapshot.ref;
      const refSplit = snapshotSplits.get(sourceRef);
      if (refSplit && refSplit !== item.split) {
        context.addIssue({ code: "custom", message: "Aynı kaynak referansı geliştirme ve saklı test arasında bölünemez.", path: ["cases", index, "sourceSnapshot", "ref"] });
      }
      snapshotSplits.set(sourceRef, item.split);
    }
  });
});
export type CouncilCoverageCorpus = z.infer<typeof councilCoverageCorpusSchema>;

const assessedCaseSchema = z.object({
  caseId: z.string(),
  status: z.literal("assessed"),
  runId: z.uuid(),
  reviewerId: z.string().trim().min(1),
  judgments: z.array(z.object({
    goldClaimId: z.string(),
    decision: z.enum(["represented", "missing", "uncertain"]),
    occurrenceIds: z.array(z.string().min(1)),
    rationale: z.string().trim().min(1),
  })).min(1),
}).strict();

const unassessedCaseSchema = z.object({
  caseId: z.string(),
  status: z.literal("not_assessed"),
  reason: z.enum(["run_failed", "output_unavailable", "review_pending"]),
});

export const councilCoverageAssessmentSchema = z.object({
  schemaVersion: z.literal("council-coverage-assessment-v1"),
  cases: z.array(z.discriminatedUnion("status", [assessedCaseSchema, unassessedCaseSchema])).min(1),
});
export type CouncilCoverageAssessment = z.infer<typeof councilCoverageAssessmentSchema>;
export type CouncilCoverageRun = { caseId: string; runId: string; report: CouncilReport };

type CoverageDecision = "represented" | "missing" | "uncertain" | "not_assessed";
type ScoredClaim = { decision: CoverageDecision; critical: boolean; split: "development" | "held_out"; language: CouncilCoverageCorpus["cases"][number]["language"]; riskTags: string[] };

export type CouncilCoverageScore = {
  goldClaimCount: number;
  criticalGoldClaimCount: number;
  representedCount: number;
  missingCount: number;
  uncertainCount: number;
  notAssessedCount: number;
  criticalMissingCount: number;
  criticalUncertainCount: number;
  criticalNotAssessedCount: number;
  recallLowerBound: number | null;
  recallUpperBound: number | null;
};

function scoreClaims(items: ScoredClaim[]): CouncilCoverageScore {
  const count = (decision: CoverageDecision) => items.filter((item) => item.decision === decision).length;
  const critical = (decision: CoverageDecision) => items.filter((item) => item.critical && item.decision === decision).length;
  return {
    goldClaimCount: items.length,
    criticalGoldClaimCount: items.filter((item) => item.critical).length,
    representedCount: count("represented"),
    missingCount: count("missing"),
    uncertainCount: count("uncertain"),
    notAssessedCount: count("not_assessed"),
    criticalMissingCount: critical("missing"),
    criticalUncertainCount: critical("uncertain"),
    criticalNotAssessedCount: critical("not_assessed"),
    recallLowerBound: items.length === 0 ? null : count("represented") / items.length,
    recallUpperBound: items.length === 0 ? null : (count("represented") + count("uncertain") + count("not_assessed")) / items.length,
  };
}

export function evaluateCouncilCoverage(
  corpusInput: unknown,
  assessmentInput: unknown,
  runs: readonly CouncilCoverageRun[],
) {
  const corpus = councilCoverageCorpusSchema.parse(corpusInput);
  const assessment = councilCoverageAssessmentSchema.parse(assessmentInput);
  const cases = new Map(corpus.cases.map((item) => [item.id, item]));
  const reports = new Map<string, CouncilCoverageRun>();
  const runIds = new Set<string>();
  for (const run of runs) {
    if (reports.has(run.caseId) || runIds.has(run.runId)) throw new Error("Rapor vakası ve run id benzersiz olmalı.");
    reports.set(run.caseId, run);
    runIds.add(run.runId);
  }
  const seen = new Set<string>();
  const scored: ScoredClaim[] = [];
  for (const result of assessment.cases) {
    const item = cases.get(result.caseId);
    if (!item || seen.has(result.caseId)) throw new Error("Değerlendirme vakaları korpusla birebir eşleşmeli.");
    seen.add(result.caseId);
    if (result.status === "not_assessed") {
      if (reports.has(result.caseId)) throw new Error("Değerlendirilmemiş vakaya rapor bağlanamaz.");
      item.goldClaims.forEach((claim) => scored.push({ decision: "not_assessed", critical: claim.critical, split: item.split, language: item.language, riskTags: item.riskTags }));
      continue;
    }
    const run = reports.get(result.caseId);
    if (!run || run.runId !== result.runId) throw new Error("Değerlendirilen vaka doğru run raporuna bağlanmalı.");
    if (run.report.status === "failed" || run.report.memberResults.length === 0) {
      throw new Error("Başarısız veya boş konsey raporu değerlendirilemez.");
    }
    if (!auditCouncilClaimCoverage(run.report).complete) throw new Error("Konsey raporunun iddia aktarımı eksik veya bozuk.");
    const observed = new Set([...run.report.sharedClaims, ...run.report.distinctClaims, ...run.report.redTeamChallenges]
      .flatMap((group) => group.occurrences.map((occurrence) => occurrence.occurrenceId)));
    const gold = new Map(item.goldClaims.map((claim) => [claim.id, claim]));
    const judged = new Set<string>();
    for (const judgment of result.judgments) {
      const claim = gold.get(judgment.goldClaimId);
      if (!claim || judged.has(judgment.goldClaimId)) throw new Error("Gold id değerlendirmesi benzersiz ve vakaya ait olmalı.");
      judged.add(judgment.goldClaimId);
      if ((judgment.decision === "represented") !== (judgment.occurrenceIds.length > 0)) {
        throw new Error("Yalnız temsil edilen iddia geçerli occurrence id gerektirir.");
      }
      if (new Set(judgment.occurrenceIds).size !== judgment.occurrenceIds.length ||
          judgment.occurrenceIds.some((id) => !observed.has(id))) {
        throw new Error("Eşlenen occurrence id rapor envanterinde bulunmalı.");
      }
      scored.push({ decision: judgment.decision, critical: claim.critical, split: item.split, language: item.language, riskTags: item.riskTags });
    }
    if (judged.size !== gold.size) throw new Error("Her gold id için açık bir insan kararı gerekli.");
  }
  if (seen.size !== cases.size) throw new Error("Her korpus vakası değerlendirilmeli veya açıkça değerlendirilmedi işaretlenmeli.");
  if (reports.size !== assessment.cases.filter((result) => result.status === "assessed").length) {
    throw new Error("Her rapor tam olarak bir değerlendirilmiş vakaya ait olmalı.");
  }
  const byLanguage = Object.fromEntries(["tr", "en", "mixed"].map((language) => [language, scoreClaims(scored.filter((item) => item.language === language))]));
  const byRiskTag = Object.fromEntries(councilCoverageRiskTagSchema.options.map((tag) => [tag, scoreClaims(scored.filter((item) => item.riskTags.includes(tag)))]));
  const bySplit = Object.fromEntries(["development", "held_out"].map((split) => {
    const subset = scored.filter((item) => item.split === split);
    return [split, {
      overall: scoreClaims(subset),
      byLanguage: Object.fromEntries(["tr", "en", "mixed"].map((language) => [language, scoreClaims(subset.filter((item) => item.language === language))])),
      byRiskTag: Object.fromEntries(councilCoverageRiskTagSchema.options.map((tag) => [tag, scoreClaims(subset.filter((item) => item.riskTags.includes(tag)))])),
    }];
  }));
  return { overall: scoreClaims(scored), byLanguage, byRiskTag, bySplit };
}
