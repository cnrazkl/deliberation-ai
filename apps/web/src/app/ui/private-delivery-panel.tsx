"use client";
import { useEffect, useRef, useState } from "react";
import type { PrivateDelivery } from "@deliberation-ai/contracts";
import type { PrivateBranchView, PrivateDeliveryPreview } from "@deliberation-ai/persistence";

const reasons: Record<PrivateDeliveryPreview["blocks"][number], string> = {
  no_message: "Önce mesaj taslağını dala kaydedin.", already_requested: "Son mesaj için bir gönderim kaydı zaten var. Yeni bir mesaj kaydedebilirsiniz.",
  pending: "Bekleyen veya sonucu belirsiz bir işlem var.", unsupported_provider: "Özel gönderim OpenAI Responses, OpenAI-compatible, Claude/Anthropic ve Gemini kaynak bağlantılarını destekliyor; kaynak sağlayıcı eşleşmeli.",
  unsupported_settings: "Reasoning varsayılan ve web araması kapalı olmalı; kaynak ayarlar değiştirilmez.",
  missing_connection: "Kaynak bağlantı artık mevcut değil.", high_risk: "Yüksek riskli özel gönderim bu kapsamda desteklenmiyor; konseyi kullanın.",
  capacity: "Dalın istek veya içerik kapasitesi doldu. Bu bir parasal bütçe değildir.",
};
const states: Record<PrivateDelivery["status"], string> = { prepared: "Kuyrukta", submitted: "Sağlayıcıya gönderildi", succeeded: "Yanıt alındı",
  failed: "Başarısız", outcome_unknown: "Sonuç belirsiz", cancelled: "Gönderilmeden iptal edildi", discarded: "Belirsiz kayıt kapatıldı" };
async function request<T>(id: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/private-branches/${id}/deliveries`, { ...options, cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error ?? "Özel gönderim tamamlanamadı."), { status: response.status });
  return value as T;
}
export function PrivateDeliveryPanel({ branch, disabled, onChanged, onBusy }: {
  branch: PrivateBranchView; disabled: boolean; onChanged: () => void; onBusy: (value: boolean) => void;
}) {
  const [preview, setPreview] = useState<PrivateDeliveryPreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const alive = useRef(true); const working = useRef(false);
  const intent = useRef<{ requestId: string; fingerprint: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function act(action: "preview" | "send" | "cancel" | "recover" | "discard_unknown", operationId?: string) {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); onBusy(true); setError(null);
    try {
      if (action === "preview") {
        const value = await request<PrivateDeliveryPreview>(branch.id);
        if (alive.current) { setPreview(value); setReviewed(false); intent.current = null; }
      } else if (action === "send") {
        if (!preview?.eligible || !reviewed) return;
        intent.current ??= { requestId: crypto.randomUUID(), fingerprint: preview.fingerprint };
        await request(branch.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent.current) });
        if (alive.current) { intent.current = null; setPreview(null); setReviewed(false); onChanged(); }
      } else {
        if (action === "discard_unknown" && acknowledged !== operationId) return;
        await request(branch.id, { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationId, action, ...(action === "discard_unknown" ? { acknowledgeUnknown: true } : {}) }) });
        if (alive.current) onChanged();
      }
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof Error && "status" in cause && cause.status === 409) { intent.current = null; setPreview(null); setReviewed(false); }
      setError(cause instanceof Error ? cause.message : "Özel gönderim tamamlanamadı.");
    } finally { working.current = false; onBusy(false); if (alive.current) setBusy(false); }
  }
  const deliveries = branch.body.deliveries ?? [];
  return <section aria-label="Özel model gönderimi">
    <p className="section-hint">Yalnız kaydedilen mesaj açık onayla tek modele gönderilir. Taslağı kaydetmek, dalı açmak veya yenilemek gönderim yapmaz.</p>
    {deliveries.map((operation) => <article key={operation.id} aria-label="Özel gönderim kaydı">
      <strong>{states[operation.status]}{operation.originBranchId !== branch.id ? " · önceki daldan kopya" : ""}</strong>
      <details><summary>Gönderilen mesaj ve bağlam</summary><pre>{JSON.stringify(operation.request.messages, null, 2)}</pre></details>
      {operation.result && <><strong>Model yanıtı</strong><pre>{operation.result.text}</pre>
        {operation.result.finishReason === "length" && <p>Yanıt çıktı sınırına ulaştı; tamamlanmış yanıt olduğu varsayılmaz.</p>}</>}
      <small>Girdi tokenı: {operation.usage?.inputTokens ?? operation.result?.inputTokens ?? "bilinmiyor"}{(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.inputTokenKind === "uncached" ? " (önbellek hariç)" : ""} · Çıktı tokenı: {operation.usage?.outputTokens ?? operation.result?.outputTokens ?? "bilinmiyor"}</small>
      {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.inputTokenKind === "uncached" && <small> · Önbellekten okunan token: {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.cachedInputTokens ?? "bilinmiyor"} · Önbelleğe yazılan token: {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.cacheWriteInputTokens ?? "bilinmiyor"}. Bunlar sağlayıcının bildirdiği ayrı sayaçlardır; fatura tutarı değildir.</small>}
      {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.inputTokenKind === "inclusive" && <small> · Girdi sayacına dahil önbellek tokenı: {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.cachedInputTokens ?? "bilinmiyor"}. Girdi toplamına tekrar eklenmez; fatura tutarı değildir.</small>}
      {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.outputTokenKind === "inclusive" && (operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.inputTokenKind === "inclusive" && <small> · Çıktı sayacına dahil reasoning tokenı: {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.reasoningTokens ?? "bilinmiyor"}. Çıktı toplamına tekrar eklenmez; fatura tutarı değildir.</small>}
      {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.outputTokenKind === "candidates" && <small> · Gemini çıktı sayacı aday yanıt tokenıdır. Ayrı düşünce tokenı: {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.reasoningTokens ?? "bilinmiyor"} · Sağlayıcının bildirdiği toplam: {(operation.usage?.tokenDetails ?? operation.result?.tokenDetails)?.totalTokens ?? "bilinmiyor"}. Eksik sayaçlar hesaplanmaz; fatura tutarı değildir.</small>}
      {operation.errorCode === "private_output_limit_without_text" && <p>Çıktı sınırı görünür yanıt oluşmadan doldu. Sağlayıcı reasoning tokenı kullanmış ve ücretlendirmiş olabilir; otomatik tekrar yapılmaz.</p>}
      {operation.errorCode && <p>Hata kodu: {operation.errorCode}</p>}
      {operation.originBranchId === branch.id && operation.status === "prepared" && <button type="button" disabled={disabled || busy} onClick={() => void act("cancel", operation.id)}>Kuyruktaki gönderimi iptal et</button>}
      {operation.originBranchId === branch.id && ["prepared", "submitted"].includes(operation.status) && <button type="button" disabled={disabled || busy} onClick={() => void act("recover", operation.id)}>İşlem durumunu kurtar</button>}
      {operation.originBranchId === branch.id && operation.status === "outcome_unknown" && <>
        <p>Sağlayıcı işlemi gerçekleştirmiş ve ücretlendirmiş olabilir. Otomatik yeniden gönderim yapılmaz; kaydı kapatmak çağrıyı geri almaz.</p>
        <label><input type="checkbox" checked={acknowledged === operation.id} disabled={disabled || busy} onChange={(event) => setAcknowledged(event.target.checked ? operation.id : null)} />Belirsiz sonucu ve olası ücreti anladım.</label>
        <button type="button" disabled={disabled || busy || acknowledged !== operation.id} onClick={() => void act("discard_unknown", operation.id)}>Belirsiz kaydı kapat</button>
      </>}
    </article>)}
    <button type="button" disabled={disabled || busy} onClick={() => void act("preview")}>Gönderimi incele</button>
    {preview && <section aria-label="Özel gönderim önizlemesi">
      <p>{preview.connectionLabel ?? "Bağlantı yok"} · {preview.provider} · {preview.input.model} · En fazla 1 çağrı / 1024 çıktı tokenı · Kalan dal isteği: {preview.remainingBranchRequests}</p>
      <p>Diğer üyeler, incelemeler, özgün ekler ve önceki konsey bağlamı gönderilmez. Bu sınırlar parasal bütçe veya token kullanım tahmini değildir.</p>
      {preview.provider === "openai" && <p>1024 çıktı sınırına reasoning tokenları da dahildir; görünür yanıt oluşmadan sınır dolabilir. Bu gönderim kayıtlı metin geçmişini kullanır; sağlayıcının reasoning geçmişi taşınmaz.</p>}
      {preview.provider === "google" && <p>Gemini gönderimi kayıtlı metin geçmişini kullanır; düşünce imzaları ve sağlayıcının reasoning geçmişi taşınmaz. Varsayılan düşünme görünür yanıt oluşmadan sınırı tüketebilir; kullanım sayaçları yanıt geldikten sonra ayrı gösterilir.</p>}
      <details><summary>Modele gönderilecek tam içerik</summary><pre>{JSON.stringify(preview.input.messages, null, 2)}</pre></details>
      {preview.blocks.map((reason) => <p key={reason}>{reasons[reason]}</p>)}
      <label><input type="checkbox" disabled={!preview.eligible || disabled || busy} checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />Gönderilecek içeriği, seçili bağlantıyı ve sınırları inceledim.</label>
      <button type="button" disabled={!reviewed || !preview.eligible || disabled || busy} onClick={() => void act("send")}>Kaydedilmiş mesajı modele gönder</button>
      <button type="button" disabled={disabled || busy} onClick={() => { setPreview(null); setReviewed(false); intent.current = null; }}>Önizlemeyi kapat</button>
    </section>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
