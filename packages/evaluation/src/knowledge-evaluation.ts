import { z } from "zod";
import { compileExternalCouncilIntake, sha256 } from "./external-council-intake";

export const knowledgeChallengeIds = [
  "empty-scope", "foreign-source", "scope-cache", "revocation", "injection",
  "source-version", "unknown-publication", "no-answer", "unsupported-scan", "duplicate-origin",
] as const;
export const knowledgeFixtureNames = ["selectable-sun.pdf", "support-table.pdf", "scanned-support.pdf", "ambiguous-support.png"] as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const knowledgeEvaluationPlanSchema = z.object({
  schemaVersion: z.literal("knowledge-evaluation-plan-v1"),
  protocolSha256: digest,
  sourceSuiteFileSha256: digest,
  suiteSha256: digest,
  intakeSha256: digest,
  caseIds: z.array(z.string()).length(40),
  challenges: z.array(z.object({
    id: z.enum(knowledgeChallengeIds),
    question: z.string().min(10).max(1_000),
    selectedCollections: z.array(z.string()).max(3),
    sourceText: z.string().max(4_000),
    expectedBoundary: z.string().min(10).max(2_000),
  }).strict()).length(knowledgeChallengeIds.length),
  formatFixtures: z.array(z.object({
    name: z.enum(knowledgeFixtureNames), sha256: digest,
    family: z.enum(["solar-rotation", "support-targets"]),
    split: z.literal("development"),
  }).strict()).length(knowledgeFixtureNames.length),
  formatCases: z.array(z.object({
    id: z.string().regex(/^format-[a-z0-9-]+$/),
    fixture: z.enum(knowledgeFixtureNames), question: z.string().min(10).max(1_000),
    language: z.enum(["tr", "en"]),
  }).strict()).length(8),
}).strict();

export const knowledgeContractApprovalSchema = z.object({
  schemaVersion: z.literal("knowledge-contract-approval-v1"),
  planSha256: digest,
  acceptedAt: z.iso.datetime(),
  decisionSource: z.literal("explicit_owner_reply_in_da119_chat"),
  selectedFilesOnly: z.literal(true),
  trialContractAccepted: z.literal(true),
  independentLabelsAccepted: z.literal(false),
  modelQualityAccepted: z.literal(false),
}).strict();

/** Offline integrity/status only. It never turns blank forms or examples into acceptance. */
export function inspectKnowledgeEvaluationPlan(
  planInput: unknown, suiteText: string, protocolText: string,
  fixtureDigests: Readonly<Record<string, string>>,
  approvalInput?: unknown,
) {
  const plan = knowledgeEvaluationPlanSchema.parse(planInput);
  if (plan.sourceSuiteFileSha256 !== sha256(suiteText) || plan.protocolSha256 !== sha256(protocolText)) {
    throw new Error("Frozen knowledge protocol or source-suite bytes changed.");
  }
  const planSha256 = sha256(JSON.stringify(plan));
  const approval = approvalInput === undefined ? undefined : knowledgeContractApprovalSchema.parse(approvalInput);
  if (approval && approval.planSha256 !== planSha256) throw new Error("Owner approval is for another frozen knowledge plan.");
  const compiled = compileExternalCouncilIntake(JSON.parse(suiteText) as unknown);
  if (plan.suiteSha256 !== compiled.manifest.suiteSha256 || plan.intakeSha256 !== compiled.manifest.intakeSha256 ||
      new Set(plan.caseIds).size !== plan.caseIds.length ||
      JSON.stringify(plan.caseIds) !== JSON.stringify(compiled.intake.cases.map((item) => item.id)) ||
      new Set(plan.challenges.map((item) => item.id)).size !== knowledgeChallengeIds.length ||
      new Set(plan.formatFixtures.map((item) => item.name)).size !== knowledgeFixtureNames.length ||
      new Set(plan.formatCases.map((item) => item.id)).size !== plan.formatCases.length ||
      knowledgeFixtureNames.some((name) => !plan.formatCases.some((item) => item.fixture === name)) ||
      plan.formatFixtures.some((item) => item.sha256 !== fixtureDigests[item.name] ||
        item.family !== (item.name === "selectable-sun.pdf" ? "solar-rotation" : "support-targets"))) {
    throw new Error("Frozen knowledge cohort or challenge identities changed.");
  }
  return {
    plan,
    intake: compiled.intake,
    status: {
      schemaVersion: "knowledge-evaluation-status-v1" as const,
      planSha256,
      caseCount: compiled.manifest.caseCount,
      sourceCount: compiled.manifest.sourceCount,
      bySplit: compiled.manifest.bySplit,
      byLanguage: compiled.manifest.byLanguage,
      challengeCount: plan.challenges.length,
      formatFixtureCount: plan.formatFixtures.length,
      formatCaseCount: plan.formatCases.length,
      integrity: "verified" as const,
      // This command only inspects public preparation artifacts, not human evidence.
      humanLabels: "not_assessed" as const,
      formatCoverage: "frozen_fixtures_not_assessed" as const,
      ownerRatification: approval ? "accepted_trial_contract" as const : "not_assessed" as const,
      modelMeasurements: "not_assessed" as const,
      releaseAcceptance: "blocked" as const,
    },
  };
}
