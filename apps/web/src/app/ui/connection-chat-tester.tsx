"use client";
import { useEffect, useRef, useState } from "react";
import { generationObservationSchema, CONNECTION_TEST_FILE_BYTES, type ConnectionTestAttachment, type GenerationObservation } from "@deliberation-ai/contracts";
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
export function ConnectionChatTester({ connection, models, aliases = {}, needsSave, disabled, onSave, onBusy, debugging = false, onResult }: {
  connection: Connection | undefined; models: string[]; aliases?: Record<string, string>; needsSave: boolean; disabled: boolean;
  onSave: () => Promise<Connection | undefined>; onBusy: (busy: boolean) => void; debugging?: boolean; onResult?: () => void;
}) {
  const [model, setModel] = useState(models[0] ?? ""), [message, setMessage] = useState("Merhaba! Kısaca yanıt verir misin?");
  const selected = models.includes(model) ? model : models[0] ?? "";
  const [acknowledgeUnknown, setAcknowledgeUnknown] = useState(false);
  const [files, setFiles] = useState<ConnectionTestAttachment[]>([]), [readingFiles, setReadingFiles] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<GenerationObservation[]>([]);
  const [receipts, setReceipts] = useState<GenerationObservation[]>([]);
  const [intent, setIntent] = useState<{ connectionId: string; requestId: string; model: string; message: string; fingerprint: string } | null>(null);
  const connectionId = connection?.id;
  const working = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);
  const pending = receipts.some(check => ["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [checks]);
  useEffect(() => {
    if (!connectionId) return;
    let active = true;
    void ownerFetch(`/api/provider-connections/${connectionId}/chat-check`, { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const body = await response.json(); if (active) setReceipts(body.observations.generationChecks);
    }).catch(() => { if (active) setError("Deneme geçmişi okunamadı. Göndermeden önce kayıtları yenileyin."); });
    return () => { active = false; };
  }, [connectionId]);
  async function chooseFiles(input: HTMLInputElement) {
    setError(null); setReadingFiles(true); onBusy(true);
    try {
      const chosen = Array.from(input.files ?? []);
      if (chosen.length + files.length > 3 || chosen.reduce((sum, file) => sum + file.size, 0) + files.reduce((sum, file) => sum + file.data.length * 3 / 4, 0) > 2_097_152) throw new Error("En fazla 3 dosya ve toplam 2 MiB seçebilirsiniz.");
      const added: ConnectionTestAttachment[] = [];
      for (const file of chosen) {
        const mime = file.type === "audio/x-wav" ? "audio/wav" : file.type === "audio/mp3" ? "audio/mpeg" : file.type;
        if (!["image/png", "image/jpeg", "image/webp", "application/pdf", "audio/wav", "audio/mpeg"].includes(mime) || !file.size || file.size > CONNECTION_TEST_FILE_BYTES) throw new Error("PNG, JPEG, WebP, PDF, WAV veya MP3 kullanın. Her dosya en fazla 1 MiB olabilir.");
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]!); reader.onerror = () => reject(new Error("Dosya okunamadı.")); reader.readAsDataURL(file); });
        added.push({ name: file.name.slice(0, 120), mimeType: mime as ConnectionTestAttachment["mimeType"], data });
      }
      setFiles(current => [...current, ...added]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Dosya eklenemedi."); }
    finally { input.value = ""; setReadingFiles(false); onBusy(false); }
  }
  async function send() {
    if (working.current || readingFiles || !selected || !message.trim() || pending && !acknowledgeUnknown || intent) return;
    working.current = true; setBusy(true); onBusy(true); setError(null);
    try {
      const saved = needsSave ? await onSave() : connection;
      if (!saved) return;
      const endpoint = `/api/provider-connections/${saved.id}/chat-check`;
      const payload = { model: selected, message: message.trim(), attachments: debugging ? files : [], transient: true };
      const previewResponse = await ownerFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", ...payload }) });
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(`${preview.error ?? "Deneme incelenemedi"} · ${preview.code ?? `HTTP ${previewResponse.status}`}`);
      const attempt = { connectionId: saved.id, requestId: createBrowserRequestId(), model: selected, message: message.trim(), fingerprint: preview.fingerprint };
      setIntent(attempt);
      const response = await ownerFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", ...attempt, ...payload, connectionId: undefined, acknowledge: true, acknowledgeUnknown }) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) setIntent(null);
        throw new Error(`${body.error ?? "Deneme tamamlanamadı"} · ${body.code ?? `HTTP ${response.status}`}`);
      }
      const check = generationObservationSchema.parse(body);
      setChecks(current => [...current.filter(item => item.id !== check.id), check]);
      setReceipts(current => [...current.filter(item => item.id !== check.id), check]);
      setIntent(null); setAcknowledgeUnknown(false); onResult?.();
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
      setReceipts(body.observations.generationChecks);
      setChecks(current => current.map(check => ({ ...check, ...body.observations.generationChecks.find(item => item.id === check.id) })));
      if (intent) {
        const result = body.observations.generationChecks.find(item => item.id === intent.requestId);
        if (result && result.status !== "submitted") { setChecks(current => [...current.filter(check => check.id !== result.id), { ...result, message: intent.message }]); setIntent(null); onResult?.(); }
        else setError("Denemenin sonucu henüz doğrulanmadı. Kayıtları kontrol etmek yeni API çağrısı yapmaz.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kayıt okunamadı."); }
    finally { working.current = false; setBusy(false); onBusy(false); }
  }
  return <section className="connection-chat-test" aria-label={debugging ? "Model test ve hata ayıklama alanı" : "Hızlı bağlantı testi"} aria-busy={busy}>
    <div className="connection-chat-heading"><div><h3>{debugging ? "Model Testi Ve Hata Ayıklama" : "Hızlı Bağlantı Testi"}</h3><p className="hint">{debugging ? "Mesajınızı yazın; küçük bir görsel, ses veya PDF ile modeli deneyin." : "Konsey kurmadan seçtiğiniz modele kısa bir mesaj gönderin."}</p></div><span className="connection-chat-badge">Tek Model</span></div>
    <p className="connection-test-cost-note"><strong>Ücret Uyarısı</strong> Bu test API üzerinden yapılır ve ücretlenebilir. Gönder düğmesi bir test çağrısı başlatır.</p>
    <label>Test modeli<select aria-label="Test modeli" value={selected} disabled={busy || disabled || readingFiles || Boolean(intent)} onChange={event => { setModel(event.target.value); setError(null); }}>
      {!models.length ? <option value="">Önce kullanılacak modelleri seçin</option> : models.map(id => <option key={id} value={id}>{aliases[id] ? `${aliases[id]} · ${id}` : id}</option>)}
    </select></label>
    <div ref={transcript} className="connection-chat-transcript" role="log" aria-label="Bağlantı test sonuçları" aria-live="polite">
      {checks.filter(check => check.kind === "chat").map(check => <article key={check.id} className="connection-chat-exchange">
        <p className="connection-chat-question"><strong>Siz</strong><span>{check.message}</span></p>
        <div className={`connection-chat-reply ${check.status === "succeeded" ? "" : "connection-chat-failure"}`}>
          <strong>{aliases[check.model] ?? check.model}</strong>
          {check.status === "succeeded" ? <p>{check.reply ?? "Çağrı başarılı olarak kaydedildi. Yanıt bu geçici oturumda alınamadı; tekrar çağrı yapılmadı."}</p> : <><p>{check.errorDetail ?? failureText[check.errorCode ?? ""] ?? (check.status === "submitted" ? "Yanıt bekleniyor. Kayıtları yenileyin." : "Deneme tamamlanamadı. Sağlayıcının sonucunu doğrulayın.")}</p>
            <code>{check.errorCode ?? check.failure ?? check.status}{check.httpStatus ? ` · HTTP ${check.httpStatus}` : ""}{check.providerErrorCode ? ` · Sağlayıcı: ${check.providerErrorCode}` : ""}</code></>}
          {check.status === "outcome_unknown" ? <p className="hint">Uzak sonuç ve ücret doğrulanamadı. Otomatik tekrar yapılmadı.</p> : null}
          {check.outputCapExceeded ? <p className="inline-warning">Sağlayıcının bildirdiği çıktı 512 tokenı aştı.</p> : null}
          {check.replyTruncated ? <p className="hint">Yanıt token sınırında kesildi.</p> : null}
          <small>{check.elapsedMs === null ? "Süre bilinmiyor" : `${(check.elapsedMs / 1000).toFixed(1)} sn`} · {check.inputTokens ?? "?"}/{check.outputTokens ?? "?"} giriş/çıkış tokenı</small>
        </div>
      </article>)}
      {!checks.some(check => check.kind === "chat") ? <p className="hint">Yanıt veya hata kodu burada görünecek.</p> : null}
    </div>
    <label>Test mesajı<textarea aria-label="Test mesajı" rows={3} maxLength={1200} value={message} disabled={busy || disabled || readingFiles || Boolean(intent)} onChange={event => { setMessage(event.target.value); setError(null); }} /></label>
    {debugging ? <section className="connection-test-files" aria-label="Test dosyaları"><label>Test Dosyası Ekle<input aria-label="Test dosyası ekle" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,audio/wav,audio/mpeg,.wav,.mp3" disabled={busy || disabled || readingFiles || Boolean(intent)} onChange={event => void chooseFiles(event.currentTarget)} /></label>
      <p className="hint">En fazla 3 dosya; dosya başına 1 MiB, toplam 2 MiB. Ses için WAV/MP3. Yalnız bu testin dosyaları gönderilir.</p>
      {files.map((file, index) => <div key={index} className="connection-test-file"><span>{file.name} · {file.mimeType}</span><button type="button" className="secondary-button" aria-label={`${file.name} dosyasını kaldır`} disabled={busy || readingFiles || Boolean(intent)} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}>Kaldır</button></div>)}
    </section> : null}
    {pending ? <label className="checkbox-label"><input type="checkbox" checked={acknowledgeUnknown} disabled={busy || disabled} onChange={event => setAcknowledgeUnknown(event.target.checked)} /><span>Önceki denemenin uzak sonucu bilinmiyor; yeni denemenin ayrıca ücretlenebileceğini kabul ediyorum.</span></label> : null}
    <div className="connection-chat-actions"><button type="button" disabled={busy || disabled || readingFiles || !selected || !message.trim() || pending && !acknowledgeUnknown || Boolean(intent)} onClick={() => void send()}>{busy ? "Yanıt Bekleniyor…" : needsSave ? "Kaydet Ve Test Et" : "Mesajı Gönder"}</button>
      {connection || intent ? <button type="button" className="secondary-button" disabled={busy || disabled} onClick={() => void refresh()}>Sonucu Kontrol Et</button> : null}</div>
    {needsSave ? <p className="hint">Bu işlem önce bağlantıyı şifreleyerek kaydeder veya değişikliklerini günceller, ardından mesajı gönderir.</p> : null}
    {error ? <p className="alert error" role="alert">{error}{intent ? " Yeni çağrı göndermeden Sonucu Kontrol Et ile kaydı okuyun." : ""}</p> : null}
    <p className="hint">Mesaj, dosya ve yanıtlar geçicidir; pencereyi kapatınca veya sayfayı yenileyince temizlenir. Sohbet geçmişiniz eklenmez. 512 çıktı tokenı ve 45 saniye istenir. Çift gönderimi önleyen içeriksiz işlem durumu saklanır.</p>
  </section>;
}
