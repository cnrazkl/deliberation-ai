import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHostedSynthesisPort, createHostedContradictionEvaluator, HOSTED_CONTRADICTION_VERSION, HOSTED_CONTRADICTION_SUFFIX } from "@deliberation-ai/application";
import { CONTRADICTION_INSTRUCTIONS, planContradictionReview, runContradictionReview, type ContradictionReviewPlan, type ContradictionReviewResult } from "@deliberation-ai/evaluation";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { SYNTHESIS_OUTPUT_TOKENS } from "@deliberation-ai/contracts";
import { closeDatabase } from "../src/database";
import { loadProviderConnectionSecret } from "../src/provider-connections";
import { findDurableRunById } from "../src/run-repository";
import { SynthesisFileJournal } from "./synthesis-journal";

const root = resolve(import.meta.dirname, "../../../.local/contradiction-hosted");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
type Origin = { kind: "sample" } | { kind: "run"; runId: string };
type Plan = { version: typeof HOSTED_CONTRADICTION_VERSION; origin: Origin; requestId: string; fingerprint: string;
  review: ContradictionReviewPlan; binding: { id: string; revision: number; identity: string } };
const [mode, name, ...args] = process.argv.slice(2);
async function source(origin: Origin) {
  const report = origin.kind === "run" ? (await findDurableRunById(origin.runId))?.report : buildCouncilReport([
    { memberId: "synthetic-a", label: "Synthetic", councilRole: "analyst", rawText: "Synthetic", citations: [],
      parsed: { summary: "Synthetic", claims: [{ statement: "A örneğinde vana 10:00'da açıktır.", quote: "vana 10:00'da açıktır", kind: "recommendation" }] } },
    { memberId: "synthetic-r", label: "Synthetic", councilRole: "red-team", rawText: "Synthetic", citations: [],
      parsed: { summary: "Synthetic", claims: [{ statement: "A örneğinde vana 10:00'da kapalıdır.", quote: "vana 10:00'da kapalıdır", kind: "objection" }] } },
  ], []);
  if (!report || !["completed", "partially_completed"].includes(report.status)) throw new Error("Terminal owned report required");
  const review = planContradictionReview(report, { maxPairs: 12, sourceSetSha256: hash("Textual comparison only; no external truth evidence"), evaluatorVersion: HOSTED_CONTRADICTION_VERSION });
  if (JSON.stringify({ fingerprint: review.fingerprint, pairs: review.pairs }).length > 12_000) throw new Error("Source exceeds bound");
  return review;
}
async function target(id: string, requestId: string) {
  if (!uuid.test(id)) throw new Error("Invalid connection");
  const connection = await loadProviderConnectionSecret(id);
  if (!connection) throw new Error("Unavailable connection");
  const port = createHostedSynthesisPort(connection, requestId);
  return { port, binding: { id, revision: connection.revision, identity: port.identity } };
}
function fingerprint(origin: Origin, review: ContradictionReviewPlan, binding: Plan["binding"]) {
  return hash({ version: HOSTED_CONTRADICTION_VERSION, origin, review, binding,
    instructions: `${CONTRADICTION_INSTRUCTIONS} ${HOSTED_CONTRADICTION_SUFFIX}`, maxCalls: 1, outputTokens: SYNTHESIS_OUTPUT_TOKENS });
}
function summary(result: ContradictionReviewResult) {
  return { version: result.evaluatorVersion, mode: result.mode, assessed: result.outcomes.filter((item) => item.status === "assessed").length,
    notAssessed: result.outcomes.filter((item) => item.status === "not_assessed").length, humanAcceptance: "not_assessed", automaticSuggestionsEnabled: false, invoiceCost: "unknown" };
}
try {
  if (!name) throw new Error("Identity required");
  const journal = new SynthesisFileJournal(root, name, async () => {});
  if (mode === "prepare" || mode === "prepare-sample") {
    if (args.length !== (mode === "prepare" ? 2 : 1)) throw new Error("Invalid preparation");
    const origin: Origin = mode === "prepare" ? { kind: "run", runId: args[0]! } : { kind: "sample" };
    if (origin.kind === "run" && !uuid.test(origin.runId)) throw new Error("Invalid run");
    const requestId = randomUUID();
    const [review, connection] = await Promise.all([source(origin), target(args.at(-1)!, requestId)]);
    const digest = fingerprint(origin, review, connection.binding);
    journal.write("plan.enc", { version: HOSTED_CONTRADICTION_VERSION, origin, requestId, fingerprint: digest, review, binding: connection.binding } satisfies Plan);
    writeFileSync(resolve(journal.directory, "preview.md"), ["# Çelişki gölge incelemesi", `Fingerprint: ${digest}`,
      "Tek çağrı, 4096 istenen çıktı tokenı; fatura maliyeti bilinmiyor. İnsan etiketi veya doğruluk onayı değildir.",
      `${CONTRADICTION_INSTRUCTIONS} ${HOSTED_CONTRADICTION_SUFFIX}`, JSON.stringify({ fingerprint: review.fingerprint, pairs: review.pairs }, null, 2)].join("\n\n"), { flag: "wx" });
    console.log(JSON.stringify({ status: "prepared", fingerprint: digest, selectedPairs: review.pairs.length, totalPairs: review.allPairIds.length, maxCalls: 1 }));
  } else if (mode === "run") {
    if (args.length !== 2 || args[0] !== "--live") throw new Error("Reviewed live intent required");
    const plan = journal.read<Plan>("plan.enc");
    if (plan.version !== HOSTED_CONTRADICTION_VERSION || args[1] !== plan.fingerprint) throw new Error("Changed approval");
    if (journal.has("result.enc")) console.log(JSON.stringify(summary(journal.read<ContradictionReviewResult>("result.enc"))));
    else {
      if (journal.has("execution.enc")) throw new Error("Prior execution cannot be resent");
      const validate = async () => {
        const [review, connection] = await Promise.all([source(plan.origin), target(plan.binding.id, plan.requestId)]);
        if (fingerprint(plan.origin, review, connection.binding) !== plan.fingerprint) throw new Error("Changed source or connection");
        return connection.port;
      };
      const port = await validate();
      journal.write("execution.enc", { requestId: plan.requestId, fingerprint: plan.fingerprint, at: new Date().toISOString() });
      const guard = new SynthesisFileJournal(root, name, async () => { await validate(); });
      const result = await runContradictionReview(plan.review, createHostedContradictionEvaluator(port, guard));
      journal.write("result.enc", result);
      console.log(JSON.stringify(summary(result)));
    }
  } else if (mode === "status" && args.length === 0) {
    console.log(JSON.stringify(journal.has("result.enc") ? summary(journal.read<ContradictionReviewResult>("result.enc")) :
      { status: journal.has("execution.enc") ? "submitted_or_unknown_no_resend" : journal.has("plan.enc") ? "prepared" : "missing" }));
  } else throw new Error("Invalid command");
} catch { console.error("Çelişki incelemesi tamamlanamadı. Komutu, incelenen fingerprint ve değişmemiş kaynak/bağlantıyı kontrol edin; gönderilen işlem tekrar edilmez."); process.exitCode = 1; }
finally { await closeDatabase(); }
