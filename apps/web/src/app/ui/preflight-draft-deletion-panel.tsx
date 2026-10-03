"use client";
import { useEffect, useRef, useState } from "react";
import type { PreflightDraftDeletionPreview } from "@deliberation-ai/persistence";

export function PreflightDraftDeletionPanel({ draftId, onCancel, onDeleted, onBusy }: {
  draftId: string; onCancel: () => void; onDeleted: () => void; onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<PreflightDraftDeletionPreview>();
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>(); const [refresh, setRefresh] = useState(0);
  const alive = useRef(true); const submitting = useRef(false);
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    void fetch(`/api/preflight-drafts/${draftId}/deletion`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Silme önizlemesi yüklenemedi.");
        if (!controller.signal.aborted) {
          if (body.alreadyDeleted) { onDeleted(); return; }
          setPreview(body); setError(undefined);
        }
      }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Önizleme yüklenemedi."); });
    return () => { alive.current = false; controller.abort(); };
  }, [draftId, refresh, onDeleted]);
  async function remove() {
    if (!preview?.eligible || !preview.fingerprint || !reviewed || submitting.current) return;
    submitting.current = true; setBusy(true); onBusy(true); setError(undefined);
    try {
      const response = await fetch(`/api/preflight-drafts/${draftId}/deletion`, {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ draftId, fingerprint: preview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedRecords: true }),
      });
      const body = await response.json();
      if (!response.ok) { if (alive.current) { setPreview(undefined); setReviewed(false); } throw new Error(body.error ?? "Taslak silinemedi."); }
      if (alive.current) onDeleted();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Silme tamamlanamadı."); }
    finally { submitting.current = false; onBusy(false); if (alive.current) setBusy(false); }
  }
  return <section aria-label="Ön kontrol taslağı silme önizlemesi">
    <h3>Ön kontrol taslağı silme önizlemesi</h3><p>Taslak: {draftId}</p>
    <p>Bu taslağın kayıtlı sorusu ve şifreli istek içeriği kaldırılır. İstek içindeki ek dosya kopyaları ve seçilen ayarlar da temizlenir.</p>
    <p>Kimlik, tekrar gönderimi engelleyen istek anahtarı ve özeti, zaman bilgileri ve metin içermeyen silme kaydı saklanır. Başlamış çalışmalar, ayrı bellek ve araç kayıtları, yedekler ve dışa aktarılan dosyalar silinmez. Eski bir yedeği geri yüklemek içeriği geri getirebilir.</p>
    {preview ? <>
      <p>Kayıtlı soru: {preview.hasQuestion ? "var" : "zaten temizlenmiş"}. Kayıtlı istek: {preview.hasRequest ? "var" : "zaten temizlenmiş"}.</p>
      {preview.retainedRunId && <p>Korunan çalışma: {preview.retainedRunId}. Bu işlem çalışmayı durdurmaz veya silmez.</p>}
      {preview.blockedReasons.map((reason) => <p key={reason}>{reason === "schema_changed" ? "Kayıt yapısı değişmiş; silme politikası yeniden incelenmeli." : "Kayıt durumu veya sahipliği doğrulanamadı."}</p>)}
      {preview.eligible && <>
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} /> Taslak içeriğini silmek ve belirtilen kayıtları saklamak istiyorum.</label>
        <button type="button" disabled={!reviewed || busy} onClick={() => void remove()}>Taslak içeriğini kalıcı olarak sil</button>
      </>}
    </> : !error ? <p>Silme önizlemesi yükleniyor…</p> : null}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { setPreview(undefined); setReviewed(false); setError(undefined); setRefresh((value) => value + 1); }}>Silme önizlemesini yenile</button>
    <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Silme incelemesini kapat</button>
  </section>;
}
