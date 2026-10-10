"use client";
import { useEffect, useRef, useState } from "react";
import { generationObservationSchema, type GenerationObservation } from "@deliberation-ai/contracts";
import { createBrowserRequestId } from "../../lib/browser-request-id";
import { ownerFetch } from "../../lib/session-fetch";

type Connection = { id: string; revision?: number };
const failureText: Record<string, string> = {
  provider_dns_failure: "Sağlayıcının adresi çözülemedi. Sunucunun DNS ve internet erişimini kontrol edin.",
  provider_timeout: "45 saniye içinde tam yanıt alınamadı. Uzak işlem tamamlanmış ve ücretlenmiş olabilir.",
  provider_connection_refused: "Sağlayıcının adresindeki bağlantı reddedildi.",
  provider_connection_reset: "Sağlayıcıyla bağlantı kesildi. Uzak sonuç doğrulanamadı.",
  provider_tls_failure: "Sağlayıcının güvenli bağlantısı doğrulanamadı.",
  provider_response_unreadable: "Sağlayıcıdan okunabilir bir yanıt alınamadı.",
  provider_http_401: "Sağlayıcı API anahtarını kabul etmedi.",
  provider_http_402: "Sağlayıcı ödeme veya kredi nedeniyle isteği reddetti.",
  provider_http_429: "Sağlayıcı istek veya kullanım sınırı bildirdi.",
  invalid_private_response: "Sağlayıcı geçerli, görünür bir sohbet yanıtı döndürmedi.",
};
export function ConnectionChatTester({ connection, models, needsSave, draftBinding, disabled, onSave, onBusy }: {
  connection: Connection | undefined; models: string[]; needsSave: boolean; draftBinding: string; disabled: boolean;
  onSave: () => Promise<Connection | undefined>; onBusy: (busy: boolean) => void;
}) {
  const [model, setModel] = useState(models[0] ?? ""), [message, setMessage] = useState("Merhaba! Kısaca yanıt verir misin?");
  const selected = models.includes(model) ? model : models[0] ?? "";
  const [acknowledge, setAcknowledge] = useState(false), [acknowledgeUnknown, setAcknowledgeUnknown] = useState(false);
  const [approvedBinding, setApprovedBinding] = useState<string | null>(null);
  const approvalBinding = JSON.stringify([draftBinding, selected, message]);
  const approved = acknowledge && approvedBinding === approvalBinding;
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<GenerationObservation[]>([]);
  const [intent, setIntent] = useState<{ connectionId: string; requestId: string; model: string; message: string; fingerprint: string } | null>(null);
  const connectionId = connection?.id;
  const working = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);
  const pending = checks.some(check => ["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [checks]);
  useEffect(() => {
    if (!connectionId) return;
    let active = true;
    void ownerFetch(`/api/provider-connections/${connectionId}/chat-check`, { cache: "no-store" }).then(async response => {
      if (response.ok) { const body = await response.json(); if (active) setChecks(current => [...body.observations.generationChecks.filter((item: GenerationObservation) => !current.some(check => check.id === item.id)), ...current]); }
    }).catch(() => { if (active) setError("Deneme geçmişi okunamadı. Göndermeden önce kayıtları yenileyin."); });
    return () => { active = false; };
  }, [connectionId]);
  async function send() {
    if (working.current || !selected || !message.trim() || !approved || pending && !acknowledgeUnknown || intent) return;
    working.current = true; setBusy(true); onBusy(true); setError(null);
    try {
      const saved = needsSave ? await onSave() : connection;
      if (!saved) return;
      const endpoint = `/api/provider-connections/${saved.id}/chat-check`;
      const previewResponse = await ownerFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", model: selected, message: message.trim() }) });
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(`${preview.error ?? "Deneme incelenemedi"} · ${preview.code ?? `HTTP ${previewResponse.status}`}`);
      const attempt = { connectionId: saved.id, requestId: createBrowserRequestId(), model: selected, message: message.trim(), fingerprint: preview.fingerprint };
      setIntent(attempt);
      const response = await ownerFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", ...attempt, connectionId: undefined, acknowledge: true, acknowledgeUnknown }) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) { setIntent(null); setAcknowledge(false); }
        throw new Error(`${body.error ?? "Deneme tamamlanamadı"} · ${body.code ?? `HTTP ${response.status}`}`);
      }
      const check = generationObservationSchema.parse(body);
      setChecks(current => [...current.filter(item => item.id !== check.id), check]);
      setIntent(null); setAcknowledge(false); setAcknowledgeUnknown(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Deneme yanıtı alınamadı."); }
    finally { working.current = false; setBusy(false); onBusy(false); }
  }
  async function refresh() {
    const id = intent?.connectionId ?? connection?.id;
    if (!id || working.current) return;
    working.current = true; setBusy(true); onBusy(true); setError(null);
    try {
      const response = await ownerFetch(`/api/provider-connections/${id}/chat-check`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Kayıt okunamadı · HTTP ${response.status}`);
      const body = await response.json() as { observations: { generationChecks: GenerationObservation[] } };
      setChecks(body.observations.generationChecks);
      if (intent) {
        const result = body.observations.generationChecks.find(item => item.id === intent.requestId);
        if (result && result.status !== "submitted") { setIntent(null); setAcknowledge(false); }
        else setError("Denemenin sonucu henüz doğrulanmadı. Kayıtları kontrol etmek yeni API çağrısı yapmaz.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kayıt okunamadı."); }
    finally { working.current = false; setBusy(false); onBusy(false); }
  }
  return <section className="connection-chat-test" aria-label="Kısa bağlantı sohbeti" aria-busy={busy}>
    <div className="connection-chat-heading"><div><h3>Bağlantıyı Deneyin</h3><p className="hint">Konsey kurmadan seçtiğiniz modele kısa bir mesaj gönderin.</p></div><span className="connection-chat-badge">Tek Model</span></div>
    <p className="hint">Her deneme yalnız aşağıdaki mesajı gönderir; sohbetleriniz ve dosyalarınız eklenmez. En fazla 512 çıktı tokenı ve 45 saniye istenir. Çağrı ücretlenebilir; sağlayıcının varsayılan düşünme ayarı kullanılır.</p>
    <label>Test modeli<select aria-label="Test modeli" value={selected} disabled={busy || disabled || Boolean(intent)} onChange={event => { setModel(event.target.value); setAcknowledge(false); setError(null); }}>
      {!models.length ? <option value="">Önce kullanılacak modelleri seçin</option> : models.map(id => <option key={id} value={id}>{id}</option>)}
    </select></label>
    <div ref={transcript} className="connection-chat-transcript" role="log" aria-label="Bağlantı test sonuçları" aria-live="polite">
      {checks.filter(check => check.kind === "chat").slice(-5).map(check => <article key={check.id} className="connection-chat-exchange">
        <p className="connection-chat-question"><strong>Siz</strong><span>{check.message}</span></p>
        <div className={`connection-chat-reply ${check.status === "succeeded" ? "" : "connection-chat-failure"}`}>
          <strong>{check.model}</strong>
          {check.status === "succeeded" ? <p>{check.reply}</p> : <><p>{failureText[check.errorCode ?? ""] ?? (check.status === "submitted" ? "Yanıt bekleniyor. Kayıtları yenileyin." : "Deneme tamamlanamadı. Sağlayıcının sonucunu doğrulayın.")}</p>
            <code>{check.errorCode ?? check.failure ?? check.status}{check.httpStatus ? ` · HTTP ${check.httpStatus}` : ""}</code></>}
          {check.status === "outcome_unknown" ? <p className="hint">Uzak sonuç ve ücret doğrulanamadı. Otomatik tekrar yapılmadı.</p> : null}
          {check.outputCapExceeded ? <p className="inline-warning">Sağlayıcının bildirdiği çıktı 512 tokenı aştı.</p> : null}
          {check.replyTruncated ? <p className="hint">Yanıt token sınırında kesildi.</p> : null}
          <small>{check.elapsedMs === null ? "Süre bilinmiyor" : `${(check.elapsedMs / 1000).toFixed(1)} sn`} · {check.inputTokens ?? "?"}/{check.outputTokens ?? "?"} giriş/çıkış tokenı</small>
        </div>
      </article>)}
      {!checks.some(check => check.kind === "chat") ? <p className="hint">Yanıt veya hata kodu burada görünecek.</p> : null}
    </div>
    <label>Test mesajı<textarea aria-label="Test mesajı" rows={3} maxLength={1200} value={message} disabled={busy || disabled || Boolean(intent)} onChange={event => { setMessage(event.target.value); setAcknowledge(false); setError(null); }} /></label>
    <label className="checkbox-label"><input type="checkbox" checked={approved} disabled={busy || disabled || Boolean(intent)} onChange={event => { setAcknowledge(event.target.checked); setApprovedBinding(event.target.checked ? approvalBinding : null); }} /><span>Bu mesajı ve modeli inceledim; bir ücretlenebilir API çağrısını onaylıyorum.</span></label>
    {pending ? <label className="checkbox-label"><input type="checkbox" checked={acknowledgeUnknown} disabled={busy || disabled} onChange={event => setAcknowledgeUnknown(event.target.checked)} /><span>Önceki denemenin uzak sonucu bilinmiyor; yeni denemenin ayrıca ücretlenebileceğini kabul ediyorum.</span></label> : null}
    <div className="connection-chat-actions"><button type="button" disabled={busy || disabled || !selected || !message.trim() || !approved || pending && !acknowledgeUnknown || Boolean(intent)} onClick={() => void send()}>{busy ? "Yanıt Bekleniyor…" : needsSave ? "Kaydet Ve Test Et" : "Mesajı Gönder"}</button>
      {connection || intent ? <button type="button" className="secondary-button" disabled={busy || disabled} onClick={() => void refresh()}>Sonucu Kontrol Et</button> : null}</div>
    {needsSave ? <p className="hint">Bu işlem önce bağlantıyı şifreleyerek kaydeder veya değişikliklerini günceller, ardından mesajı gönderir.</p> : null}
    {error ? <p className="alert error" role="alert">{error}{intent ? " Yeni çağrı göndermeden Sonucu Kontrol Et ile kaydı okuyun." : ""}</p> : null}
    <p className="hint">Bu test kısa sohbet yanıtını kontrol eder. Konseyin yapılandırılmış çıktı testi ve belirsiz kayıtları kapatma işlemleri Test ve Geçmiş sekmesindedir. Bağlantı başına en fazla 32 kalıcı deneme kimliği saklanır.</p>
  </section>;
}
