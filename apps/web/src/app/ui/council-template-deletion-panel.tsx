"use client";
import { ownerFetch } from "../../lib/session-fetch";
import { useEffect, useRef, useState } from "react";
import type { CouncilTemplateDeletionPreview } from "@deliberation-ai/persistence";

export function CouncilTemplateDeletionPanel({ templateId, onCancel, onDeleted, onBusy }: {
  templateId: string; onCancel: () => void; onDeleted: () => void; onBusy: (value: boolean) => void;
}) {
  const [preview, setPreview] = useState<CouncilTemplateDeletionPreview>();
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>(); const [refresh, setRefresh] = useState(0);
  const alive = useRef(true); const submitting = useRef(false);
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    void ownerFetch(`/api/council-templates/${templateId}/deletion`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Silme önizlemesi yüklenemedi.");
      if (!controller.signal.aborted) {
        if (body.alreadyDeleted) { onDeleted(); return; }
        setPreview(body); setError(undefined);
      }
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Önizleme yüklenemedi."); });
    return () => { alive.current = false; controller.abort(); };
  }, [templateId, refresh, onDeleted]);
  async function remove() {
    if (!preview?.eligible || !preview.fingerprint || !reviewed || submitting.current) return;
    submitting.current = true; setBusy(true); onBusy(true); setError(undefined);
    try {
      const response = await ownerFetch(`/api/council-templates/${templateId}/deletion`, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId, fingerprint: preview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedCopies: true }) });
      const body = await response.json();
      if (!response.ok) { if (alive.current) { setPreview(undefined); setReviewed(false); } throw new Error(body.error ?? "Şablon silinemedi."); }
      if (alive.current) onDeleted();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Silme tamamlanamadı."); }
    finally { submitting.current = false; onBusy(false); if (alive.current) setBusy(false); }
  }
  return <section aria-label="Şablon silme önizlemesi">
    <h3>Şablon silme önizlemesi</h3><p>Şablon kimliği: {templateId}</p>
    <p>Yalnız bu kayıtlı şablonun adı, açıklaması ve üye ayarları kaldırılır. Seçili konseyiniz ve taslak sorunuz korunur.</p>
    <p>Önceki çalışmalar ve zamanlamalar kendi kopyalarını saklar; kuyruktaki işler durmaz. Yedekler ve dışa aktarılan dosyalar silinmez. Oluşturma isteğinin kimliği/özeti ve şifreli silme kaydı saklanır.</p>
    {preview ? <>
      <p>{preview.name} · {preview.memberCount} üye</p>
      {preview.blockedReasons.length > 0 && <p>Kayıt yapısı değişmiş; silme politikası yeniden incelenmeli.</p>}
      {preview.eligible && <>
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} /> Şablon içeriğini silmek, bağımsız kopyaları saklamak istiyorum.</label>
        <button type="button" disabled={!reviewed || busy} onClick={() => void remove()}>Şablon içeriğini kalıcı olarak sil</button>
      </>}
    </> : !error ? <p>Silme önizlemesi yükleniyor…</p> : null}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => { setPreview(undefined); setReviewed(false); setError(undefined); setRefresh((value) => value + 1); }}>Silme önizlemesini yenile</button>
    <button type="button" disabled={busy} onClick={onCancel}>Silme incelemesini kapat</button>
  </section>;
}
