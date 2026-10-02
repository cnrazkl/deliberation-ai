"use client";
import { useEffect, useRef, useState } from "react";
import type { PrivateBranchDeletionPreview, PrivateBranchDeletionBlock } from "@deliberation-ai/persistence";
const reasons: Record<PrivateBranchDeletionBlock, string> = {
  copied_branches: "Bu daldan kopyalanmış dallar var. Önce aşağıdaki kopyaları ayrı ayrı inceleyin ve silin.",
  pending_delivery: "Kuyrukta, gönderilmiş veya sonucu belirsiz bir işlem var. Önce işlem durumunu çözün.",
  schema_changed: "Kayıt yapısı değişmiş; silme politikası yeniden değerlendirilmelidir.",
  inspection_limit: "Kopya denetiminin güvenli inceleme sınırı aşıldı. Silme yapılmayacak.",
  audit_capacity: "Saklanan silme kayıtlarının kapasitesi doldu. Silme yapılmayacak.",
  owner_mismatch: "Özel kayıtların sahipliği doğrulanamadı. Silme yapılmayacak.",
};
export function PrivateBranchDeletionPanel({ branchId, onDeleted, onCancel, onBusy }: {
  branchId: string; onDeleted: () => void; onCancel: () => void; onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<PrivateBranchDeletionPreview | null>(null);
  const [error, setError] = useState<string | null>(null); const [reviewed, setReviewed] = useState(false);
  const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false);
  const alive = useRef(true); const submitting = useRef(false);
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    void fetch(`/api/private-branches/${branchId}/deletion`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Silme önizlemesi yüklenemedi.");
      if (!controller.signal.aborted) { setPreview(value); setError(null); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Önizleme yüklenemedi."); });
    return () => { alive.current = false; controller.abort(); };
  }, [branchId, refresh]);
  async function remove() {
    if (!reviewed || !preview?.eligible || !preview.fingerprint || submitting.current) return;
    submitting.current = true; setBusy(true); onBusy(true); setError(null);
    try {
      const response = await fetch(`/api/private-branches/${branchId}/deletion`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, fingerprint: preview.fingerprint, confirmContentDeletion: true, acknowledgeRetainedMetadata: true }) });
      const value = await response.json();
      if (!response.ok) {
        if (alive.current) { setPreview(null); setReviewed(false); }
        throw new Error(value.error ?? "Özel dal silinemedi.");
      }
      if (alive.current) onDeleted();
    } catch (cause) {
      // A lost committed response retains the reviewed fingerprint. A manual
      // repeat returns the existing content-free audit, never a different target.
      if (alive.current) setError(cause instanceof Error ? cause.message : "Silme tamamlanamadı.");
    } finally { submitting.current = false; onBusy(false); if (alive.current) setBusy(false); }
  }
  return <section aria-label="Özel dal silme önizlemesi">
    <strong>Özel dal silme önizlemesi</strong><p>Dal: {branchId}</p>
    <p>Bu dalın kopyalanan kaynak metni, kaydedilmiş mesajları ve yanıtları kaldırılır. Kaynak konsey raporu, diğer dallar, yedekler ve indirdiğiniz dosyalar korunur; eski yedek geri yüklenirse içerik geri gelebilir.</p>
    <p>Metin içermeyen işlem kimlikleri, durumlar ve varsa kullanım sayaçları şifreli silme kaydında saklanır. Bu işlem sağlayıcı çağrısını veya olası ücreti geri almaz. Kuyrukta kalan kimlik kayıtları model çağrısı yapmadan sona erer.</p>
    {preview && <>
      <p>{preview.messageCount} kaydedilmiş mesajın ve {preview.receiptCount} gönderimin metni kaldırılacak. {preview.ownReceiptCount} gönderim bu dala aittir; kopya kayıtlar ayrı işaretli tutulur.</p>
      {preview.blockedReasons.map((reason) => <p key={reason}>{reasons[reason]}</p>)}
      {preview.copiedBranchIds.length > 0 && <ul>{preview.copiedBranchIds.map((id) => <li key={id}>{id}</li>)}</ul>}
      {preview.eligible && <>
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} /> Dal içeriğini silmek ve belirtilen kullanım kayıtları ile dış kopyaları korumak istiyorum.</label>
        <button type="button" disabled={!reviewed || busy} onClick={() => void remove()}>Özel dal içeriğini kalıcı olarak sil</button>
      </>}
    </>}
    {!preview && !error && <p>Silme önizlemesi yükleniyor…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <button type="button" disabled={busy} onClick={() => { setPreview(null); setReviewed(false); setError(null); setRefresh((value) => value + 1); }}>Silme önizlemesini yenile</button>
    <button type="button" disabled={busy} onClick={onCancel}>Silmeden vazgeç</button>
  </section>;
}
