import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHostedSynthesisPort, prepareSynthesis, runReviewedSynthesis, SYNTHESIS_DRAFT_INSTRUCTIONS, SYNTHESIS_REVIEW_INSTRUCTIONS,
  type PreparedSynthesis, type ReviewedSynthesisResult } from "@deliberation-ai/application";
import { SYNTHESIS_MAX_CALLS, SYNTHESIS_OUTPUT_TOKENS, SYNTHESIS_VERSION } from "@deliberation-ai/contracts";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { closeDatabase } from "../src/database";
import { loadProviderConnectionSecret } from "../src/provider-connections";
import { findDurableRunById } from "../src/run-repository";
import { SynthesisFileJournal } from "./synthesis-journal";

type Binding = { id: string; revision: number; identity: string };
type Plan = { version: typeof SYNTHESIS_VERSION; requestId: string; fingerprint: string;
  origin: { kind: "sample" } | { kind: "run"; runId: string }; prepared: PreparedSynthesis; generator: Binding; reviewer: Binding };
const root = resolve(import.meta.dirname, "../../../.local/reviewed-synthesis");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const hash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const [mode, name, ...args] = process.argv.slice(2);

function sample() {
  return prepareSynthesis("A örneğindeki vana durumu ve ölçüm belirsizliğini karşı görüşlerle birlikte özetle.", buildCouncilReport([
    { memberId: "sample-analyst", label: "Synthetic analyst", councilRole: "analyst", rawText: "Synthetic fixture only", citations: [],
      parsed: { summary: "Synthetic valve claims", claims: [
        { statement: "A örneğinde vana 10:00'da açıktır.", quote: "vana 10:00'da açıktır", kind: "recommendation" },
        { statement: "A örneğinde ölçüm kesinleşmemiştir.", quote: "ölçüm kesinleşmemiştir", kind: "risk" },
      ] } },
    { memberId: "sample-red", label: "Synthetic red team", councilRole: "red-team", rawText: "Synthetic fixture only", citations: [],
      parsed: { summary: "Synthetic opposing claim", claims: [
        { statement: "A örneğinde vana 10:00'da kapalıdır.", quote: "vana 10:00'da kapalıdır", kind: "objection" },
      ] } },
  ], []));
}
async function loadSource(origin: Plan["origin"]) {
  if (origin.kind === "sample") return sample();
  const run = await findDurableRunById(origin.runId);
  if (!run?.report || !["completed", "partially_completed"].includes(run.status)) throw new Error("Terminal owned report required");
  return prepareSynthesis(run.question, run.report);
}
async function loadTarget(id: string, requestId: string) {
  if (!uuid.test(id)) throw new Error("Invalid connection");
  const target = await loadProviderConnectionSecret(id);
  if (!target) throw new Error("Missing connection");
  const port = createHostedSynthesisPort(target, requestId);
  return { port, binding: { id: target.id, revision: target.revision, identity: port.identity } };
}
function summary(result: ReviewedSynthesisResult) {
  return { version: result.version, status: result.status, reason: result.reason, calls: result.attempts.length,
    repairs: result.attempts.filter((attempt) => attempt.stage === "repair").length,
    semanticValidation: result.semanticValidation, humanAcceptance: result.humanAcceptance,
    usage: result.attempts.map(({ stage, outcome }) => ({ stage, status: outcome.status,
      inputTokens: outcome.status === "returned" ? outcome.result.inputTokens : outcome.inputTokens,
      outputTokens: outcome.status === "returned" ? outcome.result.outputTokens : outcome.outputTokens })), invoiceCost: "unknown" };
}
try {
  if (!name) throw new Error("Study identity required");
  const journal = new SynthesisFileJournal(root, name, async () => {});
  if (mode === "prepare" || mode === "prepare-sample") {
    if (args.length !== (mode === "prepare" ? 3 : 2)) throw new Error("Invalid preparation");
    const origin: Plan["origin"] = mode === "prepare" ? { kind: "run", runId: args[0]! } : { kind: "sample" };
    if (origin.kind === "run" && !uuid.test(origin.runId)) throw new Error("Invalid run");
    const requestId = randomUUID();
    const offset = mode === "prepare" ? 1 : 0;
    const [prepared, generator, reviewer] = await Promise.all([loadSource(origin), loadTarget(args[offset]!, requestId), loadTarget(args[offset + 1]!, requestId)]);
    if (generator.port.identity === reviewer.port.identity) throw new Error("Distinct reviewer required");
    const fingerprint = hash({ version: SYNTHESIS_VERSION, origin, sourceFingerprint: prepared.fingerprint,
      generator: generator.binding, reviewer: reviewer.binding });
    journal.write("plan.enc", { version: SYNTHESIS_VERSION, requestId, fingerprint, origin, prepared, generator: generator.binding, reviewer: reviewer.binding } satisfies Plan);
    // Exact source and prompts are local review artifacts, never general logs.
    writeFileSync(resolve(journal.directory, "preview.md"), ["# Sentez gönderim incelemesi", `Fingerprint: ${fingerprint}`,
      `Kaynak: ${origin.kind}; iddia: ${prepared.source.claims.length}; uygun: ${prepared.eligible}.`,
      `En fazla ${SYNTHESIS_MAX_CALLS} çağrı; çağrı başına ${SYNTHESIS_OUTPUT_TOKENS} istenen çıktı tokenı. Fatura maliyeti bilinmiyor.`,
      "Aşağıdaki iddialar iki seçilmiş bağlantıya gönderilir. Kaynak belgeleri, üye ham yanıtları ve sağlayıcı anahtarları gönderilmez.",
      "```json", JSON.stringify(prepared.source, null, 2), "```",
      "## Taslak sistem istemi", SYNTHESIS_DRAFT_INSTRUCTIONS,
      "## Kontrol sistem istemi", SYNTHESIS_REVIEW_INSTRUCTIONS,
      "## Mevcut iddia defteri", prepared.fallback,
    ].join("\n\n"), { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify({ status: "prepared", fingerprint, source: origin.kind, eligible: prepared.eligible,
      claimCount: prepared.source.claims.length, maxCalls: SYNTHESIS_MAX_CALLS, requestedOutputTokensPerCall: SYNTHESIS_OUTPUT_TOKENS }));
  } else if (mode === "run") {
    if (args.length !== 2 || args[0] !== "--live" || !/^[a-f0-9]{64}$/u.test(args[1]!)) throw new Error("Explicit live sharing confirmation required");
    const plan = journal.read<Plan>("plan.enc");
    if (plan.version !== SYNTHESIS_VERSION || args[1] !== plan.fingerprint) throw new Error("Changed approval");
    if (journal.has("result.enc")) { console.log(JSON.stringify(summary(journal.read<ReviewedSynthesisResult>("result.enc")))); }
    else {
      if (journal.has("execution.enc") || journal.has("draft_submitted.enc")) throw new Error("Prior submission cannot be resent");
      const validate = async () => {
        const [source, generator, reviewer] = await Promise.all([loadSource(plan.origin), loadTarget(plan.generator.id, plan.requestId), loadTarget(plan.reviewer.id, plan.requestId)]);
        if (source.fingerprint !== plan.prepared.fingerprint || JSON.stringify(generator.binding) !== JSON.stringify(plan.generator) ||
          JSON.stringify(reviewer.binding) !== JSON.stringify(plan.reviewer) || hash({ version: SYNTHESIS_VERSION, origin: plan.origin,
            sourceFingerprint: source.fingerprint, generator: generator.binding, reviewer: reviewer.binding }) !== plan.fingerprint) throw new Error("Source or connection changed");
        return { generator: generator.port, reviewer: reviewer.port };
      };
      const ports = await validate();
      // Permanent atomic ownership prevents overlapping callers from finalizing each other's intent.
      journal.write("execution.enc", { requestId: plan.requestId, fingerprint: plan.fingerprint, at: new Date().toISOString() });
      const guardedJournal = new SynthesisFileJournal(root, name, async () => { await validate(); });
      const result = await runReviewedSynthesis(plan.prepared, ports.generator, ports.reviewer, guardedJournal);
      journal.write("result.enc", result);
      console.log(JSON.stringify(summary(result)));
    }
  } else if (mode === "status" && args.length === 0) {
    if (journal.has("result.enc")) console.log(JSON.stringify(summary(journal.read<ReviewedSynthesisResult>("result.enc"))));
    else console.log(JSON.stringify({ status: journal.has("execution.enc") || journal.has("draft_submitted.enc") ? "submitted_or_unknown_no_resend" : journal.has("plan.enc") ? "prepared" : "missing", humanAcceptance: "not_assessed" }));
  } else if (mode === "export" && args.length === 0) {
    const result = journal.read<ReviewedSynthesisResult>("result.enc");
    writeFileSync(resolve(journal.directory, "result.md"), [result.renderedCandidate ?? "# Sentez taslağı kabul edilmedi", `Durum: ${result.status}; neden: ${result.reason}.`, result.fallback].join("\n\n"), { encoding: "utf8", flag: "wx" });
    console.log("Yerel Markdown çıktısı hazır; açık metin kopyadır ve mevcut dosya üzerine yazılmaz.");
  } else throw new Error("Invalid command");
} catch {
  console.error("Sentez işlemi tamamlanamadı. Komutu, bağımsız bağlantıları, incelenen fingerprint ve mevcut kayıtları kontrol edin. Önceden gönderilen işlem otomatik tekrar edilmez.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
