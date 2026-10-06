"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RunRecord } from "@deliberation-ai/application";
import type { EvidenceCandidateProvenance, EvidenceFreshnessStatus, EvidenceRelation, EvidenceReviewStatus } from "@deliberation-ai/contracts";

type Candidate = { id: string; claimId: string; title: string; url: string; excerpt: string | null;
  relation: EvidenceRelation; reviewStatus: EvidenceReviewStatus; freshnessStatus: EvidenceFreshnessStatus;
  publishedAt: string | null; capturedAt: string; candidateProvenance: EvidenceCandidateProvenance;
  availability: "not-checked" | "same-version" | "changed" | "inaccessible" };
const reviewLabels: Record<EvidenceReviewStatus, string> = { unreviewed: "İncelenmedi", verified: "İnsan tarafından incelendi", rejected: "Reddedildi" };
const freshnessLabels: Record<EvidenceFreshnessStatus, string> = { unreviewed: "İncelenmedi", current: "Güncel", "needs-review": "Yeniden incelenmeli", stale: "Eskimiş", changed: "Kaynak değişmiş", inaccessible: "Kaynağa erişilemiyor" };
const relationLabels: Record<EvidenceRelation, string> = { supports: "Destekliyor", contradicts: "Çelişiyor", context: "Bağlam" };
const availabilityLabels = { "not-checked": "Canlı kaynak kontrolü yapılmadı", "same-version": "Yerel sürüm aynı; doğruluk değerlendirmesi değildir", changed: "Yerel sürüm değişmiş", inaccessible: "Yerel kaynak izni veya erişimi geçersiz" };

export function EvidenceCandidatePanel({ run, onSourcesChanged }: { run: RunRecord; onSourcesChanged: () => void }) {
  const claims = [...(run.report?.sharedClaims ?? []), ...(run.report?.distinctClaims ?? []), ...(run.report?.redTeamChallenges ?? [])];
  const [claimId, setClaimId] = useState(claims[0]?.claimId ?? "");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [title, setTitle] = useState(""); const [url, setUrl] = useState(""); const [excerpt, setExcerpt] = useState("");
  const [publishedAt, setPublishedAt] = useState(""); const [relatedSourceId, setRelatedSourceId] = useState("");
  const [relation, setRelation] = useState<EvidenceRelation>("context");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const [retry, setRetry] = useState<{ body: string; id: string }>();
  const alive = useRef(true);
  async function refresh() {
    const response = await fetch(`/api/evidence-candidates?runId=${run.runId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Aday kutusu yüklenemedi.");
    setCandidates((await response.json() as { candidates: Candidate[] }).candidates);
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void fetch(`/api/evidence-candidates?runId=${run.runId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ candidates: Candidate[] }>; })
      .then((body) => setCandidates(body.candidates)).catch(() => { if (!controller.signal.aborted) setError("Aday kutusu yüklenemedi."); });
    return () => { alive.current = false; controller.abort(); };
  }, [run.runId]);
  async function send(path: string, body: object, method = "POST") {
    setBusy(true); setError(undefined);
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const value = await response.json().catch(() => null) as { error?: string } | null; throw new Error(value?.error ?? "Aday işlemi tamamlanamadı."); }
      if (!alive.current) return false;
      await refresh(); if (alive.current) onSourcesChanged(); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Aday işlemi tamamlanamadı."); return false; }
    finally { setBusy(false); }
  }
  async function exportCandidates() {
    setBusy(true); setError(undefined);
    try {
      const response = await fetch(`/api/evidence-candidates?runId=${run.runId}&download=1`, { cache: "no-store" });
      if (!response.ok) throw new Error("Adaylar indirilemedi.");
      const link = document.createElement("a"), objectUrl = URL.createObjectURL(await response.blob());
      link.href = objectUrl; link.download = `deliberationai-candidates-${run.runId}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch { setError("Adaylar indirilemedi."); } finally { setBusy(false); }
  }
  async function capture(fields: object) {
    const value = { runId: run.runId, claimId, relation, ...(relatedSourceId ? { relatedSourceId } : {}), ...fields };
    const body = JSON.stringify(value); const id = retry?.body === body ? retry.id : crypto.randomUUID();
    setRetry({ body, id });
    if (await send("/api/evidence-candidates", { ...value, requestId: id })) setRetry(undefined);
  }
  async function submitOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); await capture({ origin: "owner", title, url, excerpt, ...(publishedAt ? { publishedAt } : {}), note: "" });
  }
  const selected = claims.find((claim) => claim.claimId === claimId);
  const visible = candidates.filter((candidate) => candidate.claimId === claimId);
  return <section className="evidence-source-section evidence-candidate-section" aria-label="Kaynak aday kutusu">
    <div className="synthesis-heading"><div><span>KAYNAK ADAY KUTUSU</span><strong>{candidates.length} aday</strong></div>
      <small>İçerik ve güncellik ayrı insan kararlarıdır. Aday eklemek veya incelemek iddianın kanıt durumunu değiştirmez. Bağlantılar kendiliğinden ziyaret edilmez.</small>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(undefined); void refresh().catch(() => setError("Aday kutusu yüklenemedi.")); }}>Adayları yenile</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void exportCandidates()}>Adayları indir (JSON)</button>
    </div>
    <fieldset disabled={busy}>
      <div className="candidate-controls">
      <label>Adayın iddiası<select value={claimId} onChange={(event) => { setClaimId(event.target.value); setRelatedSourceId(""); }}>{claims.map((claim) => <option key={claim.claimId} value={claim.claimId}>{claim.statement}</option>)}</select></label>
      <label>Aday ilişkisi<select value={relation} onChange={(event) => setRelation(event.target.value as EvidenceRelation)}>{Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Önceki aday / değişen kaynak<select value={relatedSourceId} onChange={(event) => setRelatedSourceId(event.target.value)}><option value="">Bağımsız gönderi</option>{visible.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title} · {candidate.id}</option>)}</select></label>
      </div>
      <form className="evidence-source-form" onSubmit={submitOwner}>
        <label>Aday başlığı<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Aday kaynak adresi<input type="url" required maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)} /></label>
        <label>Aday yayın tarihi<input type="date" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /></label>
        <label className="evidence-excerpt-field">Adayın özgün pasajı<textarea required rows={4} maxLength={4000} value={excerpt} onChange={(event) => setExcerpt(event.target.value)} /></label>
        <button type="submit" disabled={!selected}>Gönderiyi aday kutusuna ekle</button>
      </form>
      <div className="research-capture-list">{run.report?.memberResults.filter((member) => selected?.occurrences.some((occurrence) => occurrence.memberId === member.memberId)).map((member) => member.citations.map((citation, index) =>
        <button key={`${member.memberId}:${index}`} type="button" className="secondary-button" onClick={() => void capture({ origin: "model-citation", memberId: member.memberId, citationIndex: index })}>{member.label} atfını ekle: {citation.title ?? citation.url}</button>))}
        {run.knowledgePacket?.excerpts.map((quote) => <button key={quote.excerptId} type="button" className="secondary-button" disabled={!selected} onClick={() => void capture({ origin: "local-excerpt", excerptId: quote.excerptId })}>Yerel alıntıyı aday yap: {quote.source.title} · {quote.page ?? "metin"}</button>)}
      </div>
      <div className="evidence-source-list">{visible.map((candidate) => <article key={candidate.id} className="evidence-source candidate-card">
        <strong>{candidate.title} · {relationLabels[candidate.relation]}</strong>
        {/^https?:\/\//i.test(candidate.url) ? <a href={candidate.url} target="_blank" rel="noreferrer">{candidate.url}</a> : <code>{candidate.url}</code>}
        <p>İddia: {candidate.candidateProvenance.statement}</p>
        <small>Gönderi: {new Date(candidate.capturedAt).toLocaleString("tr-TR")} · Yayın: {candidate.publishedAt ?? "bilinmiyor"} · {availabilityLabels[candidate.availability]}</small>
        <blockquote>{candidate.excerpt ?? "Özgün kaynak pasajı yok; model atfı doğrulanmış kaynak sayılmaz."}</blockquote>
        {candidate.candidateProvenance.model ? <details><summary>Modelin özgün pasajı ve atıf kaydı</summary><pre>{JSON.stringify(candidate.candidateProvenance.model, null, 2)}</pre></details> : null}
        {candidate.candidateProvenance.localExcerpt ? <details><summary>Dosya, sürüm, sayfa ve alıntı konumu</summary><pre>{JSON.stringify(candidate.candidateProvenance.localExcerpt, null, 2)}</pre></details> : null}
        {candidate.candidateProvenance.relatedSourceId ? <p>Önceki kayıt korunuyor: {candidate.candidateProvenance.relatedSourceId}</p> : null}
        <label>{candidate.title} aday içerik kararı<select aria-label={`${candidate.title} aday içerik kararı`} value={candidate.reviewStatus} onChange={(event) => void send(`/api/evidence-sources/${candidate.id}`, { reviewStatus: event.target.value }, "PATCH")}>{Object.entries(reviewLabels).map(([value, label]) => <option key={value} value={value} disabled={value === "verified" && !candidate.excerpt}>{label}</option>)}</select></label>
        <label>{candidate.title} aday güncellik kararı<select aria-label={`${candidate.title} aday güncellik kararı`} value={candidate.freshnessStatus} onChange={(event) => void send(`/api/evidence-sources/${candidate.id}`, { freshnessStatus: event.target.value }, "PATCH")}>{Object.entries(freshnessLabels).map(([value, label]) => <option key={value} value={value} disabled={value === "current" && (!candidate.excerpt || ["changed", "inaccessible"].includes(candidate.availability))}>{label}</option>)}</select></label>
      </article>)}</div>
      {!visible.length ? <p className="empty">Bu iddiada aday yok.</p> : null}
    </fieldset>
    {error ? <p className="error" role="alert">{error}</p> : null}
  </section>;
}
