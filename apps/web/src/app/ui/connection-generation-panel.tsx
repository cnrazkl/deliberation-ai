"use client";
import { useEffect, useState } from "react";
import { ownerFetch } from "../../lib/session-fetch";
import { providerObservationsSchema, type GenerationObservation, type ProviderObservations } from "@deliberation-ai/contracts";
import { ConnectionChatTester } from "./connection-chat-tester";

const statusText = { submitted: "Yanıt bekleniyor", succeeded: "Çağrı başarılı", failed: "Deneme başarısız", outcome_unknown: "Uzak sonuç bilinmiyor" };
export function ConnectionGenerationPanel({ connection, onBusy }: {
  connection: { id: string; defaultModel: string; label: string; selectedModels?: string[]; modelAliases?: Record<string, string> }; onBusy: (busy: boolean) => void;
}) {
  const [history, setHistory] = useState<ProviderObservations | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null), [generation, setGeneration] = useState(0);
  const endpoint = `/api/provider-connections/${connection.id}/generation-check`;
  useEffect(() => {
    let active = true;
    void ownerFetch(`/api/provider-connections/${connection.id}/chat-check`, { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const body = await response.json(); const observations = providerObservationsSchema.parse(body.observations);
      if (active) { setHistory(observations); setError(null); }
    }).catch(() => { if (active) setError("Test durumu okunamadı. Kayıtları yenileyin."); });
    return () => { active = false; };
  }, [connection.id, generation]);
  async function closeUnknown(check: GenerationObservation) {
    setBusy(true); onBusy(true); setError(null);
    try {
      const response = await ownerFetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: check.id, fingerprint: check.fingerprint, acknowledgeUnknown: true }) });
      const body = await response.json(); if (!response.ok) throw new Error(`${body.error ?? "Kayıt güncellenemedi."} · HTTP ${response.status}`);
      setHistory(current => current ? { ...current, generationChecks: current.generationChecks.map(item => item.id === check.id ? body : item) } : null);
      setCloseId(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Kayıt güncellenemedi."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <section className="connection-generation-panel" aria-label={`${connection.label} üretim kontrolü`}>
    <ConnectionChatTester connection={connection} models={connection.selectedModels ?? (connection.defaultModel ? [connection.defaultModel] : [])}
      aliases={connection.modelAliases ?? {}} needsSave={false} disabled={busy} debugging onSave={async () => connection} onBusy={onBusy} onResult={() => setGeneration(current => current + 1)} />
    <section className="connection-test-history" aria-label="Test işlem geçmişi">
      <div className="connection-catalog-heading"><div><h3>İşlem Durumu Ve Model Geçmişi</h3><p className="hint">Yeni testlerin mesaj, dosya ve yanıtları kaydedilmez. Burada çağrı durumu, hata kodu ve katalog gözlemleri tutulur.</p></div>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setGeneration(current => current + 1)}>Kayıtları Yenile</button></div>
      {error ? <p className="alert error" role="alert">{error}</p> : null}
      {history ? <>
        <ul className="connection-test-receipts">{history.generationChecks.slice().reverse().map(check => <li key={check.id}>
          <strong>{connection.modelAliases?.[check.model] ?? check.model}</strong>
          <p>{new Date(check.startedAt).toLocaleString("tr-TR")} · {statusText[check.status]} · sürüm {check.revision}</p>
          {check.errorCode || check.httpStatus || check.providerErrorCode ? <code>{check.errorCode ?? check.failure}{check.httpStatus ? ` · HTTP ${check.httpStatus}` : ""}{check.providerErrorCode ? ` · Sağlayıcı: ${check.providerErrorCode}` : ""}</code> : null}
          <p className="hint">Bildirilen giriş/çıkış: {check.inputTokens ?? "?"}/{check.outputTokens ?? "?"} token. {check.acknowledgedAt ? "Belirsizlik kapatıldı; uzak sonuç doğrulanmadı." : ""}</p>
          {check.outputCapExceeded ? <p className="inline-warning">Sağlayıcının bildirdiği çıktı 512 tokenı aştı.</p> : null}
          {["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt ? <div>
            <label className="checkbox-label"><input type="checkbox" checked={closeId === check.id} disabled={busy} onChange={event => setCloseId(event.target.checked ? check.id : null)} />Uzak sonuç ve ücretin bilinmediğini kabul ediyorum; bu belirsiz kaydı kapat.</label>
            <button type="button" className="secondary-button" disabled={busy || closeId !== check.id} onClick={() => void closeUnknown(check)}>Belirsizliği Kapat (API Çağrısı Yapmaz)</button>
          </div> : null}
        </li>)}</ul>
        {!history.generationChecks.length ? <p className="hint">Henüz bir test işlemi yok.</p> : null}
        <h4>Katalog Gözlemleri</h4>
        <ul>{history.catalogHistory.slice().reverse().map((entry, index) => <li key={index}>{entry.check.checkedAt ? new Date(entry.check.checkedAt).toLocaleString("tr-TR") : "Zaman bilinmiyor"} · sürüm {entry.revision} · {entry.check.status} · {entry.check.models.length} model</li>)}</ul>
      </> : null}
    </section>
  </section>;
}
