import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  inspectKnowledgeEvaluationPlan,
  createCouncilCoverageReviewWorksheet,
  compileCouncilCoverageReviewWorksheet,
  createCouncilCoverageAdjudicationWorksheet,
  compileCouncilCoverageAdjudicationWorksheet,
  knowledgeFixtureNames,
  createKnowledgeFormatWorksheet,
  compileKnowledgeFormatReviewPair,
  createKnowledgeFormatAdjudicationWorksheet,
  compileKnowledgeFormatAdjudicationWorksheet,
  createKnowledgeReviewAttestationWorksheet,
  compileKnowledgeReviewAttestationWorksheet,
} from "@deliberation-ai/evaluation";
import { verifyKnowledgeExtractionSnapshot } from "./knowledge-extraction-snapshot";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".local/knowledge-evaluation");
const [mode, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error("Only one knowledge workflow mode is supported.");
const { plan, intake, status } = inspectKnowledgeEvaluationPlan(
  JSON.parse(readFileSync(resolve(root, "docs/evaluation/KNOWLEDGE_EVALUATION_PLAN.json"), "utf8")) as unknown,
  readFileSync(resolve(root, "docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"), "utf8"),
  readFileSync(resolve(root, "docs/evaluation/KNOWLEDGE_EVALUATION.md"), "utf8"),
  Object.fromEntries(knowledgeFixtureNames.map((name) => [name, createHash("sha256").update(
    readFileSync(resolve(root, "docs/evaluation/knowledge-fixtures", name)),
  ).digest("hex")])),
  existsSync(resolve(root, "docs/evaluation/KNOWLEDGE_CONTRACT_APPROVAL.json"))
    ? JSON.parse(readFileSync(resolve(root, "docs/evaluation/KNOWLEDGE_CONTRACT_APPROVAL.json"), "utf8")) as unknown
    : undefined,
);
const writeBatch = (files: { path: string; value: unknown }[]) => {
  if (files.some((file) => existsSync(file.path))) throw new Error("Existing knowledge review files are preserved.");
  for (const file of files) {
    mkdirSync(resolve(file.path, ".."), { recursive: true });
    writeFileSync(file.path, `${JSON.stringify(file.value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
};
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8")) as unknown;
const readReviews = () => (["a", "b"] as const).map((slot) => {
  const worksheet = readJson(resolve(output, `reviewer-${slot}/worksheet.json`));
  if (typeof worksheet !== "object" || worksheet === null || !("slot" in worksheet) || worksheet.slot !== slot) {
    throw new Error("Knowledge reviewer worksheet has the wrong slot.");
  }
  return compileCouncilCoverageReviewWorksheet(intake, worksheet);
});
const checkedReviews = () => {
  const reviews = readReviews();
  if (reviews[0]!.reviewerId === reviews[1]!.reviewerId) throw new Error("Two distinct human reviewers are required.");
  return reviews as [typeof reviews[number], typeof reviews[number]];
};

async function main() {
  if (mode === "status") {
    console.log(JSON.stringify(status, null, 2));
  } else if (mode === "prepare") {
    writeBatch([
      ...(["a", "b"] as const).map((slot) => ({
        path: resolve(output, `reviewer-${slot}/worksheet.json`),
        value: createCouncilCoverageReviewWorksheet(intake, slot),
      })),
      ...(["a", "b"] as const).map((slot) => ({
        path: resolve(output, `reviewer-${slot}/format-worksheet.json`),
        value: createKnowledgeFormatWorksheet(plan, slot),
      })),
      { path: resolve(output, "owner-review.json"), value: {
        schemaVersion: "knowledge-owner-review-v1", planSha256: status.planSha256,
        ownerId: "", reviewedAt: null, scopeApproved: null, trialLimitsApproved: null,
        qualityProtocolApproved: null, corpusCoverageApproved: null, rationale: "",
      } },
    ]);
    console.log("Two blank text/format reviewer sets and a pending owner form created; no acceptance claimed.");
  } else if (mode === "compile-reviews") {
    const reviews = checkedReviews();
    writeBatch(reviews.map((review, index) => ({
      path: resolve(output, `compiled/review-${index === 0 ? "a" : "b"}.json`), value: review,
    })));
    console.log("Source-bound reviews compiled; human independence and acceptance still require attestation.");
  } else if (mode === "format-compile" || mode === "format-adjudication-prepare" || mode === "format-adjudication-compile") {
    const extractionText = readFileSync(resolve(root, "docs/evaluation/KNOWLEDGE_EXTRACTION_SNAPSHOT.json"), "utf8");
    await verifyKnowledgeExtractionSnapshot(root, extractionText);
    const worksheets = [
      readJson(resolve(output, "reviewer-a/format-worksheet.json")),
      readJson(resolve(output, "reviewer-b/format-worksheet.json")),
    ] as const;
    if (mode === "format-compile") {
      const reviews = compileKnowledgeFormatReviewPair(plan, extractionText, worksheets);
      writeBatch(reviews.map((review) => ({ path: resolve(output, `compiled/format-review-${review.slot}.json`), value: review })));
      console.log("Page-bound format reviews compiled; adjudication, independence and release acceptance remain pending.");
    } else if (mode === "format-adjudication-prepare") {
      writeBatch([{ path: resolve(output, "adjudicator/format-worksheet.json"),
        value: createKnowledgeFormatAdjudicationWorksheet(plan, extractionText, worksheets) }]);
      console.log("Blank format adjudication form created; original reviews retained and no decision generated.");
    } else {
      const result = compileKnowledgeFormatAdjudicationWorksheet(plan, extractionText, worksheets,
        readJson(resolve(output, "adjudicator/format-worksheet.json")));
      writeBatch([{ path: resolve(output, "compiled/format-adjudication.json"), value: result }]);
      console.log("Source-bound format adjudication declarations compiled; independence, gold and release acceptance remain pending.");
    }
  } else if (mode === "attestation-prepare" || mode === "attestation-compile") {
    const extractionText = readFileSync(resolve(root, "docs/evaluation/KNOWLEDGE_EXTRACTION_SNAPSHOT.json"), "utf8");
    await verifyKnowledgeExtractionSnapshot(root, extractionText);
    const inputs = {
      textReviews: [readJson(resolve(output, "reviewer-a/worksheet.json")), readJson(resolve(output, "reviewer-b/worksheet.json"))] as const,
      textAdjudication: readJson(resolve(output, "adjudicator/worksheet.json")),
      formatReviews: [readJson(resolve(output, "reviewer-a/format-worksheet.json")), readJson(resolve(output, "reviewer-b/format-worksheet.json"))] as const,
      formatAdjudication: readJson(resolve(output, "adjudicator/format-worksheet.json")),
    };
    if (mode === "attestation-prepare") {
      writeBatch([{ path: resolve(output, "coordinator/worksheet.json"),
        value: createKnowledgeReviewAttestationWorksheet(plan, intake, extractionText, inputs) }]);
      console.log("Blank coordinator attestation created; no independence, coverage or acceptance decision generated.");
    } else {
      writeBatch([{ path: resolve(output, "compiled/attestation.json"), value: compileKnowledgeReviewAttestationWorksheet(
        plan, intake, extractionText, inputs, readJson(resolve(output, "coordinator/worksheet.json"))) }]);
      console.log("Bound human coordinator declarations recorded; owner gold review and empirical release acceptance remain pending.");
    }
  } else if (mode === "adjudication-prepare") {
    writeBatch([{ path: resolve(output, "adjudicator/worksheet.json"),
      value: createCouncilCoverageAdjudicationWorksheet(intake, checkedReviews()) }]);
    console.log("Blank knowledge adjudication form created.");
  } else if (mode === "adjudication-compile") {
    const result = compileCouncilCoverageAdjudicationWorksheet(
      intake, checkedReviews(), readJson(resolve(output, "adjudicator/worksheet.json")),
    );
    writeBatch([{ path: resolve(output, "compiled/adjudication.json"), value: result }]);
    console.log("Knowledge adjudication compiled; format coverage, independence and model study remain separate gates.");
  } else {
    throw new Error("Use status, prepare, compile-reviews, format-compile, format-adjudication-prepare, format-adjudication-compile, attestation-prepare, attestation-compile, adjudication-prepare or adjudication-compile.");
  }
}
void main().catch((error: unknown) => {
  if (!mode?.startsWith("format-") && !mode?.startsWith("attestation-")) throw error;
  console.error("Human evidence workflow refused: verify frozen extraction, complete the required human worksheets and preserve existing outputs. No acceptance recorded.");
  process.exitCode = 1;
});
