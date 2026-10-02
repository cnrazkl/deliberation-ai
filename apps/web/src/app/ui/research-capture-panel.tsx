"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { EvidenceRelation } from "@deliberation-ai/contracts";

type ClaimOption = { claimId: string; statement: string; source: string };
type ResearchCapture = {
  id: string;
  claimId: string;
  finalUrl: string;
  title: string;
  content: string;
  contentType: string;
  byteLength: number;
  contentSha256: string;
  redirectCount: number;
  reviewStatus: "unreviewed" | "accepted" | "rejected";
  evidenceSourceId: string | null;
  capturedAt: string;
};

const relationLabels: Record<EvidenceRelation, string> = {
  supports: "Destekliyor",
  contradicts: "Çelişiyor",
  context: "Bağlam sağlıyor",
};

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function ResearchCapturePanel({
  runId,
  claims,
  onEvidenceSourceCreated,
}: {
  runId: string;
  claims: ClaimOption[];
  onEvidenceSourceCreated: () => void;
}) {
  const [captures, setCaptures] = useState<ResearchCapture[]>([]);
  const [claimId, setClaimId] = useState(claims[0]?.claimId ?? "");
  const [url, setUrl] = useState("");
  const [browserRender, setBrowserRender] = useState(false);
  const [excerptDrafts, setExcerptDrafts] = useState<Record<string, string>>({});
  const [relations, setRelations] = useState<Record<string, EvidenceRelation>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [publishedDates, setPublishedDates] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string>();
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh(): Promise<void> {
    const response = await fetch(`/api/research-captures?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { captures: ResearchCapture[] };
    setCaptures(body.captures);
  }

  useEffect(() => {
    void fetch(`/api/research-captures?runId=${encodeURIComponent(runId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { captures: ResearchCapture[] };
        setCaptures(body.captures);
      })
      .catch(() => undefined);
  }, [runId]);

  const effectiveClaimId = claims.some((claim) => claim.claimId === claimId)
    ? claimId
    : (claims[0]?.claimId ?? "");

  async function captureSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFetching(true);
    setError(undefined);
    try {
      const response = await fetch("/api/research-captures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, claimId: effectiveClaimId, url, renderMode: browserRender ? "browser" : "direct" }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Kaynak getirilemedi."));
      const capture = (await response.json()) as ResearchCapture;
      setCaptures((current) => [...current, capture]);
      setUrl("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kaynak getirilemedi.");
    } finally {
      setFetching(false);
    }
  }

  async function rejectCapture(id: string): Promise<void> {
    setPendingId(id);
    setError(undefined);
    try {
      const response = await fetch(`/api/research-captures/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Yakalama reddedilemedi."));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Yakalama reddedilemedi.");
    } finally {
      setPendingId(undefined);
    }
  }

  async function promoteCapture(id: string): Promise<void> {
    setPendingId(id);
    setError(undefined);
    try {
      const response = await fetch(`/api/research-captures/${id}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relation: relations[id] ?? "supports",
          excerpt: excerptDrafts[id] ?? "",
          publishedAt: publishedDates[id] || undefined,
          note: notes[id] ?? "",
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Kanıt kaydı oluşturulamadı."));
      await refresh();
      onEvidenceSourceCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kanıt kaydı oluşturulamadı.");
    } finally {
      setPendingId(undefined);
    }
  }

  const selectedCaptures = captures.filter((capture) => capture.claimId === effectiveClaimId);
  return (
    <section className="research-capture-section" aria-label="Uygulama yönetimli kaynak getirme">
      <div className="synthesis-heading">
        <div>
          <span>GÜVENLİ KAYNAK GETİRME</span>
          <strong>{captures.length} yakalama</strong>
        </div>
        <small>
          Yalnızca açık isteğinizle herkese açık web sayfası getirilir. Yakalanan metin talimat değil,
          incelenmemiş araştırma malzemesidir; kendiliğinden kanıt veya doğrulama sayılmaz.
        </small>
      </div>
      <form className="research-capture-form" onSubmit={captureSource}>
        <label>
          İddia
          <select value={effectiveClaimId} onChange={(event) => setClaimId(event.target.value)}>
            {claims.map((claim) => <option key={claim.claimId} value={claim.claimId}>{claim.source} · {claim.statement}</option>)}
          </select>
        </label>
        <label>
          Herkese açık kaynak adresi
          <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." required />
        </label>
        <label className="research-browser-option">
          <input type="checkbox" checked={browserRender} onChange={(event) => setBrowserRender(event.target.checked)} />
          JavaScript ile oluşan metni güvenli tarayıcıda yakala
        </label>
        <button className="secondary-button" disabled={fetching || !effectiveClaimId} type="submit">
          {fetching ? "Güvenli biçimde getiriliyor…" : "Kaynağı getir ve mühürle"}
        </button>
      </form>
      <p className="research-boundary-note">
        Yerel/özel ağ adresleri, standart dışı portlar ve 1 MiB üzeri tekil yanıtlar engellenir. Doğrudan mod HTML, düz metin ve en fazla 100 sayfalık PDF okur. Tarayıcı modu yalnızca GET ile en fazla 20 metin/kod isteği ve toplam 5 MiB indirir; görsel, medya, yazı tipi, indirme ve servis çalışanlarını engeller.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <div className="research-capture-list">
        {selectedCaptures.map((capture) => (
          <article className={`research-capture ${capture.reviewStatus}`} key={capture.id}>
            <header>
              <div>
                <strong>{capture.title}</strong>
                <a href={capture.finalUrl} target="_blank" rel="noreferrer">{capture.finalUrl}</a>
              </div>
              <span>{capture.reviewStatus === "unreviewed" ? "İncelenmedi" : capture.reviewStatus === "accepted" ? "Kanıta aktarıldı" : "Reddedildi"}</span>
            </header>
            <small>
              {new Date(capture.capturedAt).toLocaleString("tr-TR")} · {capture.byteLength.toLocaleString("tr-TR")} bayt
              {capture.redirectCount ? ` · ${capture.redirectCount} yönlendirme` : ""} · SHA-256 {capture.contentSha256.slice(0, 12)}…
            </small>
            <details>
              <summary>Yakalanan düz metni incele</summary>
              <pre>{capture.content}</pre>
            </details>
            {capture.reviewStatus === "unreviewed" ? (
              <div className="research-promotion-form">
                <label>
                  İlişki
                  <select value={relations[capture.id] ?? "supports"} onChange={(event) => setRelations((current) => ({ ...current, [capture.id]: event.target.value as EvidenceRelation }))}>
                    {Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>
                  Yayın tarihi (isteğe bağlı)
                  <input type="date" value={publishedDates[capture.id] ?? ""} onChange={(event) => setPublishedDates((current) => ({ ...current, [capture.id]: event.target.value }))} />
                </label>
                <label className="research-excerpt-field">
                  Metinden birebir alıntı
                  <textarea rows={4} maxLength={4000} value={excerptDrafts[capture.id] ?? ""} onChange={(event) => setExcerptDrafts((current) => ({ ...current, [capture.id]: event.target.value }))} placeholder="Yukarıdaki yakalanan metinden birebir kopyalayın." />
                </label>
                <label className="research-note-field">
                  İnceleme notu
                  <input maxLength={1000} value={notes[capture.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [capture.id]: event.target.value }))} />
                </label>
                <div className="research-actions">
                  <button className="primary-button" type="button" disabled={pendingId === capture.id || !(excerptDrafts[capture.id]?.trim())} onClick={() => void promoteCapture(capture.id)}>Kanıt kaydına dönüştür</button>
                  <button className="secondary-button danger-button" type="button" disabled={pendingId === capture.id} onClick={() => void rejectCapture(capture.id)}>Reddet</button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
        {selectedCaptures.length === 0 ? <p className="empty">Bu iddia için yakalanmış araştırma kaynağı yok.</p> : null}
      </div>
    </section>
  );
}
