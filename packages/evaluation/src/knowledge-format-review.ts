import { z } from "zod";
import { sha256 } from "./external-council-intake";
import { knowledgeEvaluationPlanSchema, knowledgeFixtureNames } from "./knowledge-evaluation";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const worksheetSchema = z.object({
  schemaVersion: z.literal("knowledge-format-review-v1"), planSha256: digest,
  slot: z.enum(["a", "b"]), reviewerId: z.string().trim().min(1).max(120),
  cases: z.array(z.object({
    id: z.string(), fixture: z.enum(knowledgeFixtureNames), question: z.string(), language: z.enum(["tr", "en"]),
    fixtureSha256: digest, originalInspected: z.literal(true),
    extractionVerified: z.boolean(), noAnswerRequired: z.boolean(), rationale: z.string().trim().min(10).max(2_000),
    claims: z.array(z.object({ statement: z.string().trim().min(1).max(4_000), critical: z.boolean(),
      evidenceQuotes: z.array(z.object({ page: z.number().int().min(1).max(100), text: z.string().min(1).max(1_500) }).strict()).min(1).max(5),
    }).strict()).max(20),
  }).strict()).length(8),
}).strict();

const extractionSchema = z.object({
  version: z.literal("knowledge-format-extraction-v1"), scope: z.string(),
  fixtures: z.array(z.object({
    name: z.enum(knowledgeFixtureNames), mediaType: z.enum(["application/pdf", "image/png"]),
    originalHash: digest, parserVersion: z.string().min(1), status: z.enum(["complete", "extraction_unverified", "failed"]),
    reason: z.string().nullable(), text: z.string().max(64_000), textHash: digest,
    pages: z.array(z.object({ page: z.number().int().positive(), start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(), textHash: digest }).strict()).max(100),
  }).strict()).length(4),
}).strict();

export function createKnowledgeFormatWorksheet(planInput: unknown, slot: "a" | "b") {
  const plan = knowledgeEvaluationPlanSchema.parse(planInput);
  return { schemaVersion: "knowledge-format-review-v1" as const, planSha256: sha256(JSON.stringify(plan)),
    slot, reviewerId: "", cases: plan.formatCases.map((item) => ({ ...item,
      fixtureSha256: plan.formatFixtures.find((fixture) => fixture.name === item.fixture)!.sha256,
      originalInspected: null, claims: [], extractionVerified: null, noAnswerRequired: null, rationale: "",
    })) };
}

/** Caller must verify extractionText against actual binary extraction before compiling.
 * Source-bound human declarations only, never adjudication, gold or acceptance. */
export function compileKnowledgeFormatReview(planInput: unknown, extractionText: string, worksheetInput: unknown) {
  const plan = knowledgeEvaluationPlanSchema.parse(planInput);
  const worksheet = worksheetSchema.parse(worksheetInput);
  const extraction = extractionSchema.parse(JSON.parse(extractionText));
  if (worksheet.planSha256 !== sha256(JSON.stringify(plan)) ||
      new Set(worksheet.cases.map((item) => item.id)).size !== plan.formatCases.length ||
      new Set(extraction.fixtures.map((item) => item.name)).size !== knowledgeFixtureNames.length) throw new Error("Format inventory or plan changed.");
  for (const fixture of extraction.fixtures) {
    if (fixture.originalHash !== plan.formatFixtures.find((item) => item.name === fixture.name)?.sha256 ||
        sha256(fixture.text) !== fixture.textHash ||
        fixture.mediaType !== (fixture.name.endsWith(".pdf") ? "application/pdf" : "image/png") ||
        (fixture.status === "complete" && !fixture.text.trim())) throw new Error("Format extraction identity changed.");
    let end = 0;
    for (const page of fixture.pages) {
      if (page.page !== fixture.pages.indexOf(page) + 1 || page.start !== end || page.end < page.start || page.end > fixture.text.length ||
          sha256(fixture.text.slice(page.start, page.end)) !== page.textHash) throw new Error("Format page mapping changed.");
      end = page.end;
    }
    if (end !== fixture.text.length || new Set(fixture.pages.map((page) => page.page)).size !== fixture.pages.length) throw new Error("Incomplete format page inventory.");
  }
  const cases = worksheet.cases.map((item) => {
    const expected = plan.formatCases.find((candidate) => candidate.id === item.id);
    const fixture = extraction.fixtures.find((candidate) => candidate.name === item.fixture)!;
    if (!expected || expected.fixture !== item.fixture || expected.question !== item.question || expected.language !== item.language ||
        fixture.originalHash !== item.fixtureSha256) throw new Error("Frozen format question or fixture changed.");
    if ((!item.extractionVerified || fixture.status !== "complete") && (!item.noAnswerRequired || item.claims.length)) throw new Error("Unverified extraction must abstain without invented evidence.");
    if (fixture.status !== "complete" && item.extractionVerified) throw new Error("Unsupported extraction cannot be verified.");
    if (item.noAnswerRequired ? item.claims.length > 0 : item.claims.length === 0) throw new Error("Answer/abstention boundary is inconsistent.");
    const claims = item.claims.map((claim) => ({ statement: claim.statement, critical: claim.critical,
      evidence: claim.evidenceQuotes.map((quote) => {
        const page = fixture.pages.find((candidate) => candidate.page === quote.page);
        if (!page) throw new Error("Quote page is absent.");
        const text = fixture.text.slice(page.start, page.end), offset = text.indexOf(quote.text);
        if (offset < 0 || text.indexOf(quote.text, offset + 1) >= 0) throw new Error("Quote must uniquely match its original page text.");
        return { fixtureSha256: fixture.originalHash, page: page.page, start: page.start + offset,
          end: page.start + offset + quote.text.length, text: quote.text };
      }),
    }));
    return { caseId: item.id, fixture: item.fixture, fixtureSha256: item.fixtureSha256,
      originalInspected: true as const, extractionVerified: item.extractionVerified,
      noAnswerRequired: item.noAnswerRequired, rationale: item.rationale, claims };
  });
  return { schemaVersion: "knowledge-format-compiled-review-v1" as const, planSha256: worksheet.planSha256,
    extractionFileSha256: sha256(extractionText), worksheetSha256: sha256(JSON.stringify(worksheet)),
    slot: worksheet.slot, reviewerId: worksheet.reviewerId, cases,
    adjudication: "not_assessed" as const, humanIndependence: "not_attested" as const, releaseAcceptance: "blocked" as const };
}

export function compileKnowledgeFormatReviewPair(plan: unknown, extractionText: string, worksheets: readonly [unknown, unknown]) {
  const reviews = worksheets.map((worksheet) => compileKnowledgeFormatReview(plan, extractionText, worksheet));
  if (reviews[0]!.slot !== "a" || reviews[1]!.slot !== "b" || reviews[0]!.reviewerId === reviews[1]!.reviewerId) throw new Error("Two distinct reviewers in their original slots are required.");
  return reviews;
}
