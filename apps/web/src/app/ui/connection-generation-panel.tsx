"use client";
import { useState } from "react";
import type { CatalogModelDetail, GenerationObservation, ProviderObservations } from "@deliberation-ai/contracts";
type Review = { revision: number; model: string; fingerprint: string; version: string; system: string; user: string;
  maxOutputTokens: number; timeoutMs: number; observations: ProviderObservations };
const statusText = { submitted: "Gönderildi; sonuç henüz doğrulanmadı", succeeded: "Yapılandırılmış üretim başarılı", failed: "Deneme başarısız", outcome_unknown: "Uzak sonuç bilinmiyor" };
function capabilityText(detail?: CatalogModelDetail) {
  if (!detail) return "Yetenek alanları bildirilmemiş.";
  const fields = [detail.inputTokenLimit && `giriş ${detail.inputTokenLimit}`, detail.outputTokenLimit && `çıkış ${detail.outputTokenLimit}`,
    detail.contextWindowTokens && `bağlam ${detail.contextWindowTokens}`, detail.reasoningLevels?.length && `düşünme ${detail.reasoningLevels.join(", ")}`,
    detail.thinking !== undefined && `thinking ${detail.thinking ? "evet" : "hayır"}`, detail.reasoningParameterListed && "düşünme parametresi listeleniyor"];
  return fields.filter(Boolean).join(" · ") || "Yetenek alanları bildirilmemiş.";
}
export function ConnectionGenerationPanel({ connection }: { connection: { id: string; defaultModel: string; label: string } }) {
  const [open, setOpen] = useState(false), [model, setModel] = useState(connection.defaultModel);
  const [review, setReview] = useState<Review | null>(null), [requestId, setRequestId] = useState<string | null>(null);
  const [acknowledge, setAcknowledge] = useState(false), [unknownAcknowledgement, setUnknownAcknowledgement] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);
  const endpoint = `/api/provider-connections/${connection.id}/generation-check`;
  async function refresh(fresh: boolean) {
    setBusy(true); setError(null); setAcknowledge(false); setUnknownAcknowledgement(false); setCloseId(null);
    try {
      const response = await fetch(`${endpoint}?model=${encodeURIComponent(model)}`, { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "İnceleme alınamadı.");
      setReview(body); if (fresh || !requestId) setRequestId(crypto.randomUUID());
    } catch (caught) { setReview(null); setError(caught instanceof Error ? caught.message : "İnceleme alınamadı."); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!review || !requestId || !acknowledge) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        requestId, model: review.model, fingerprint: review.fingerprint, acknowledge: true, acknowledgeUnknown: unknownAcknowledgement,
      }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Deneme kaydı alınamadı.");
      const check = body as GenerationObservation;
      setReview({ ...review, observations: { ...review.observations, generationChecks: [...review.observations.generationChecks.filter((item) => item.id !== check.id), check] } });
      setAcknowledge(false); setUnknownAcknowledgement(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Yanıt alınamadı; kaydı yenileyin. Aynı kimliği tekrar kontrol etmek yeni çağrı yapmaz."); }
    finally { setBusy(false); }
  }
  async function closeUnknown(check: GenerationObservation) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: check.id, fingerprint: check.fingerprint, acknowledgeUnknown: true }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Kayıt güncellenemedi.");
      setReview((current) => current ? { ...current, observations: { ...current.observations,
        generationChecks: current.observations.generationChecks.map((item) => item.id === check.id ? body : item) } } : null);
      setCloseId(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Kayıt güncellenemedi."); }
    finally { setBusy(false); }
  }
  const reviewedModel = review?.model ?? model.trim();
  const checks = review?.observations.generationChecks.filter((check) => check.model === reviewedModel) ?? [];
  const pending = review?.observations.generationChecks.filter((check) => ["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt) ?? [];
  return <section aria-label={`${connection.label} üretim kontrolü`}>
    <button type="button" className="secondary-button" disabled={busy} aria-expanded={open} onClick={() => {
      setOpen(!open); if (!open) void refresh(true);
    }}>Üretim testi ve model geçmişi</button>
    {open ? <div className="connection-editor">
      <p>Bu test bir API çağrısı yapar ve ücretlenebilir. Yalnız aşağıdaki sabit deneme gönderilir; sohbetleriniz ve dosyalarınız gönderilmez. Arama kapalı; adaptörün “none” düşünme ayarı kullanılır, bazı modeller varsayılan veya en düşük düşünmeyi kullanabilir. İstenen çıktı sınırı 512 token, bekleme sınırı 45 saniye. Sağlayıcının sınırı uyguladığı ve fatura tutarı ayrıca doğrulanmış değildir.</p>
      <label>Denenecek model<input value={model} maxLength={120} disabled={busy} onChange={(event) => {
        setModel(event.target.value); setReview(null); setRequestId(null); setAcknowledge(false); setUnknownAcknowledgement(false);
      }} /></label>
      <button type="button" className="secondary-button" disabled={busy || !model.trim()} onClick={() => void refresh(true)}>Yeni denemeyi incele</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh(false)}>Kayıtları yenile</button>
      {error ? <p role="alert">{error}</p> : null}
      {review ? <>
        <p>Model {review.model} · bağlantı sürümü {review.revision} · istenen çıktı sınırı {review.maxOutputTokens} token</p>
        <details><summary>Gönderilecek talimat ve deneme</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{review.system + "\n\n" + review.user}</pre></details>
        <label className="checkbox-label"><input type="checkbox" checked={acknowledge} disabled={busy} onChange={(event) => setAcknowledge(event.target.checked)} />Tam denemeyi inceledim; tek ücretlenebilir çağrıyı onaylıyorum.</label>
        {pending.length ? <p>Doğrulanmamış kayıtlar: {pending.map((check) => `${check.model}, sürüm ${check.revision}, ${new Date(check.startedAt).toLocaleString("tr-TR")}`).join("; ")}</p> : null}
        {pending.length ? <label className="checkbox-label"><input type="checkbox" checked={unknownAcknowledgement} disabled={busy} onChange={(event) => setUnknownAcknowledgement(event.target.checked)} />Önceki uzak sonuç bilinmiyor; yeni denemenin ayrıca ücretlenebileceğini kabul ediyorum. Aktif denemenin süresi dolmadan yeni çağrı engellenir.</label> : null}
        <button type="button" className="primary-button" disabled={busy || !acknowledge || Boolean(pending.length && !unknownAcknowledgement)} onClick={() => void send()}>{busy ? "İşlem sürüyor…" : "Onaylanan denemeyi gönder / kaydını kontrol et"}</button>
        <p>Bağlantı başına son 10 katalog gözlemi, {review.observations.generationChecks.length}/32 kalıcı deneme kimliği tutulur. Eski katalog gözlemleri: {review.observations.catalogDropped} kayıt sınır dışında. Üretim kayıtları otomatik silinmez.</p>
        <h4>{reviewedModel} geçmişi</h4>
        <ul>{review.observations.catalogHistory.slice().reverse().map((entry, index) => <li key={index}>
          {entry.check.checkedAt ? new Date(entry.check.checkedAt).toLocaleString("tr-TR") : "Eski kaydın zamanı bilinmiyor"} · sürüm {entry.revision} · {entry.provider}/{entry.endpointPreset} · {entry.check.status} · {entry.check.verification} · {entry.check.models.includes(reviewedModel) ? "Model listede" : "Görünen listede yok; destek yokluğu kanıtlanmadı"}. {capabilityText(entry.check.details?.find((detail) => detail.id === reviewedModel))}
        </li>)}</ul>
        <ul>{checks.slice().reverse().map((check) => <li key={check.id}>
          {new Date(check.startedAt).toLocaleString("tr-TR")} · sürüm {check.revision} · {check.provider}/{check.endpointPreset} · {statusText[check.status]}{check.failure ? ` (${check.failure})` : ""}.
          {check.httpStatus ? ` HTTP ${check.httpStatus}.` : ""}
          Dönen model: {check.returnedModel ?? "bilinmiyor"}. Bildirilen giriş/çıkış: {check.inputTokens ?? "bilinmiyor"}/{check.outputTokens ?? "bilinmiyor"} token. {check.acknowledgedAt ? "Belirsizlik kullanıcı tarafından kapatıldı; uzak sonuç doğrulanmadı." : ""}
          {check.outputCapExceeded === true || check.outputTokens !== null && check.outputTokens > review.maxOutputTokens ? <strong role="alert"> Sağlayıcının bildirdiği çıktı istenen sınırı aştı; sınır uygulanmış kabul edilmez.</strong> : null}
          {["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt ? <div>
            <label className="checkbox-label"><input type="checkbox" checked={closeId === check.id} disabled={busy} onChange={(event) => setCloseId(event.target.checked ? check.id : null)} />Uzak sonuç ve ücretin bilinmediğini kabul ediyorum; bu belirsiz kaydı kapat.</label>
            <button type="button" className="secondary-button" disabled={busy || closeId !== check.id} onClick={() => void closeUnknown(check)}>Belirsizliği onayla (API çağrısı yapmaz)</button>
          </div> : null}
        </li>)}</ul>
        <p>Başarı yalnız bu sürüm, model ve sabit metnin yapılandırılmış yanıtını doğrular. Gerçek sorularda doğruluk, görsel/arama/düşünme desteği, fiyat ve gelecekte çalışması doğrulanmış sayılmaz.</p>
      </> : null}
    </div> : null}
  </section>;
}
