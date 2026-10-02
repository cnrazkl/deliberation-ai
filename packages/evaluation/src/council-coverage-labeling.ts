import { createHash } from "node:crypto";
import { z } from "zod";
import { councilCoverageCorpusSchema, councilCoverageRiskTagSchema } from "./council-coverage";

const evidenceSpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().positive(),
  text: z.string().min(1),
});

const reviewClaimSchema = z.object({
  id: z.string().regex(/^review-[a-z0-9-]+$/),
  statement: z.string().trim().min(1).max(4_000),
  critical: z.boolean(),
  evidenceSpans: z.array(evidenceSpanSchema).min(1).max(5),
});

const reviewReferenceSchema = z.object({
  reviewerId: z.string().trim().min(1),
  claimId: reviewClaimSchema.shape.id,
});

export const councilCoverageIntakeSchema = z.object({
  schemaVersion: z.literal("council-coverage-intake-v1"),
  description: z.string().trim().min(1),
  cases: z.array(z.object({
    id: z.string().regex(/^case-[a-z0-9-]+$/),
    sourceId: z.string().regex(/^source-[a-z0-9-]+$/),
    sourceRef: z.string().trim().min(1).max(2_048),
    capturedAt: z.iso.datetime(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    split: z.enum(["development", "held_out"]),
    language: z.enum(["tr", "en", "mixed"]),
    riskTags: z.array(councilCoverageRiskTagSchema).min(1),
    question: z.string().trim().min(10).max(4_000),
    sourceText: z.string().min(1).max(100_000),
  })).min(1),
}).superRefine((intake, context) => {
  const caseIds = new Set<string>();
  const sourceIds = new Map<string, { ref: string; split: string }>();
  const sourceRefs = new Map<string, { id: string; split: string }>();
  intake.cases.forEach((item, index) => {
    if (caseIds.has(item.id)) context.addIssue({ code: "custom", message: "Vaka id tekrarlandı.", path: ["cases", index, "id"] });
    caseIds.add(item.id);
    if (createHash("sha256").update(item.sourceText).digest("hex") !== item.sourceSha256) {
      context.addIssue({ code: "custom", message: "Kaynak metin özeti dondurulmuş içerikle eşleşmeli.", path: ["cases", index, "sourceSha256"] });
    }
    const byId = sourceIds.get(item.sourceId);
    if (byId && (byId.ref !== item.sourceRef || byId.split !== item.split)) {
      context.addIssue({ code: "custom", message: "Bir kaynak kimliği tek referans ve bölüme ait olmalı.", path: ["cases", index, "sourceId"] });
    }
    sourceIds.set(item.sourceId, { ref: item.sourceRef, split: item.split });
    const byRef = sourceRefs.get(item.sourceRef);
    if (byRef && (byRef.id !== item.sourceId || byRef.split !== item.split)) {
      context.addIssue({ code: "custom", message: "Bir kaynak referansı tek kimlik ve bölüme ait olmalı.", path: ["cases", index, "sourceRef"] });
    }
    sourceRefs.set(item.sourceRef, { id: item.sourceId, split: item.split });
  });
});

export const councilCoverageReviewSheetSchema = z.object({
  schemaVersion: z.literal("council-coverage-review-v1"),
  reviewerId: z.string().trim().min(1),
  cases: z.array(z.object({
    caseId: z.string(),
    claims: z.array(reviewClaimSchema).min(1),
  })).min(1),
});

export const councilCoverageReviewWorksheetSchema = z.object({
  schemaVersion: z.literal("council-coverage-review-worksheet-v1"),
  intakeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  slot: z.enum(["a", "b"]),
  reviewerId: z.string().max(120),
  cases: z.array(z.object({
    caseId: z.string(),
    question: z.string(),
    sourceText: z.string(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    claims: z.array(z.object({
      statement: z.string().trim().min(1).max(4_000),
      critical: z.boolean(),
      evidenceQuotes: z.array(z.string().min(1)).min(1).max(5),
    })),
  })).min(1),
});

function intakeDigest(intake: z.infer<typeof councilCoverageIntakeSchema>): string {
  return createHash("sha256").update(JSON.stringify(intake)).digest("hex");
}

/** Draft for one independent human reviewer; omits split, risk tags and other reviewer's work. */
export function createCouncilCoverageReviewWorksheet(intakeInput: unknown, slot: "a" | "b") {
  const intake = councilCoverageIntakeSchema.parse(intakeInput);
  return councilCoverageReviewWorksheetSchema.parse({
    schemaVersion: "council-coverage-review-worksheet-v1",
    intakeSha256: intakeDigest(intake),
    slot,
    reviewerId: "",
    cases: intake.cases.map((item) => ({
      caseId: item.id,
      question: item.question,
      sourceText: item.sourceText,
      sourceSha256: item.sourceSha256,
      claims: [],
    })),
  });
}

/** Converts exact unique quotes to UTF-16 offsets; never creates claim judgments. */
export function compileCouncilCoverageReviewWorksheet(intakeInput: unknown, worksheetInput: unknown) {
  const intake = councilCoverageIntakeSchema.parse(intakeInput);
  const worksheet = councilCoverageReviewWorksheetSchema.parse(worksheetInput);
  if (worksheet.intakeSha256 !== intakeDigest(intake)) {
    throw new Error("İnceleme çalışma dosyası mevcut kaynak aday kümesiyle eşleşmiyor.");
  }
  const reviewerId = worksheet.reviewerId.trim();
  if (!reviewerId) throw new Error("İncelemeci kimliği gerekli.");
  const cases = indexedCases(worksheet.cases, new Set(intake.cases.map((item) => item.id)), "İnceleme çalışma dosyası");
  return councilCoverageReviewSheetSchema.parse({
    schemaVersion: "council-coverage-review-v1",
    reviewerId,
    cases: intake.cases.map((item) => {
      const worksheetCase = cases.get(item.id)!;
      if (worksheetCase.question !== item.question ||
          worksheetCase.sourceText !== item.sourceText ||
          worksheetCase.sourceSha256 !== item.sourceSha256) {
        throw new Error(`İnceleme çalışma dosyasındaki kaynak veya soru değiştirildi: ${item.id}`);
      }
      if (worksheetCase.claims.length === 0) {
        throw new Error(`Her vaka için en az bir insan iddiası gerekli: ${item.id}`);
      }
      return {
        caseId: item.id,
        claims: worksheetCase.claims.map((claim, claimIndex) => ({
          id: `review-${String(claimIndex + 1).padStart(3, "0")}`,
          statement: claim.statement,
          critical: claim.critical,
          evidenceSpans: claim.evidenceQuotes.map((quote) => uniqueEvidenceSpan(item.sourceText, quote, item.id)),
        })),
      };
    }),
  });
}

export const councilCoverageAdjudicationSchema = z.object({
  schemaVersion: z.literal("council-coverage-adjudication-v1"),
  adjudicatorId: z.string().trim().min(1),
  cases: z.array(z.object({
    caseId: z.string(),
    goldClaims: z.array(z.object({
      id: z.string().regex(/^gold-[a-z0-9-]+$/),
      statement: z.string().trim().min(1).max(4_000),
      critical: z.boolean(),
      evidenceSpans: z.array(evidenceSpanSchema).min(1).max(5),
      reviewRefs: z.array(reviewReferenceSchema).min(1),
      disagreementRationale: z.string().trim().min(1).optional(),
    })).min(1),
    rejectedReviewRefs: z.array(reviewReferenceSchema.extend({ rationale: z.string().trim().min(1) })),
  })).min(1),
});

export const councilCoverageAdjudicationWorksheetSchema = z.object({
  schemaVersion: z.literal("council-coverage-adjudication-worksheet-v1"),
  intakeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  adjudicatorId: z.string().max(120),
  cases: z.array(z.object({
    caseId: z.string(),
    question: z.string(),
    sourceText: z.string(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    reviewClaims: z.array(reviewClaimSchema.extend({
      reviewerId: z.string().trim().min(1),
    })).min(2),
    goldClaims: z.array(z.object({
      statement: z.string().trim().min(1).max(4_000),
      critical: z.boolean(),
      evidenceQuotes: z.array(z.string().min(1)).min(1).max(5),
      reviewRefs: z.array(reviewReferenceSchema).min(1),
      disagreementRationale: z.string().trim().min(1).optional(),
    })),
    rejectedReviewRefs: z.array(reviewReferenceSchema.extend({
      rationale: z.string().trim().min(1),
    })),
  })).min(1),
});

type ReviewSheet = z.infer<typeof councilCoverageReviewSheetSchema>;

function indexedCases<T extends { caseId: string }>(items: T[], expected: Set<string>, label: string): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const item of items) {
    if (!expected.has(item.caseId) || indexed.has(item.caseId)) throw new Error(`${label} vaka kimlikleri korpusla birebir eşleşmeli.`);
    indexed.set(item.caseId, item);
  }
  if (indexed.size !== expected.size) throw new Error(`${label} her vaka için gerekli.`);
  return indexed;
}

function validSpans(sourceText: string, spans: Array<z.infer<typeof evidenceSpanSchema>>): boolean {
  return spans.every((span) => span.end > span.start && sourceText.slice(span.start, span.end) === span.text);
}

function verifiedReviews(intake: z.infer<typeof councilCoverageIntakeSchema>, reviewInputs: unknown) {
  const reviews = z.tuple([councilCoverageReviewSheetSchema, councilCoverageReviewSheetSchema]).parse(reviewInputs);
  if (reviews[0].reviewerId === reviews[1].reviewerId) throw new Error("İki farklı incelemeci gerekli.");
  const expected = new Set(intake.cases.map((item) => item.id));
  const indexed = reviews.map((review) => indexedCases(review.cases, expected, "İnceleme"));
  for (const item of intake.cases) {
    indexed.forEach((review) => {
      const seen = new Set<string>();
      for (const claim of review.get(item.id)!.claims) {
        if (seen.has(claim.id)) throw new Error("İncelemeci iddia kimliği vaka içinde benzersiz olmalı.");
        if (!validSpans(item.sourceText, claim.evidenceSpans)) throw new Error("İncelemeci kaynak aralığı metinle eşleşmeli.");
        seen.add(claim.id);
      }
    });
  }
  return { reviews, indexed };
}

function reviewsDigest(reviews: [ReviewSheet, ReviewSheet]): string {
  return createHash("sha256").update(JSON.stringify(reviews)).digest("hex");
}

function uniqueEvidenceSpan(sourceText: string, quote: string, caseId: string) {
  const start = sourceText.indexOf(quote);
  if (start < 0 || sourceText.indexOf(quote, start + 1) >= 0) {
    throw new Error(`Alıntı kaynakta tam bir kez bulunmalı: ${caseId}`);
  }
  return { start, end: start + quote.length, text: quote };
}

/** Blank third-party worksheet, constructed only from complete source-anchored review sheets. */
export function createCouncilCoverageAdjudicationWorksheet(intakeInput: unknown, reviewInputs: unknown) {
  const intake = councilCoverageIntakeSchema.parse(intakeInput);
  const { reviews, indexed } = verifiedReviews(intake, reviewInputs);
  return councilCoverageAdjudicationWorksheetSchema.parse({
    schemaVersion: "council-coverage-adjudication-worksheet-v1",
    intakeSha256: intakeDigest(intake),
    reviewsSha256: reviewsDigest(reviews),
    adjudicatorId: "",
    cases: intake.cases.map((item) => ({
      caseId: item.id,
      question: item.question,
      sourceText: item.sourceText,
      sourceSha256: item.sourceSha256,
      reviewClaims: reviews.flatMap((review, reviewIndex) =>
        indexed[reviewIndex]!.get(item.id)!.claims.map((claim) => ({
          reviewerId: review.reviewerId, ...claim,
        }))),
      goldClaims: [],
      rejectedReviewRefs: [],
    })),
  });
}

/** Requires explicit adjudicator decisions, then applies the existing corpus gate. */
export function compileCouncilCoverageAdjudicationWorksheet(
  intakeInput: unknown,
  reviewInputs: unknown,
  worksheetInput: unknown,
) {
  const intake = councilCoverageIntakeSchema.parse(intakeInput);
  const { reviews } = verifiedReviews(intake, reviewInputs);
  const worksheet = councilCoverageAdjudicationWorksheetSchema.parse(worksheetInput);
  const expected = createCouncilCoverageAdjudicationWorksheet(intake, reviews);
  if (worksheet.intakeSha256 !== expected.intakeSha256 ||
      worksheet.reviewsSha256 !== expected.reviewsSha256) {
    throw new Error("Uyuşmazlık çalışma dosyası kaynak veya inceleme sürümüyle eşleşmiyor.");
  }
  const adjudicatorId = worksheet.adjudicatorId.trim();
  if (!adjudicatorId || reviews.some((review) => review.reviewerId === adjudicatorId)) {
    throw new Error("İki incelemeciden farklı bir uyuşmazlık çözümleyici kimliği gerekli.");
  }
  const cases = indexedCases(worksheet.cases, new Set(intake.cases.map((item) => item.id)), "Uyuşmazlık çalışma dosyası");
  const expectedCases = new Map(expected.cases.map((item) => [item.caseId, item]));
  const adjudication = councilCoverageAdjudicationSchema.parse({
    schemaVersion: "council-coverage-adjudication-v1",
    adjudicatorId,
    cases: intake.cases.map((item) => {
      const draft = cases.get(item.id)!;
      const original = expectedCases.get(item.id)!;
      if (draft.question !== original.question ||
          draft.sourceText !== original.sourceText ||
          draft.sourceSha256 !== original.sourceSha256 ||
          JSON.stringify(draft.reviewClaims) !== JSON.stringify(original.reviewClaims)) {
        throw new Error(`Uyuşmazlık dosyasındaki kaynak veya incelemeci iddiası değiştirildi: ${item.id}`);
      }
      if (draft.goldClaims.length === 0) throw new Error(`Her vaka için nihai insan iddiası gerekli: ${item.id}`);
      return {
        caseId: item.id,
        goldClaims: draft.goldClaims.map((claim, claimIndex) => ({
          id: `gold-${String(claimIndex + 1).padStart(3, "0")}`,
          statement: claim.statement,
          critical: claim.critical,
          evidenceSpans: claim.evidenceQuotes.map((quote) => uniqueEvidenceSpan(item.sourceText, quote, item.id)),
          reviewRefs: claim.reviewRefs,
          ...(claim.disagreementRationale ? { disagreementRationale: claim.disagreementRationale } : {}),
        })),
        rejectedReviewRefs: draft.rejectedReviewRefs,
      };
    }),
  });
  return { adjudication, ...assembleAdjudicatedCouncilCoverageCorpus(intake, reviews, adjudication) };
}

/** Structurally gates a frozen gold corpus; reviewer identity and source authority require human verification. */
export function assembleAdjudicatedCouncilCoverageCorpus(
  intakeInput: unknown,
  reviewInputs: unknown,
  adjudicationInput: unknown,
) {
  const intake = councilCoverageIntakeSchema.parse(intakeInput);
  const reviews = z.tuple([councilCoverageReviewSheetSchema, councilCoverageReviewSheetSchema]).parse(reviewInputs);
  const adjudication = councilCoverageAdjudicationSchema.parse(adjudicationInput);
  if (reviews[0].reviewerId === reviews[1].reviewerId ||
      reviews.some((review) => review.reviewerId === adjudication.adjudicatorId)) {
    throw new Error("İki farklı incelemeci ve onlardan farklı bir uyuşmazlık çözümleyici gerekli.");
  }

  const caseIds = new Set(intake.cases.map((item) => item.id));
  if (caseIds.size !== intake.cases.length) throw new Error("Korpus vaka kimlikleri benzersiz olmalı.");
  const reviewCases = reviews.map((review) => indexedCases(review.cases, caseIds, "İnceleme"));
  const adjudicatedCases = indexedCases(adjudication.cases, caseIds, "Uyuşmazlık çözümü");

  const cases = intake.cases.map((item) => {
    if (createHash("sha256").update(item.sourceText).digest("hex") !== item.sourceSha256) {
      throw new Error("Kaynak metin özeti dondurulmuş içerikle eşleşmeli.");
    }
    const available = new Map<string, { reviewerId: string; claimId: string }>();
    reviews.forEach((review: ReviewSheet, reviewerIndex) => {
      const labels = reviewCases[reviewerIndex]!.get(item.id)!.claims;
      for (const claim of labels) {
        const key = `${review.reviewerId}:${claim.id}`;
        if (available.has(key)) throw new Error("İncelemeci iddia kimliği vaka içinde benzersiz olmalı.");
        if (!validSpans(item.sourceText, claim.evidenceSpans)) throw new Error("İncelemeci kaynak aralığı metinle eşleşmeli.");
        available.set(key, { reviewerId: review.reviewerId, claimId: claim.id });
      }
    });
    const adjudicated = adjudicatedCases.get(item.id)!;
    const accounted = new Set<string>();
    const account = (reference: { reviewerId: string; claimId: string }) => {
      const key = `${reference.reviewerId}:${reference.claimId}`;
      if (!available.has(key) || accounted.has(key)) throw new Error("İncelemeci iddiası var olmalı ve yalnız bir kez çözümlenmeli.");
      accounted.add(key);
    };
    const goldClaims = adjudicated.goldClaims.map((claim) => {
      const representedReviewers = new Set<string>();
      claim.reviewRefs.forEach((reference) => {
        account(reference);
        representedReviewers.add(reference.reviewerId);
      });
      if (representedReviewers.size < 2 && !claim.disagreementRationale) {
        throw new Error("Tek incelemecinin iddiası için açık uyuşmazlık gerekçesi gerekli.");
      }
      if (!validSpans(item.sourceText, claim.evidenceSpans)) throw new Error("Gold kaynak aralığı metinle eşleşmeli.");
      return {
        id: claim.id,
        statement: claim.statement,
        critical: claim.critical,
        evidenceSpans: claim.evidenceSpans,
      };
    });
    adjudicated.rejectedReviewRefs.forEach(account);
    if (accounted.size !== available.size) throw new Error("Her incelemeci iddiası kabul edilmeli veya gerekçeyle reddedilmeli.");
    return {
      id: item.id,
      sourceId: item.sourceId,
      split: item.split,
      language: item.language,
      riskTags: item.riskTags,
      question: item.question,
      sourceText: item.sourceText,
      sourceSnapshot: { ref: item.sourceRef, capturedAt: item.capturedAt, sha256: item.sourceSha256 },
      goldClaims,
    };
  });
  const corpus = councilCoverageCorpusSchema.parse({
    schemaVersion: "council-coverage-v1",
    description: intake.description,
    cases,
  });
  return {
    corpus,
    manifestSha256: createHash("sha256").update(JSON.stringify(corpus)).digest("hex"),
    labelingManifestSha256: createHash("sha256")
      .update(JSON.stringify({ intake, reviews, adjudication })).digest("hex"),
  };
}
