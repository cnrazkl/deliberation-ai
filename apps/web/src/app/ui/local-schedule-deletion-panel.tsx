"use client";
import { useEffect, useRef, useState } from "react";
import type { LocalScheduleDeletionPreview } from "@deliberation-ai/persistence";

export function LocalScheduleDeletionPanel({ scheduleId, onCancel, onDeleted, onBusy }: {
  scheduleId: string; onCancel: () => void; onDeleted: () => void; onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<LocalScheduleDeletionPreview>();
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>(); const [refresh, setRefresh] = useState(0);
  const alive = useRef(true); const submitting = useRef(false);
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    void fetch(`/api/local-schedules/${scheduleId}/deletion`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Silme önizlemesi yüklenemedi.");
        if (!controller.signal.aborted) {
          if (body.alreadyDeleted) { onDeleted(); return; }
          setPreview(body); setError(undefined);
        }
      }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Önizleme yüklenemedi."); });
    return () => { alive.current = false; controller.abort(); };
  }, [scheduleId, refresh, onDeleted]);
  async function remove() {
    if (!preview?.eligible || !preview.fingerprint || !reviewed || submitting.current) return;
    submitting.current = true; setBusy(true); onBusy(true); setError(undefined);
    try {
      const response = await fetch(`/api/local-schedules/${scheduleId}/deletion`, {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ scheduleId, fingerprint: preview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedRuns: true }),
      });
      const body = await response.json();
      if (!response.ok) { if (alive.current) { setPreview(undefined); setReviewed(false); } throw new Error(body.error ?? "Zamanlama silinemedi."); }
      if (alive.current) onDeleted();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Silme tamamlanamadı."); }
    finally { submitting.current = false; onBusy(false); if (alive.current) setBusy(false); }
  }
  return <section aria-label="Zamanlama silme önizlemesi">
    <h3>Zamanlama silme önizlemesi</h3><p>Zamanlama: {scheduleId}</p>
    <p>Bu zamanlamanın adı, sorusu, konsey üyeleri ve çalışma sınırları kaldırılır. Zamanlama önce duraklatılmalıdır.</p>
    <p>Zamanlama kimliği, oluşturma isteğinin kimliği/özeti ve şifreli silme kaydı saklanır. Önceden kuyruğa alınmış çalışmalar durmaz; sonuçları ve kullanım kayıtları korunur. Yedekler ve dışa aktarılan dosyalar silinmez. Eski bir yedek içeriği geri getirebilir.</p>
    {preview ? <>
      <p>{preview.retainedRunCount} kayıtlı çalışma korunacak.</p>
      {preview.retainedLastRunId && <p>Korunan çalışma: {preview.retainedLastRunId}. Bu işlem çalışmayı durdurmaz veya silmez.</p>}
      {preview.blockedReasons.map((reason) => <p key={reason}>{reason === "active_schedule" ? "Önce zamanlamayı duraklatıp silme önizlemesini yeniden açın." : reason === "schema_changed" ? "Kayıt yapısı değişmiş; silme politikası yeniden incelenmeli." : "Kayıt durumu veya sahipliği doğrulanamadı."}</p>)}
      {preview.eligible && <>
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} /> Zamanlama içeriğini silmek ve önceki çalışmaları saklamak istiyorum.</label>
        <button type="button" disabled={!reviewed || busy} onClick={() => void remove()}>Zamanlama içeriğini kalıcı olarak sil</button>
      </>}
    </> : !error ? <p>Silme önizlemesi yükleniyor…</p> : null}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { setPreview(undefined); setReviewed(false); setError(undefined); setRefresh((value) => value + 1); }}>Silme önizlemesini yenile</button>
    <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Silme incelemesini kapat</button>
  </section>;
}
