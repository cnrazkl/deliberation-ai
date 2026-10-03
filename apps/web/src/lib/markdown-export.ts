import type { CouncilReport, ClaimGroup } from "@deliberation-ai/domain";
import type { exportConversation } from "@deliberation-ai/persistence";
import type { createRunExport } from "./run-export";

type RunExport = ReturnType<typeof createRunExport>;
type ConversationExport = NonNullable<Awaited<ReturnType<typeof exportConversation>>>;
const MAX_MARKDOWN_BYTES = 32 * 1024 * 1024;
export class MarkdownExportSizeError extends Error {}

// Treat saved model/user text as data, including embedded fences and HTML.
export function markdownBlock(text: string, language = "text"): string {
  let length = 3;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  return `${fence}${language}\n${text}\n${fence}\n`;
}
const json = (value: unknown) => markdownBlock(JSON.stringify(value, null, 2), "json");
const literal = (value: string) => value.replace(/[\\`*_{}[\]()#+.!|<>~]/g, "\\$&").replace(/\r?\n/g, " ");
function bounded(parts: string[]): string {
  const result = parts.join("\n");
  if (Buffer.byteLength(result, "utf8") > MAX_MARKDOWN_BYTES) throw new MarkdownExportSizeError();
  return result;
}
function claims(report: CouncilReport): Array<{ claim: ClaimGroup; source: string }> {
  return [
    ...report.sharedClaims.map((claim) => ({ claim, source: "Ortak zemin" })),
    ...report.distinctClaims.map((claim) => ({ claim, source: "Farklı görüş" })),
    ...report.redTeamChallenges.map((claim) => ({ claim, source: "Red-team" })),
  ];
}
function synthesis(report: CouncilReport): string[] {
  const parts = ["## Sentez kapsamı", "Bu kayıt bir doğruluk kararı veya yeni bir model sentezi değildir. Azınlık ve dışarıda bırakılan görüşler korunur.", markdownBlock(report.qualityNotice)];
  for (const [coverage, label] of [["included", "Dahil"], ["unresolved", "Çözülmemiş"], ["omitted", "Dışarıda"]] as const) {
    parts.push(`### ${label}`);
    const entries = claims(report).filter(({ claim }) => (claim.synthesisCoverage ?? "unresolved") === coverage);
    if (!entries.length) parts.push("Bu grupta iddia yok.");
    for (const { claim, source } of entries) {
      parts.push(`#### ${literal(claim.claimId)} · ${source}`, markdownBlock(claim.statement),
        `Kanıt durumu: ${literal(claim.evidenceState)} · Sunum: ${literal(claim.disposition)}`);
      if (claim.scopeNote) parts.push("Kapsam notu:", markdownBlock(claim.scopeNote));
      for (const occurrence of claim.occurrences) parts.push(
        `Kaynak: ${literal(occurrence.memberLabel)} (${literal(occurrence.memberId)}) · ${literal(occurrence.councilRole)} · ${literal(occurrence.kind)} · ${literal(occurrence.occurrenceId)}`,
        "Kaynak ifadesi:", markdownBlock(occurrence.statement), "Alıntı:", markdownBlock(occurrence.quote));
    }
  }
  parts.push("### İddia ilişkileri ve kalite kayıtları", json({ claimRelations: report.claimRelations ?? [],
    claimCoverage: report.claimCoverage ?? null, reportQuality: report.reportQuality ?? null, riskControls: report.riskControls ?? null }));
  return parts;
}
function reportHistory(report: CouncilReport): string[] {
  const parts = synthesis(report);
  parts.push("## Bağımsız ilk tur yanıtları");
  for (const member of report.memberResults) parts.push(
    `### ${literal(member.label)} · ${literal(member.memberId)} · ${literal(member.councilRole)}`,
    member.reusedFromRunId ? `Kopyalanan kaynak çalışma: ${literal(member.reusedFromRunId)}` : "Bu çalışmanın ilk tur yanıtı.",
    "Ham yanıt:", markdownBlock(member.rawText), "Yapılandırılmış yanıt ve kaynaklar:", json({ parsed: member.parsed, citations: member.citations, agreementSource: member.agreementSource ?? null }));
  parts.push("## Çapraz incelemeler");
  for (const review of report.reviews) parts.push(`### Tur ${review.round} · ${literal(review.reviewerLabel)} · ${literal(review.reviewerMemberId)}`,
    markdownBlock(review.rawText), json({ parsed: review.parsed, citations: review.citations, councilRole: review.reviewerCouncilRole }));
  parts.push("## Başarısız girişimler ve inceleme girdileri", json({ failures: report.failures, reviewFailures: report.reviewFailures,
    reviewPromptPlans: report.reviewPromptPlans ?? [], reviewExecution: report.reviewExecution ?? null }));
  return parts;
}
export function createSynthesisMarkdown(run: RunExport): string {
  return bounded(["# DeliberationAI sentez kapsamı", `Çalışma: ${run.runId}`, `Durum: ${literal(run.status)} · Oluşturulma: ${run.createdAt} · Dışa aktarım: ${run.exportedAt}`,
    "## Soru", markdownBlock(run.question), ...synthesis(run.report), "## İstem ve risk kaynağı",
    json({ promptVersion: run.promptVersion, promptFingerprint: run.promptFingerprint, riskProfile: run.riskProfile, riskAssessment: run.riskAssessment })]);
}
export function createConversationMarkdown(value: ConversationExport): string {
  const parts = ["# DeliberationAI konuşma geçmişi", `Konuşma: ${value.conversation.conversationId}`, `Dışa aktarım: ${value.exportedAt}`,
    "Dosya şifresizdir; kayıtlı soru ve ham yanıtlar içerir. Devam eden çalışmaların anlık durumu alınır.",
    "## Kapsam ve konuşma kaynağı", markdownBlock(value.scope), json(value.conversation)];
  for (const item of value.runs) {
    parts.push(`---\n\n# Çalışma ${item.runId}`);
    if (!item.payload) { parts.push("İçerik erişilemiyor; konuşma üyeliği korunuyor."); continue; }
    const { report, question, ...metadata } = item.payload;
    parts.push(`Durum: ${literal(item.payload.status)}`, "## Soru", markdownBlock(question), "## Çalışma kaynağı ve saklanan geçmiş", json(metadata));
    if (report) parts.push(...reportHistory(report));
    else parts.push("Rapor henüz mevcut değil.");
  }
  parts.push("---\n\n# Özel dal konuşmaları");
  for (const branch of value.privateBranches ?? []) {
    parts.push(`## Özel dal ${branch.id}`, "### Kaynak soru", markdownBlock(branch.body.seed.question),
      `### Seçilen üyenin yanıtı · ${literal(branch.body.seed.member.label)}`, markdownBlock(branch.body.seed.rawText));
    for (const message of branch.body.messages) {
      parts.push(`### Kayıtlı kullanıcı mesajı ${message.id}`, markdownBlock(message.text));
      for (const delivery of branch.body.deliveries ?? []) if (delivery.messageId === message.id) {
        parts.push(`Gönderim durumu: ${literal(delivery.status)}`);
        if (delivery.result) parts.push("### Özel model yanıtı", markdownBlock(delivery.result.text));
      }
    }
    parts.push("### Dal kaynağı ve gönderim kayıtları", json(branch));
  }
  parts.push("# İçeriksiz silme kayıtları", json({ privateBranchDeletions: value.privateBranchDeletions, runDeletions: value.runDeletions }));
  return bounded(parts);
}
