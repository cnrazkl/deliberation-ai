import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { prepareStudyExecution,matchesFrozenStudyReviewPolicy, type StudyExecutionPlan, type StudySelection } from "@deliberation-ai/evaluation";
import { buildRoundZeroPromptPlan, buildReviewInstructionPlan, buildRiskPreflight, createHostedSynthesisPort } from "@deliberation-ai/application";
import { createRunRequestSchema, type CouncilMemberConfig } from "@deliberation-ai/contracts";
import { closeDatabase, getPool } from "../src/database";
import { getOwnerId } from "../src/owner";
import { closeBoss } from "../src/queue";
import { loadProviderConnectionSecret } from "../src/provider-connections";
import { enqueueDurableRun, findDurableRunById } from "../src/run-repository";
import { getRunProviderUsage } from "../src/provider-operations";
import { SynthesisFileJournal } from "./synthesis-journal";
import { withStudyOwner } from "../src/study-owner";

const root = resolve(import.meta.dirname, "../../../");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const suite = () => JSON.parse(readFileSync(resolve(root, "docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"), "utf8")) as unknown;
type Binding = { id: string; revision: number; identity: string };
type Plan = { version: "study-dispatch-v4"; ownerId: string; requestId: string; study: StudyExecutionPlan; bindings: Binding[]; members: CouncilMemberConfig[]; reviewInstructions: ReturnType<typeof buildReviewInstructionPlan>; fingerprint: string };
const [mode, name, ...args] = process.argv.slice(2);
const phase = (index: number) => `arm_${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`;
async function connections(ids: string[]) {
  const loaded = await Promise.all(ids.map(async (id, index) => {
    const connection = await loadProviderConnectionSecret(id);
    if (!connection) throw new Error("Owned connection required");
    return { binding: { id, revision: connection.revision, identity: createHostedSynthesisPort(connection, "identity-only").identity },
      member: { id: `study-member-${index}`, label: `Study member ${index + 1}`, role: "Independent source-bound analysis",
        provider: connection.provider, model: connection.defaultModel, connectionId: id, reasoningLevel: "default" as const,
        webSearchMode: "off" as const, councilRole: index === 1 ? "red-team" as const : "analyst" as const,
        ...(connection.endpointPreset === "nvidia" ? { nvidiaConnectionRevision: connection.revision } : {}) } };
  }));
  if (new Set(loaded.map((item) => item.binding.identity)).size !== loaded.length) throw new Error("Distinct model targets required");
  return { bindings: loaded.map((item) => item.binding), members: loaded.map((item) => item.member) };
}
function freeze(ownerId: string, study: StudyExecutionPlan, bindings: Binding[], members: CouncilMemberConfig[]) {
  return hash({ version: "study-dispatch-v4", ownerId, study, bindings, members, reviewInstructions: buildReviewInstructionPlan(members),
    promptPlans: study.arms.map((arm) => buildRoundZeroPromptPlan({ question: arm.question, members, documents: [], images: [], memoryContext: [], toolContext: [] })) });
}
type Observation = { caseId: string; arm: string; runId: string | null; status: string; executionMs: number;
  operationCount: number | null; inputTokens: number | null; outputTokens: number | null; unknown: boolean; providerRejected?: boolean; policyMatched?: boolean };
function summary(observations: Observation[], plan: Plan) {
  return { version: plan.version, plannedCalls: plan.study.plannedCalls, plannedArms: plan.study.arms.length,
    observedArms: observations.length, unobservedArms: plan.study.arms.length - observations.length,
    completedArms: observations.filter(item => item.status === "completed" && !item.unknown && item.policyMatched!==false).length,
    executionStatus: observations.length === plan.study.arms.length && observations.every(item => !item.unknown && item.policyMatched!==false) ? "all_arms_observed" : "blocked_incomplete",
    observations, selectedCases: plan.study.selectedCases, totalCases: plan.study.totalCases,
    humanAcceptance: "not_assessed", accuracy: null, invoiceCost: "unknown" };
}
async function execute() {
  if (!name) throw new Error("Study identity required");
  const journal = new SynthesisFileJournal(resolve(root, ".local/study-execution"), name, async () => {});
  if (mode === "prepare" && args.length === 1) {
    const configStat = statSync(resolve(args[0]!));
    if (!configStat.isFile() || configStat.size > 200_000) throw new Error("Configuration file bound");
    const config = JSON.parse(readFileSync(resolve(args[0]!), "utf8")) as { ownerId: string; selection: StudySelection; connectionIds: string[] };
    if (!config || Object.keys(config).some((key) => !["ownerId", "selection", "connectionIds"].includes(key)) ||
      !Array.isArray(config.connectionIds) || config.connectionIds.length !== config.selection.memberCount ||
      config.connectionIds.some((id) => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id))) throw new Error("Invalid member count");
    const study = prepareStudyExecution(suite(), config.selection);
    const targets = await connections(config.connectionIds);
    const plan: Plan = { version: "study-dispatch-v4", ownerId: config.ownerId, requestId: randomUUID(), study, ...targets,reviewInstructions:buildReviewInstructionPlan(targets.members),
      fingerprint: freeze(config.ownerId, study, targets.bindings, targets.members) };
    journal.write("plan.enc", plan);
    writeFileSync(resolve(journal.directory, "preview.md"), ["# Dondurulmuş deney gönderimi", `Fingerprint: ${plan.fingerprint}`,
      `${study.arms.length} kol; en fazla ${study.plannedCalls} çağrı; çağrı başına ${study.selection.outputTokens} istenen çıktı tokenı.`,
      "İnsan doğruluğu değerlendirilmedi. Maliyet bilinmiyor. Başarısız kollar da korunur. Seçilen örnekler tam deney değildir.",
      JSON.stringify({ fixedReviewInstructions: buildReviewInstructionPlan(targets.members), futurePeerInputs: "unknown_before_execution" }, null, 2),
      ...study.arms.map((arm) => JSON.stringify({ ...arm, prompt: buildRoundZeroPromptPlan({ question: arm.question, members: targets.members, documents: [], images: [], memoryContext: [], toolContext: [] }) }, null, 2)),
    ].join("\n\n"), { flag: "wx" });
    console.log(JSON.stringify({ status: "prepared", fingerprint: plan.fingerprint, arms: study.arms.length, plannedCalls: study.plannedCalls }));
  } else if (mode === "run" && args.length === 2 && args[0] === "--live") {
    const plan = journal.read<Plan>("plan.enc");
    if (args[1] !== plan.fingerprint) throw new Error("Changed approval");
    if (journal.has("result.enc")) console.log(JSON.stringify(journal.read("result.enc")));
    else {
      if (plan.version !== "study-dispatch-v4") throw new Error("Current owner/policy-bound preparation required");
      if (journal.has("execution.enc")) throw new Error("Prior study cannot be resent");
      const validate = async () => {
        const current = prepareStudyExecution(suite(), plan.study.selection);
        const targets = await connections(plan.bindings.map((item) => item.id));
        if (freeze(plan.ownerId, current, targets.bindings, targets.members) !== plan.fingerprint) throw new Error("Changed study or connections");
      };
      await validate();
      journal.write("execution.enc", { fingerprint: plan.fingerprint, at: new Date().toISOString() });
      const observations: Observation[] = [];
      let nextIndex = 0;
      let halted = false;
      const runNext = async () => {
      while (!halted && nextIndex < plan.study.arms.length) {
        const index = nextIndex++;
        const arm = plan.study.arms[index]!;
        await validate();
        if (halted) return;
        const calls = plan.members.length * (1 + arm.reviewRounds);
        const prompt = buildRoundZeroPromptPlan({ question: arm.question, members: plan.members, documents: [], images: [], memoryContext: [], toolContext: [] });
        const risk = buildRiskPreflight({ question: arm.question, requestedProfile: arm.riskProfile, promptFingerprint: prompt.fingerprint, reviewRounds: arm.reviewRounds });
        const request = createRunRequestSchema.parse({ question: arm.question, members: plan.members, providerMode: "remote", riskProfile: arm.riskProfile,
          reviewRounds: arm.reviewRounds, selfRevisionEnabled: false, idempotencyKey: `${plan.requestId}:${index}`,
          expectedPreflightFingerprint: prompt.fingerprint, expectedRiskFingerprint: risk.fingerprint,
          executionLimits: { version: "dispatch-limits-v1", maxProviderCalls: calls, maxOutputTokensPerCall: plan.study.selection.outputTokens,
            maxReservedOutputTokens: calls * plan.study.selection.outputTokens } });
        journal.write(`${phase(index)}_submitted.enc`, { request, at: new Date().toISOString() });
        const started = performance.now();
        let observation: Observation = { caseId: arm.caseId, arm: arm.arm, runId: null, status: "enqueue_unknown_or_refused",
          executionMs: 0, operationCount: null, inputTokens: null, outputTokens: null, unknown: true };
        try {
          const queued = await enqueueDurableRun(request);
          journal.write(`${phase(index)}_queued.enc`, { runId: queued.runId });
          const deadline = performance.now() + 12 * 60_000;
          let run = await findDurableRunById(queued.runId);
          while (run && ["queued", "running"].includes(run.status) && performance.now() < deadline) {
            await pause(2_000); run = await findDurableRunById(queued.runId);
          }
          const usage = await getRunProviderUsage(queued.runId);
          const rejected = await getPool().query("SELECT 1 FROM provider_operations po JOIN runs r ON r.id=po.run_id WHERE r.id=$1 AND r.owner_id=$2 AND po.error_code ~ '_(401|402|403|404|429)$' LIMIT 1", [queued.runId,getOwnerId()]);
          observation = { ...observation, runId: queued.runId, status: run?.status ?? "unavailable", operationCount: usage?.operationCount ?? null,
            inputTokens: usage && usage.inputReportCount === usage.operationCount ? usage.reportedInputTokens : null,
            outputTokens: usage && usage.outputReportCount === usage.operationCount ? usage.reportedOutputTokens : null,
            providerRejected: !!rejected.rowCount,
            policyMatched: !!run && !!usage && matchesFrozenStudyReviewPolicy(plan.reviewInstructions.filter(item=>item.round<=arm.reviewRounds),run.report?.reviewPromptPlans ?? [],usage.operations.filter(item=>item.round>0)),
            unknown: !run || ["queued", "running"].includes(run.status) || !!usage?.operations.some((item) => ["submitted", "outcome_unknown"].includes(item.status)) };
          await validate();
        } catch { observation.unknown = true; }
        observation.executionMs = Math.round(performance.now() - started);
        journal.write(`${phase(index)}_returned.enc`, observation); observations.push(observation);
        console.log(JSON.stringify({ arm: index + 1, status: observation.status, unknown: observation.unknown }));
        if (observation.unknown || observation.providerRejected || observation.policyMatched===false) halted = true;
      }
      };
      await Promise.all(Array.from({ length: plan.study.selection.maxConcurrentArms ?? 1 }, () => runNext().catch(() => { halted = true; })));
      observations.sort((a,b) => plan.study.arms.findIndex(arm => arm.caseId === a.caseId && arm.arm === a.arm) - plan.study.arms.findIndex(arm => arm.caseId === b.caseId && arm.arm === b.arm));
      const result = summary(observations, plan); journal.write("result.enc", result); console.log(JSON.stringify(result));
    }
  } else if (mode === "status" && args.length === 0) {
    console.log(JSON.stringify(journal.has("result.enc") ? journal.read("result.enc") : { status: journal.has("execution.enc") ? "submitted_or_unknown_no_resend" : journal.has("plan.enc") ? "prepared" : "missing" }));
  } else throw new Error("Invalid command");
}
try {
  // Historical terminal journals remain inspectable/replayable without permitting new root generation.
  if (mode === "status") await execute();
  else {
    let ownerId = "";
    let replayed = false;
    if (mode === "prepare" && args.length === 1) {
      const path = resolve(args[0]!);
      if (statSync(path).size > 200_000) throw new Error("Configuration file bound");
      ownerId = (JSON.parse(readFileSync(path, "utf8")) as { ownerId: string }).ownerId;
    } else {
      if (!name) throw new Error("Study identity required");
      const journal = new SynthesisFileJournal(resolve(root, ".local/study-execution"), name, async () => {});
      if (journal.has("result.enc")) { await execute(); replayed = true; }
      else ownerId = journal.read<Plan>("plan.enc").ownerId;
    }
    if (!replayed) await withStudyOwner(ownerId, execute);
  }
} catch { console.error("Deney tamamlanamadı. Canlı normal kullanıcı, incelenen plan ve değişmemiş kaynak/bağlantıları kontrol edin. Başlamış deney tekrar gönderilmez."); process.exitCode = 1; }
finally { await closeBoss(); await closeDatabase(); }
