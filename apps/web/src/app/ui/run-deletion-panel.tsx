"use client";
import { useEffect, useRef, useState } from "react";
import type { RunDeletionPreview, RunDeletionBlock } from "@deliberation-ai/persistence";
const labels: Record<RunDeletionBlock, string> = {
  active_run: "Çalışma sırada veya çalışıyor; bu durumda silinemez.",
  pending_operations: "Bekleyen veya sonucu belirsiz bir sağlayıcı işlemi var. Önce durumunu çözün.",
  decision_boundary: "Karar değerlendirmesi içeren çalışmalar bu silme sürümünün dışında.",
  copied_content: "Bu içeriği kullanan çalışma veya özel dal kopyaları var. Önce bunları ayrı ayrı inceleyin.",
  owner_mismatch: "Bağlı kayıtların sahipliği veya ilişkileri doğrulanamadı.", pending_index: "Konuşma indeksinin tamamlanması gerekiyor.",
  schema_changed: "Kayıt yapısı değişmiş; silme politikası yeniden değerlendirilmelidir.",
  inspection_limit: "Güvenli inceleme sınırı aşıldı; silme yapılmayacak.", audit_capacity: "Saklanan silme kayıtlarının kapasitesi doldu.",
  invalid_queue_job: "Kuyruk kaydı doğrulanamadı.",
};
export function RunDeletionPanel({ runId, onCancel, onDeleted, onBusy }: {
  runId: string; onCancel: () => void; onDeleted: () => void; onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<RunDeletionPreview | null>(null); const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const alive = useRef(true); const submitting = useRef(false);
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    void fetch(`/api/runs/${runId}/deletion`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Silme önizlemesi yüklenemedi.");
      if (!controller.signal.aborted) { setPreview(value); setError(null); }
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Önizleme yüklenemedi."); });
    return () => { alive.current = false; controller.abort(); };
  }, [runId, refresh]);
  async function remove() {
    if (!preview?.eligible || !preview.fingerprint || !reviewed || submitting.current) return;
    submitting.current = true; setBusy(true); onBusy(true); setError(null);
    try {
      const response = await fetch(`/api/runs/${runId}/deletion`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, fingerprint: preview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedRecords: true }) });
      const value = await response.json();
      if (!response.ok) { if (alive.current) { setPreview(null); setReviewed(false); } throw new Error(value.error ?? "Çalışma silinemedi."); }
      if (alive.current) onDeleted();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Silme tamamlanamadı."); }
    finally { submitting.current = false; onBusy(false); if (alive.current) setBusy(false); }
  }
  return <section aria-label="Çalışma içeriği silme önizlemesi">
    <strong>Çalışma içeriği silme önizlemesi</strong><p>Çalışma: {runId}</p>
    <p>Bu çalışmanın sorusu, raporu, ham yanıtları, ekleri, kayıtlı bağlamı, iddia/kaynak ve bellek kayıtları kaldırılır. Konuşma kimliği ve kullanım izleri saklanır.</p>
    <p>Şifreli silme kaydı işlem kimliklerini ve varsa kullanım sayaçlarını korur; ücret iadesi yapmaz. Fatura kayıtları, ayrı ön kontrol soruları, zamanlama şablonları, araç sonuçları, yedekler ve indirdiğiniz dosyalar saklanır. Eski yedek içerikleri geri getirebilir.</p>
    {preview && <>
      <p>{Object.values(preview.contentCounts).reduce((sum, count) => sum + count, 0)} içerik kaydı kaldırılacak; {preview.receiptCount} sağlayıcı işleminin metin içermeyen kullanım kaydı korunacak.</p>
      <p>{preview.retainedPreflightCount} ön kontrol kaydı, {preview.retainedScheduleCount} zamanlama ve {preview.retainedBillingCount} fatura kaydı saklanacak.</p>
      {preview.blockedReasons.map((reason) => <p key={reason}>{labels[reason]}</p>)}
      {!!preview.copiedRunIds.length && <p>Kopya çalışmalar: {preview.copiedRunIds.join(", ")}</p>}
      {!!preview.privateBranchIds.length && <p>Özel dallar: {preview.privateBranchIds.join(", ")}</p>}
      {preview.eligible && <>
        <label><input type="checkbox" disabled={busy} checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> Çalışma içeriğini silmek ve belirtilen kayıtları saklamak istiyorum.</label>
        <button type="button" disabled={!reviewed || busy} onClick={() => void remove()}>Çalışma içeriğini kalıcı olarak sil</button>
      </>}
    </>}
    {!preview && !error && <p>Silme önizlemesi yükleniyor…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <button type="button" disabled={busy} onClick={() => { setPreview(null); setReviewed(false); setError(null); setRefresh((value) => value + 1); }}>Silme önizlemesini yenile</button>
    <button type="button" disabled={busy} onClick={onCancel}>Silmeden vazgeç</button>
  </section>;
}
