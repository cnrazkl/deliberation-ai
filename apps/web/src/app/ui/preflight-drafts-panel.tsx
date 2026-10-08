"use client";

import { ownerFetch } from "../../lib/session-fetch";
import { useCallback, useEffect, useState } from "react";
import type { RunRecord } from "@deliberation-ai/application";
import { auditPromptRevision, composeClarifiedQuestion, PROMPT_REVISION_VERSION, suggestStructuredQuestion } from "@deliberation-ai/domain";
import type { TokenPreview } from "../../lib/token-preview";
import { RiskAssessmentSummary } from "./risk-assessment-summary";
import { PromptRevisionEditor } from "./prompt-revision-editor";
import { PreflightDraftDeletionPanel } from "./preflight-draft-deletion-panel";

type Draft = {
  id: string;
  question: string;
  questions: Array<{ id: string; question: string; reason: string }>;
  status: "awaiting_input" | "started" | "cancelled";
  createdAt: string;
};
type Prepared = { question: string; preview: TokenPreview; imageDimensionsEstimated: boolean };

function clarificationBase(question: string, choice: "answer" | "original", answer: string): string {
  if (choice === "original" || !answer.trim()) return question;
  try { return composeClarifiedQuestion(question, "answer", answer); } catch { return ""; }
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "İşlem tamamlanamadı.");
  return body;
}

export function PreflightDraftsPanel({ refreshKey, focusDraftId, onStarted }: { refreshKey: number; focusDraftId?: string | undefined; onStarted: (run: RunRecord) => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [choice, setChoice] = useState<"answer" | "original">("answer");
  const [answer, setAnswer] = useState("");
  const [promptCandidate, setPromptCandidate] = useState("");
  const [promptChoice, setPromptChoice] = useState<"original" | "candidate">("original");
  const [prepared, setPrepared] = useState<Prepared>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [deletionId, setDeletionId] = useState<string>();
  const handleDeleted = useCallback(() => {
    setDrafts((current) => current.filter((draft) => draft.id !== deletionId));
    setSelectedId(undefined); setDeletionId(undefined); setPrepared(undefined);
    setAnswer(""); setPromptCandidate(""); setPromptChoice("original"); setError(undefined);
  }, [deletionId]);
  const selected = drafts.find((draft) => draft.id === selectedId);
  const baseQuestion = selected ? clarificationBase(selected.question, choice, answer) : "";
  const promptRevision = { version: PROMPT_REVISION_VERSION as typeof PROMPT_REVISION_VERSION, originalQuestion: baseQuestion,
    candidateQuestion: promptCandidate.trim() || baseQuestion, choice: promptChoice };
  const revisionAudit = auditPromptRevision(promptRevision);

  useEffect(() => {
    let live = true;
    void ownerFetch("/api/preflight-drafts", { cache: "no-store" })
      .then((response) => responseBody<{ drafts: Draft[] }>(response))
      .then((body) => { if (live) {
        setDrafts(body.drafts);
        const focused = body.drafts.find((draft) => draft.id === focusDraftId);
        if (focused) { setSelectedId(focused.id); setPromptCandidate(suggestStructuredQuestion(focused.question)); setPromptChoice("original"); }
      } })
      .catch(() => { if (live) setError("Bekleyen sorular yüklenemedi."); });
    return () => { live = false; };
  }, [refreshKey, focusDraftId]);

  function select(id: string) {
    setSelectedId(id);
    setChoice("answer");
    setAnswer("");
    const draft = drafts.find((item) => item.id === id);
    setPromptCandidate(suggestStructuredQuestion(draft?.question ?? ""));
    setPromptChoice("original");
    setPrepared(undefined);
    setError(undefined);
  }

  async function preview() {
    if (!selected || !baseQuestion || (promptChoice === "candidate" && !revisionAudit.canSelectCandidate)) return;
    setBusy(true);
    setError(undefined);
    setPrepared(undefined);
    try {
      const response = await ownerFetch(`/api/preflight-drafts/${encodeURIComponent(selected.id)}/preview`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice, ...(choice === "answer" ? { answer } : {}), promptRevision }),
      });
      setPrepared(await responseBody<Prepared>(response));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Önizleme hazırlanamadı.");
    } finally { setBusy(false); }
  }

  async function start() {
    if (!selected || !prepared?.preview.promptPlan || !prepared.preview.riskPreflight) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await ownerFetch(`/api/preflight-drafts/${encodeURIComponent(selected.id)}/start`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice, ...(choice === "answer" ? { answer } : {}),
          promptRevision,
          expectedPromptFingerprint: prepared.preview.promptPlan.fingerprint,
          expectedRiskFingerprint: prepared.preview.riskPreflight.fingerprint }),
      });
      const run = await responseBody<RunRecord>(response);
      setDrafts((current) => current.filter((draft) => draft.id !== selected.id));
      setSelectedId(undefined);
      setPrepared(undefined);
      onStarted(run);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Çalışma başlatılamadı.");
      setPrepared(undefined);
    } finally { setBusy(false); }
  }

  if (drafts.length === 0 && !error) return null;
  return <section className="question-card" aria-label="Yanıt bekleyen ön değerlendirmeler">
    <h2>Yanıt bekleyen sorular</h2>
    <p className="hint">Bu görevler henüz modellere gönderilmedi. Açıklama ekleyebilir veya orijinal soruyla devam etmeyi açıkça seçebilirsiniz.</p>
    {drafts.map((draft) => <button key={draft.id} type="button" className="secondary-button" disabled={busy || Boolean(deletionId)} onClick={() => select(draft.id)}>
      {draft.question.slice(0, 130)}{draft.question.length > 130 ? "…" : ""} · {new Date(draft.createdAt).toLocaleString("tr-TR")} · {draft.id.slice(0, 8)}
    </button>)}
    {selected && !deletionId ? <div className="result-stack">
      <h3>Eksik olabilecek bilgiler</h3>
      <ul>{selected.questions.map((item) => <li key={item.id}><strong>{item.question}</strong> <span className="hint">{item.reason}</span></li>)}</ul>
      <p className="hint">Bu yerel kontrol yalnızca bazı belirgin eksikleri yakalar; yanıtların doğruluğunu denetlemez.</p>
      <label className="check-row"><input type="radio" checked={choice === "answer"} onChange={() => { setChoice("answer"); setPromptChoice("original"); setPromptCandidate(suggestStructuredQuestion(clarificationBase(selected.question, "answer", answer))); setPrepared(undefined); }} /> Açıklama ekle</label>
      {choice === "answer" ? <textarea aria-label="Eksik bilgilere yanıt" value={answer} maxLength={1500} onChange={(event) => { setAnswer(event.target.value); setPromptChoice("original"); setPromptCandidate(suggestStructuredQuestion(clarificationBase(selected.question, "answer", event.target.value))); setPrepared(undefined); }} /> : null}
      {!baseQuestion ? <p className="inline-warning">Soru ve açıklama birlikte 4000 karakteri aşamaz.</p> : null}
      <label className="check-row"><input type="radio" checked={choice === "original"} onChange={() => { setChoice("original"); setPromptChoice("original"); setPromptCandidate(suggestStructuredQuestion(selected.question)); setPrepared(undefined); }} /> Orijinal soruyla devam et</label>
      {baseQuestion.length >= 10 ? <PromptRevisionEditor originalQuestion={baseQuestion} candidateQuestion={promptCandidate}
        choice={promptChoice} onCandidateChange={(value) => { setPromptCandidate(value); setPrepared(undefined); }}
        onChoiceChange={(value) => { setPromptChoice(value); setPrepared(undefined); }} /> : null}
      <div className="form-row">
        <button type="button" disabled={busy || !baseQuestion || (choice === "answer" && !answer.trim()) || (promptChoice === "candidate" && !revisionAudit.canSelectCandidate)} onClick={() => void preview()}>Yanıt ve istem önizlemesini göster</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setDeletionId(selected.id)}>Taslak silmeyi incele</button>
      </div>
      {prepared ? <div className="token-preview">
        <h3>Gönderilecek soru ve ilk tur</h3>
        <pre>{prepared.question}</pre>
        <p>İlk tur tahmini: ≈{prepared.preview.totalTokens.toLocaleString("tr-TR")} giriş tokenı</p>
        {prepared.imageDimensionsEstimated ? <p className="hint">Bazı görsellerin boyut bilgisi bulunamadı; görsel token tahmini varsayılan boyutla hesaplandı.</p> : null}
        {prepared.preview.riskPreflight ? <RiskAssessmentSummary assessment={prepared.preview.riskPreflight.assessment} /> : null}
        {prepared.preview.promptPlan ? <details><summary>Üyelere gönderilecek metinleri incele</summary>
          {prepared.preview.promptPlan.members.map((member) => <article key={member.id}><h4>{member.label}</h4><pre>{member.instructions}</pre><pre>{member.userInput}</pre></article>)}
        </details> : null}
        <button type="button" disabled={busy || !prepared.preview.promptPlan || !prepared.preview.riskPreflight} onClick={() => void start()}>Bu önizlemeyle konseyi çalıştır</button>
      </div> : null}
    </div> : null}
    {deletionId && <PreflightDraftDeletionPanel key={deletionId} draftId={deletionId} onBusy={setBusy}
      onCancel={() => setDeletionId(undefined)} onDeleted={handleDeleted} />}
    {error ? <div className="alert error" role="alert">{error}</div> : null}
  </section>;
}
