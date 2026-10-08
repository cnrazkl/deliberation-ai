import { z } from "zod";
export * from "./council-coverage";
export * from "./council-coverage-labeling";
export * from "./external-council-intake";
export * from "./council-correctness";
export * from "./council-assessment-worksheet";
export * from "./prompt-comparison";
export * from "./review-round-comparison";
export * from "./study-execution";
export * from "./operating-observation";
export * from "./early-stop-shadow";
export * from "./contradiction-review";
export * from "./contradiction-labeling";
export * from "./knowledge-evaluation";
export * from "./knowledge-benchmark";
export * from "./knowledge-format-review";
export * from "./knowledge-format-adjudication";
export * from "./knowledge-review-attestation";
export * from "./knowledge-review-readiness";

export const evaluationLabelSchema = z.enum([
  "supports",
  "contradicts",
  "insufficient_evidence",
  "not_applicable",
]);
export type EvaluationLabel = z.infer<typeof evaluationLabelSchema>;

export const evaluationLabels = evaluationLabelSchema.options;
export const predictionOutcomeLabels = [...evaluationLabels, "not_assessed"] as const;
export type PredictionOutcomeLabel = (typeof predictionOutcomeLabels)[number];

export const evaluationSplitSchema = z.enum(["development", "held_out"]);
export const evaluationLanguageSchema = z.enum(["tr", "en", "mixed"]);
export const evaluationRiskTagSchema = z.enum([
  "literal",
  "paraphrase",
  "partial_support",
  "negation",
  "temporal",
  "numeric",
  "entity",
  "source_conflict",
  "irrelevant_context",
  "prompt_injection",
  "minority_claim",
  "red_team",
]);

export const evidenceSpanSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["support", "conflict"]),
});

export const evaluationItemSchema = z.object({
  id: z.string().regex(/^eval-[a-z0-9-]+$/),
  documentId: z.string().regex(/^doc-[a-z0-9-]+$/),
  questionFamily: z.string().trim().min(1).max(80),
  split: evaluationSplitSchema,
  language: evaluationLanguageSchema,
  claim: z.string().trim().min(1).max(4_000),
  excerpt: z.string().trim().min(1).max(20_000),
  goldLabel: evaluationLabelSchema,
  rationale: z.string().trim().min(1).max(2_000),
  evidenceSpans: z.array(evidenceSpanSchema).max(5),
  riskTags: z.array(evaluationRiskTagSchema).min(1),
  critical: z.boolean(),
}).superRefine((item, context) => {
  item.evidenceSpans.forEach((span, index) => {
    if (!item.excerpt.includes(span.text)) {
      context.addIssue({
        code: "custom",
        message: "Kanıt aralığı kaynak parçasında birebir bulunmalı.",
        path: ["evidenceSpans", index, "text"],
      });
    }
  });
  if (item.goldLabel === "supports" && !item.evidenceSpans.some((span) => span.kind === "support")) {
    context.addIssue({
      code: "custom",
      message: "Destek etiketi en az bir destek aralığı gerektirir.",
      path: ["evidenceSpans"],
    });
  }
  if (
    item.goldLabel === "contradicts" &&
    !item.evidenceSpans.some((span) => span.kind === "conflict")
  ) {
    context.addIssue({
      code: "custom",
      message: "Çelişki etiketi en az bir çelişki aralığı gerektirir.",
      path: ["evidenceSpans"],
    });
  }
});

export const evaluationCorpusSchema = z.object({
  schemaVersion: z.literal("evaluation-corpus-v1"),
  rubricVersion: z.literal("source-support-v1"),
  preRegistrationId: z.string().trim().min(1),
  description: z.string().trim().min(1),
  items: z.array(evaluationItemSchema).min(1),
}).superRefine((corpus, context) => {
  const itemIds = new Set<string>();
  const documentSplits = new Map<string, string>();
  corpus.items.forEach((item, index) => {
    if (itemIds.has(item.id)) {
      context.addIssue({
        code: "custom",
        message: "Değerlendirme öğesi kimlikleri benzersiz olmalı.",
        path: ["items", index, "id"],
      });
    }
    itemIds.add(item.id);
    const existingSplit = documentSplits.get(item.documentId);
    if (existingSplit && existingSplit !== item.split) {
      context.addIssue({
        code: "custom",
        message: "Aynı belge geliştirme ve saklı test bölümlerine ayrılamaz.",
        path: ["items", index, "split"],
      });
    }
    documentSplits.set(item.documentId, item.split);
  });
});

export type EvaluationCorpus = z.infer<typeof evaluationCorpusSchema>;
export type EvaluationItem = z.infer<typeof evaluationItemSchema>;

const probabilitySchema = z.record(evaluationLabelSchema, z.number().min(0).max(1));

export const assessedPredictionSchema = z.object({
  itemId: z.string(),
  status: z.literal("assessed"),
  label: evaluationLabelSchema,
  probabilities: probabilitySchema,
}).superRefine((prediction, context) => {
  const total = evaluationLabels.reduce(
    (sum, label) => sum + prediction.probabilities[label],
    0,
  );
  if (Math.abs(total - 1) > 1e-6) {
    context.addIssue({
      code: "custom",
      message: "Etiket olasılıklarının toplamı 1 olmalı.",
      path: ["probabilities"],
    });
  }
  const maximum = Math.max(...evaluationLabels.map((label) => prediction.probabilities[label]));
  if (prediction.probabilities[prediction.label] + 1e-12 < maximum) {
    context.addIssue({
      code: "custom",
      message: "Seçilen etiket en yüksek olasılığa sahip olmalı.",
      path: ["label"],
    });
  }
});

export const unassessedPredictionSchema = z.object({
  itemId: z.string(),
  status: z.literal("not_assessed"),
  reason: z.enum([
    "missing_input",
    "invalid_input",
    "context_limit",
    "provider_failure",
    "invalid_output",
  ]),
});

export const evaluationPredictionSchema = z.discriminatedUnion("status", [
  assessedPredictionSchema,
  unassessedPredictionSchema,
]);
export type EvaluationPrediction = z.infer<typeof evaluationPredictionSchema>;

type LabelCounts = Record<EvaluationLabel, number>;
export type ConfusionMatrix = Record<EvaluationLabel, Record<PredictionOutcomeLabel, number>>;

export type EvaluationMetrics = {
  total: number;
  assessed: number;
  notAssessed: number;
  coverage: number;
  accuracy: number;
  falseSupportRate: number;
  supportPrecision: number;
  contradictionRecall: number;
  missedContradictionRate: number;
  macroF1: number;
  multiclassBrier: number;
  expectedCalibrationError: number;
  confusion: ConfusionMatrix;
  criticalFalseSupportItemIds: string[];
};

export type EvaluationReport = {
  corpusSchemaVersion: "evaluation-corpus-v1";
  rubricVersion: "source-support-v1";
  split: "development" | "held_out" | "all";
  metrics: EvaluationMetrics;
  byLanguage: Partial<Record<z.infer<typeof evaluationLanguageSchema>, EvaluationMetrics>>;
  byRiskTag: Partial<Record<z.infer<typeof evaluationRiskTagSchema>, EvaluationMetrics>>;
};

const emptyLabelCounts = (): LabelCounts => ({
  supports: 0,
  contradicts: 0,
  insufficient_evidence: 0,
  not_applicable: 0,
});

const emptyConfusion = (): ConfusionMatrix => ({
  supports: { supports: 0, contradicts: 0, insufficient_evidence: 0, not_applicable: 0, not_assessed: 0 },
  contradicts: { supports: 0, contradicts: 0, insufficient_evidence: 0, not_applicable: 0, not_assessed: 0 },
  insufficient_evidence: { supports: 0, contradicts: 0, insufficient_evidence: 0, not_applicable: 0, not_assessed: 0 },
  not_applicable: { supports: 0, contradicts: 0, insufficient_evidence: 0, not_applicable: 0, not_assessed: 0 },
});

const safeDivide = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

function validatePredictions(
  items: EvaluationItem[],
  predictions: EvaluationPrediction[],
): Map<string, EvaluationPrediction> {
  const itemIds = new Set(items.map((item) => item.id));
  const result = new Map<string, EvaluationPrediction>();
  for (const candidate of predictions) {
    const prediction = evaluationPredictionSchema.parse(candidate);
    if (!itemIds.has(prediction.itemId)) {
      throw new Error(`Corpus dışında tahmin: ${prediction.itemId}`);
    }
    if (result.has(prediction.itemId)) {
      throw new Error(`Yinelenen tahmin: ${prediction.itemId}`);
    }
    result.set(prediction.itemId, prediction);
  }
  const missing = items.find((item) => !result.has(item.id));
  if (missing) throw new Error(`Eksik tahmin: ${missing.id}`);
  return result;
}

function calculateMetrics(
  items: EvaluationItem[],
  predictions: Map<string, EvaluationPrediction>,
): EvaluationMetrics {
  const confusion = emptyConfusion();
  const truePositives = emptyLabelCounts();
  const falsePositives = emptyLabelCounts();
  const falseNegatives = emptyLabelCounts();
  const calibrationBins = Array.from({ length: 10 }, () => ({ count: 0, confidence: 0, correct: 0 }));
  let assessed = 0;
  let correct = 0;
  let brierSum = 0;
  const criticalFalseSupportItemIds: string[] = [];

  for (const item of items) {
    const prediction = predictions.get(item.id);
    if (!prediction) throw new Error(`Eksik tahmin: ${item.id}`);
    const outcome: PredictionOutcomeLabel =
      prediction.status === "assessed" ? prediction.label : "not_assessed";
    confusion[item.goldLabel][outcome] += 1;
    if (prediction.status !== "assessed") {
      falseNegatives[item.goldLabel] += 1;
      continue;
    }

    assessed += 1;
    const isCorrect = prediction.label === item.goldLabel;
    if (isCorrect) {
      correct += 1;
      truePositives[item.goldLabel] += 1;
    } else {
      falsePositives[prediction.label] += 1;
      falseNegatives[item.goldLabel] += 1;
    }
    if (item.critical && item.goldLabel !== "supports" && prediction.label === "supports") {
      criticalFalseSupportItemIds.push(item.id);
    }

    const confidence = prediction.probabilities[prediction.label];
    const binIndex = Math.min(9, Math.floor(confidence * 10));
    const bin = calibrationBins[binIndex];
    if (!bin) throw new Error("Kalibrasyon dilimi oluşturulamadı.");
    bin.count += 1;
    bin.confidence += confidence;
    bin.correct += isCorrect ? 1 : 0;

    brierSum += evaluationLabels.reduce((sum, label) => {
      const expected = label === item.goldLabel ? 1 : 0;
      return sum + (prediction.probabilities[label] - expected) ** 2;
    }, 0) / evaluationLabels.length;
  }

  const macroF1 = evaluationLabels.reduce((sum, label) => {
    const precision = safeDivide(truePositives[label], truePositives[label] + falsePositives[label]);
    const recall = safeDivide(truePositives[label], truePositives[label] + falseNegatives[label]);
    return sum + safeDivide(2 * precision * recall, precision + recall);
  }, 0) / evaluationLabels.length;

  const expectedCalibrationError = calibrationBins.reduce((sum, bin) => {
    if (bin.count === 0 || assessed === 0) return sum;
    const averageConfidence = bin.confidence / bin.count;
    const binAccuracy = bin.correct / bin.count;
    return sum + (bin.count / assessed) * Math.abs(binAccuracy - averageConfidence);
  }, 0);

  const nonSupportCount = items.filter((item) => item.goldLabel !== "supports").length;
  const falseSupportCount = items.filter((item) => {
    const prediction = predictions.get(item.id);
    return item.goldLabel !== "supports" && prediction?.status === "assessed" && prediction.label === "supports";
  }).length;
  const predictedSupportCount = items.filter((item) => {
    const prediction = predictions.get(item.id);
    return prediction?.status === "assessed" && prediction.label === "supports";
  }).length;
  const goldContradictionCount = items.filter((item) => item.goldLabel === "contradicts").length;
  const correctContradictionCount = confusion.contradicts.contradicts;

  return {
    total: items.length,
    assessed,
    notAssessed: items.length - assessed,
    coverage: safeDivide(assessed, items.length),
    accuracy: safeDivide(correct, items.length),
    falseSupportRate: safeDivide(falseSupportCount, nonSupportCount),
    supportPrecision: safeDivide(confusion.supports.supports, predictedSupportCount),
    contradictionRecall: safeDivide(correctContradictionCount, goldContradictionCount),
    missedContradictionRate: safeDivide(
      goldContradictionCount - correctContradictionCount,
      goldContradictionCount,
    ),
    macroF1,
    multiclassBrier: safeDivide(brierSum, assessed),
    expectedCalibrationError,
    confusion,
    criticalFalseSupportItemIds,
  };
}

export function evaluatePredictions(
  inputCorpus: unknown,
  inputPredictions: unknown[],
  split: EvaluationReport["split"] = "held_out",
): EvaluationReport {
  const corpus = evaluationCorpusSchema.parse(inputCorpus);
  const items = split === "all" ? corpus.items : corpus.items.filter((item) => item.split === split);
  if (items.length === 0) throw new Error(`Değerlendirme bölümü boş: ${split}`);
  const predictions = validatePredictions(items, inputPredictions as EvaluationPrediction[]);
  const byLanguage: EvaluationReport["byLanguage"] = {};
  for (const language of evaluationLanguageSchema.options) {
    const languageItems = items.filter((item) => item.language === language);
    if (languageItems.length > 0) byLanguage[language] = calculateMetrics(languageItems, predictions);
  }
  const byRiskTag: EvaluationReport["byRiskTag"] = {};
  for (const riskTag of evaluationRiskTagSchema.options) {
    const riskItems = items.filter((item) => item.riskTags.includes(riskTag));
    if (riskItems.length > 0) byRiskTag[riskTag] = calculateMetrics(riskItems, predictions);
  }
  return {
    corpusSchemaVersion: corpus.schemaVersion,
    rubricVersion: corpus.rubricVersion,
    split,
    metrics: calculateMetrics(items, predictions),
    byLanguage,
    byRiskTag,
  };
}

export type PairedInterval = {
  metric: "falseSupportRate" | "missedContradictionRate";
  candidateMinusBaseline: number;
  lower95: number;
  upper95: number;
  documentCount: number;
  iterations: number;
};

const mulberry32 = (seed: number): (() => number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
};

function rateForSample(
  sampledDocuments: string[],
  itemsByDocument: Map<string, EvaluationItem[]>,
  predictions: Map<string, EvaluationPrediction>,
  metric: PairedInterval["metric"],
): number | undefined {
  let numerator = 0;
  let denominator = 0;
  for (const documentId of sampledDocuments) {
    for (const item of itemsByDocument.get(documentId) ?? []) {
      const prediction = predictions.get(item.id);
      if (!prediction) throw new Error(`Eksik tahmin: ${item.id}`);
      if (metric === "falseSupportRate" && item.goldLabel !== "supports") {
        denominator += 1;
        if (prediction.status === "assessed" && prediction.label === "supports") numerator += 1;
      }
      if (metric === "missedContradictionRate" && item.goldLabel === "contradicts") {
        denominator += 1;
        if (prediction.status !== "assessed" || prediction.label !== "contradicts") numerator += 1;
      }
    }
  }
  return denominator === 0 ? undefined : numerator / denominator;
}

export function pairedDocumentBootstrap(
  inputCorpus: unknown,
  candidateInput: unknown[],
  baselineInput: unknown[],
  metric: PairedInterval["metric"],
  options: { split?: "development" | "held_out"; iterations?: number; seed?: number } = {},
): PairedInterval {
  const corpus = evaluationCorpusSchema.parse(inputCorpus);
  const split = options.split ?? "held_out";
  const items = corpus.items.filter((item) => item.split === split);
  const candidate = validatePredictions(items, candidateInput as EvaluationPrediction[]);
  const baseline = validatePredictions(items, baselineInput as EvaluationPrediction[]);
  const itemsByDocument = new Map<string, EvaluationItem[]>();
  for (const item of items) {
    itemsByDocument.set(item.documentId, [...(itemsByDocument.get(item.documentId) ?? []), item]);
  }
  const documents = [...itemsByDocument.keys()].sort();
  if (documents.length < 2) throw new Error("Belge kümeli aralık için en az iki belge gerekli.");
  const iterations = options.iterations ?? 2_000;
  if (!Number.isInteger(iterations) || iterations < 100) {
    throw new Error("Bootstrap yineleme sayısı en az 100 olan bir tam sayı olmalı.");
  }
  const random = mulberry32(options.seed ?? 28_091_726);
  const deltas: number[] = [];
  let attempts = 0;
  while (deltas.length < iterations && attempts < iterations * 20) {
    attempts += 1;
    const sampledDocuments = documents.map(
      () => documents[Math.floor(random() * documents.length)] ?? documents[0]!,
    );
    const candidateRate = rateForSample(sampledDocuments, itemsByDocument, candidate, metric);
    const baselineRate = rateForSample(sampledDocuments, itemsByDocument, baseline, metric);
    if (candidateRate === undefined || baselineRate === undefined) continue;
    deltas.push(candidateRate - baselineRate);
  }
  if (deltas.length < iterations) {
    throw new Error("Yeterli sayıda uygun belge-kümeli örneklem oluşturulamadı.");
  }
  deltas.sort((left, right) => left - right);
  const quantile = (probability: number): number =>
    deltas[Math.min(deltas.length - 1, Math.floor(probability * deltas.length))] ?? 0;
  const allDocumentsCandidate = rateForSample(documents, itemsByDocument, candidate, metric);
  const allDocumentsBaseline = rateForSample(documents, itemsByDocument, baseline, metric);
  if (allDocumentsCandidate === undefined || allDocumentsBaseline === undefined) {
    throw new Error(`Seçilen ölçüt için uygun örnek yok: ${metric}`);
  }
  return {
    metric,
    candidateMinusBaseline: allDocumentsCandidate - allDocumentsBaseline,
    lower95: quantile(0.025),
    upper95: quantile(0.975),
    documentCount: documents.length,
    iterations,
  };
}

export const decisionModeSchema = z.enum(["shadow", "advisory"]);
export type DecisionMode = z.infer<typeof decisionModeSchema>;

export const decisionAssessmentStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "outcome_unknown",
  "cancelled",
]);
export type DecisionAssessmentStatus = z.infer<typeof decisionAssessmentStatusSchema>;

export const decisionAssessmentInputSchema = z.object({
  assessmentId: z.string().uuid(),
  runId: z.string().uuid(),
  claimId: z.string().regex(/^(?:claim|red-team)-\d{3}$/),
  sourceId: z.string().uuid(),
  claim: z.string().trim().min(1).max(4_000),
  sourceExcerpt: z.string().trim().min(1).max(4_000),
  sourcePublishedAt: z.iso.date().nullable(),
  sourceCapturedAt: z.iso.datetime({ offset: true }),
  rubricVersion: z.literal("source-support-v1"),
  model: z.string().trim().min(1).max(120),
});
export type DecisionAssessmentInput = z.infer<typeof decisionAssessmentInputSchema>;

export const decisionAssessmentResultSchema = z.object({
  label: evaluationLabelSchema,
  probabilities: probabilitySchema,
  providerConfidence: z.number().min(0).max(1).nullable(),
  requestedModel: z.string().trim().min(1).max(120),
  returnedModel: z.string().trim().min(1).max(120),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
}).superRefine((result, context) => {
  const total = evaluationLabels.reduce((sum, label) => sum + result.probabilities[label], 0);
  if (Math.abs(total - 1) > 1e-6) {
    context.addIssue({
      code: "custom",
      message: "Karar olasılıklarının toplamı 1 olmalı.",
      path: ["probabilities"],
    });
  }
  const maximum = Math.max(...evaluationLabels.map((label) => result.probabilities[label]));
  if (result.probabilities[result.label] + 1e-12 < maximum) {
    context.addIssue({
      code: "custom",
      message: "Karar etiketi en yüksek olasılığa sahip olmalı.",
      path: ["label"],
    });
  }
});
export type DecisionAssessmentResult = z.infer<typeof decisionAssessmentResultSchema>;

export interface DecisionEvaluator {
  readonly provider: "fake-decision" | "typesafe";
  readonly model: string;
  evaluate(input: DecisionAssessmentInput, operationId?: string): Promise<DecisionAssessmentResult>;
}

export const saveDecisionConnectionSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().max(512).default(""),
  defaultModel: z.string().trim().regex(/^jev-\d+\.\d+\.\d+$/).default("jev-1.13.0"),
}).superRefine((connection, context) => {
  if (!connection.id && connection.apiKey.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Yeni TypeSafe bağlantısı için API anahtarı gerekli.",
      path: ["apiKey"],
    });
  }
});
export type SaveDecisionConnectionRequest = z.infer<typeof saveDecisionConnectionSchema>;

export const createDecisionAssessmentSchema = z.object({
  runId: z.string().uuid(),
  claimId: z.string().regex(/^(?:claim|red-team)-\d{3}$/),
  sourceId: z.string().uuid(),
  connectionId: z.string().uuid(),
  model: z.string().trim().regex(/^jev-\d+\.\d+\.\d+$/),
  mode: z.literal("shadow").default("shadow"),
  confirmExternalShare: z.literal(true),
});
export type CreateDecisionAssessmentRequest = z.infer<typeof createDecisionAssessmentSchema>;

export const resolveDecisionOperationSchema = z.object({
  action: z.enum(["discard", "authorize_retry"]),
});
export type ResolveDecisionOperationRequest = z.infer<typeof resolveDecisionOperationSchema>;
