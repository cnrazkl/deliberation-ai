import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectKnowledgeEvaluationPlan as inspectFrozenPlan, knowledgeEvaluationPlanSchema, knowledgeFixtureNames } from "./knowledge-evaluation";
import { createCouncilCoverageReviewWorksheet, compileCouncilCoverageReviewWorksheet } from "./council-coverage-labeling";
import { compileExternalCouncilIntake, sha256 } from "./external-council-intake";

const suiteText = readFileSync(new URL("../../../docs/evaluation/COUNCIL_EXTERNAL_SUITE.json", import.meta.url), "utf8");
const protocolText = readFileSync(new URL("../../../docs/evaluation/KNOWLEDGE_EVALUATION.md", import.meta.url), "utf8");
const plan = knowledgeEvaluationPlanSchema.parse(JSON.parse(readFileSync(
  new URL("../../../docs/evaluation/KNOWLEDGE_EVALUATION_PLAN.json", import.meta.url), "utf8",
)));
const fixtureDigests = Object.fromEntries(knowledgeFixtureNames.map((name) => [name, createHash("sha256").update(
  readFileSync(new URL(`../../../docs/evaluation/knowledge-fixtures/${name}`, import.meta.url)),
).digest("hex")]));
const inspectKnowledgeEvaluationPlan = (input: unknown, suite: string, protocol: string) =>
  inspectFrozenPlan(input, suite, protocol, fixtureDigests);

describe("frozen knowledge preparation", () => {
  it("preserves all family-isolated cases while keeping quality and format acceptance blocked", () => {
    const inspected = inspectKnowledgeEvaluationPlan(plan, suiteText, protocolText);
    expect(inspected.status).toMatchObject({ caseCount: 40, sourceCount: 11,
      bySplit: { development: 20, held_out: 20 }, byLanguage: { tr: 26, en: 10, mixed: 4 },
      challengeCount: 10, integrity: "verified", humanLabels: "not_assessed",
      formatFixtureCount: 4, formatCaseCount: 8,
      formatCoverage: "frozen_fixtures_not_assessed", modelMeasurements: "not_assessed", releaseAcceptance: "blocked" });
    const forms = (["a", "b"] as const).map((slot) => createCouncilCoverageReviewWorksheet(inspected.intake, slot));
    for (const form of forms) {
      expect(() => compileCouncilCoverageReviewWorksheet(inspected.intake, form)).toThrow();
      expect(JSON.stringify(form)).not.toContain('"held_out"');
      expect(form.reviewerId).toBe("");
    }
  });

  it("rejects protocol/source/question drift even when source text is still valid", () => {
    expect(() => inspectKnowledgeEvaluationPlan(plan, suiteText, `${protocolText}\nchanged`)).toThrow();
    expect(() => inspectKnowledgeEvaluationPlan(plan, `${suiteText}\n`, protocolText)).toThrow();
    const changedSuite = JSON.parse(suiteText);
    changedSuite.cases[0].question += " changed";
    const changedText = JSON.stringify(changedSuite);
    const changedPlan = { ...plan, sourceSuiteFileSha256: sha256(changedText) };
    expect(() => inspectKnowledgeEvaluationPlan(changedPlan, changedText, protocolText)).toThrow();
  });

  it("rejects missing/duplicate cases and replacement challenge identities", () => {
    const missing = structuredClone(plan); missing.caseIds.pop();
    expect(() => inspectKnowledgeEvaluationPlan(missing, suiteText, protocolText)).toThrow();
    const duplicate = structuredClone(plan); duplicate.caseIds[1] = duplicate.caseIds[0]!;
    expect(() => inspectKnowledgeEvaluationPlan(duplicate, suiteText, protocolText)).toThrow();
    const swapped = structuredClone(plan); swapped.challenges[1]!.id = swapped.challenges[0]!.id;
    expect(() => inspectKnowledgeEvaluationPlan(swapped, suiteText, protocolText)).toThrow();
    expect(() => inspectKnowledgeEvaluationPlan({ ...plan, releaseAcceptance: "accepted" }, suiteText, protocolText)).toThrow();
  });

  it("retains source-family isolation even if the outer file hash is recomputed", () => {
    const changedSuite = JSON.parse(suiteText);
    changedSuite.cases[0].split = "development";
    const changedText = JSON.stringify(changedSuite);
    expect(() => compileExternalCouncilIntake(changedSuite)).toThrow();
    expect(() => inspectKnowledgeEvaluationPlan({ ...plan, sourceSuiteFileSha256: sha256(changedText) }, changedText, protocolText)).toThrow();
  });

  it("rejects changed binary fixtures, duplicate format questions and false derivative families", () => {
    expect(() => inspectFrozenPlan(plan, suiteText, protocolText, { ...fixtureDigests,
      "scanned-support.pdf": "0".repeat(64) })).toThrow();
    const duplicate = structuredClone(plan); duplicate.formatCases[1]!.id = duplicate.formatCases[0]!.id;
    expect(() => inspectKnowledgeEvaluationPlan(duplicate, suiteText, protocolText)).toThrow();
    const wrongFamily = structuredClone(plan); wrongFamily.formatFixtures[0]!.family = "support-targets";
    expect(() => inspectKnowledgeEvaluationPlan(wrongFamily, suiteText, protocolText)).toThrow();
  });

  it("binds the owner's trial approval to this exact plan without accepting labels or quality", () => {
    const base = inspectKnowledgeEvaluationPlan(plan, suiteText, protocolText);
    const approval = { schemaVersion: "knowledge-contract-approval-v1", planSha256: base.status.planSha256,
      acceptedAt: "2026-10-05T13:05:00.000Z", decisionSource: "explicit_owner_reply_in_da119_chat",
      selectedFilesOnly: true, trialContractAccepted: true, independentLabelsAccepted: false, modelQualityAccepted: false };
    const inspected = inspectFrozenPlan(plan, suiteText, protocolText, fixtureDigests, approval);
    expect(inspected.status.ownerRatification).toBe("accepted_trial_contract");
    expect(inspected.status.releaseAcceptance).toBe("blocked");
    expect(() => inspectFrozenPlan(plan, suiteText, protocolText, fixtureDigests,
      { ...approval, planSha256: "0".repeat(64) })).toThrow();
    expect(() => inspectFrozenPlan(plan, suiteText, protocolText, fixtureDigests,
      { ...approval, independentLabelsAccepted: true })).toThrow();
  });
});
