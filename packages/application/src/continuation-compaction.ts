import { createHash } from "node:crypto";
import { continuationSourceContentSchema, continuationArchiveSchema, continuationCompactionPacketSchema, manualContinuationCompactionSchema, MAX_CONTINUATION_ARCHIVE_BYTES,
  type ContinuationCompactionPacket, type FrozenContinuation, type ManualContinuationCompaction, type RiskProfile } from "@deliberation-ai/contracts";
import { assessRequestRisk } from "@deliberation-ai/domain";
import { fingerprintContinuation, freezeContinuation, validateContinuation } from "./continuation";

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export function prepareContinuationCompaction(input: { sourceRunId: string; sourceRiskProfile: RiskProfile; content: string }): ContinuationCompactionPacket {
  if (bytes(input.content) > MAX_CONTINUATION_ARCHIVE_BYTES) throw new Error("Özgün geçmiş 2 MiB arşiv sınırını aşıyor; kısaltma hazırlanamadı.");
  const source = continuationSourceContentSchema.parse(JSON.parse(input.content));
  if (source.sourceRunId !== input.sourceRunId) throw new Error("Kaynak geçmiş eşleşmiyor.");
  const omitted = [
    { section: "report" as const, value: source.report },
    ...(source.continuationContext ? [{ section: "earlier-context" as const, value: source.continuationContext }] : []),
    ...(source.earlierCompactionArchive ? [{ section: "earlier-archive" as const, value: source.earlierCompactionArchive }] : []),
  ];
  return continuationCompactionPacketSchema.parse({
    version: "continuation-compaction-source-v1", sourceRunId: input.sourceRunId, sourceRiskProfile: input.sourceRiskProfile,
    sourceSha256: fingerprintContinuation({ version: "run-continuation-v1", ...input }),
    sourceQuestion: source.question, sourceStatus: source.status,
    sourcePromptVersion: source.promptVersion, sourcePromptFingerprint: source.promptFingerprint,
    originalContent: input.content, originalBytes: bytes(input.content),
    omissions: omitted.map(({ section, value }) => { const text = JSON.stringify(value); return { section, sha256: hash(text), bytes: bytes(text) }; }),
  });
}

export function buildCompactedContinuation(packet: ContinuationCompactionPacket, choice: ManualContinuationCompaction) {
  const selection = manualContinuationCompactionSchema.parse(choice);
  const risk = assessRequestRisk({ question: packet.sourceQuestion,
    continuationContext: { content: packet.originalContent, sourceRiskProfile: packet.sourceRiskProfile } });
  const context = freezeContinuation({ version: "run-continuation-v2", sourceRunId: packet.sourceRunId, sourceRiskProfile: risk.effectiveProfile, content: JSON.stringify({
    version: selection.version,
    source: { runId: packet.sourceRunId, sha256: packet.sourceSha256, question: packet.sourceQuestion,
      status: packet.sourceStatus, promptVersion: packet.sourcePromptVersion, promptFingerprint: packet.sourcePromptFingerprint },
    ownerSummary: selection.summary,
    omissions: packet.omissions,
    notice: "Kullanıcının elle yazıp incelediği geçmiş özetidir. Raporun tamamı (ham yanıtlar, azınlık görüşleri, incelemeler, başarısızlıklar ve kanıt etiketleri) ve varsa önceki bağlam/arşiv bu metinde tam olarak yer almaz. Özet doğruluk, eksiksizlik veya anlam eşdeğerliği onayı değildir. Atlanan özgün metin yerel şifreli arşivde korunur; modele gönderilmez. Kaynak soru ve geçmiş risk kontrolü korunmuştur.",
  }) });
  const archive = continuationArchiveSchema.parse({ version: "continuation-compaction-archive-v1", packet, selection, deliveredSha256: context.sha256 });
  return { context, archive };
}

export function validateContinuationArchive(value: unknown, delivered: FrozenContinuation | null) {
  const saved = continuationArchiveSchema.parse(value);
  const packet = prepareContinuationCompaction({ sourceRunId: saved.packet.sourceRunId, sourceRiskProfile: saved.packet.sourceRiskProfile, content: saved.packet.originalContent });
  if (JSON.stringify(packet) !== JSON.stringify(saved.packet)) throw new Error("Kaydedilen atlama dökümü doğrulanamadı.");
  const rebuilt = buildCompactedContinuation(packet, saved.selection);
  // A full-context descendant retains the archive privately and includes only
  // its ancestor's delivered summary. Never reinsert archived raw text.
  let covered = delivered;
  for (let depth = 0; covered && depth < 64 && covered.sha256 !== saved.deliveredSha256; depth += 1) {
    const parent = JSON.parse(covered.content) as { continuationContext?: unknown };
    covered = parent.continuationContext ? validateContinuation(parent.continuationContext) : null;
  }
  if (!covered || saved.deliveredSha256 !== rebuilt.context.sha256 || JSON.stringify(covered) !== JSON.stringify(rebuilt.context)) {
    throw new Error("Gönderilen özet ile özgün arşiv eşleşmiyor.");
  }
  return saved;
}
