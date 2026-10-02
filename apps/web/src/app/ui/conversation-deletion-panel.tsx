"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationDeletionBlock, ConversationDeletionPreview } from "@deliberation-ai/persistence";

const reasons: Record<ConversationDeletionBlock, string> = {
  available_runs: "Konuşmada hâlâ erişilebilir çalışma içerikleri var.",
  private_branches: "Konuşmada saklanan özel dal taslakları var. Özel içerik silme politikası tamamlanmadan bu kayıt silinemez.",
  pending_index: "Eski konuşma kayıtlarının aktarımı tamamlanmayı bekliyor.",
  owner_mismatch: "Konuşma sahipliği doğrulanamadı.",
  retained_references: "Başka kayıtlar hâlâ bu konuşmanın bağlantılarına ihtiyaç duyuyor.",
  too_many_members: "Bu önizleme en fazla 1.000 üyelik kaydı için kullanılabilir.",
  schema_changed: "Kayıt yapısı değişmiş. Silme politikasının güncellenmesi gerekiyor.",
};

export function ConversationDeletionPanel({ conversationId, onDeleted, onCancel }: {
  conversationId: string; onDeleted: () => void; onCancel: () => void;
}) {
  const [preview, setPreview] = useState<ConversationDeletionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const submitting = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void fetch(`/api/conversations/${conversationId}/deletion`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const value = await response.json() as ConversationDeletionPreview & { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Silme önizlemesi yüklenemedi.");
      if (!controller.signal.aborted) { setPreview(value); setError(null); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Silme önizlemesi yüklenemedi.");
    });
    return () => { alive.current = false; controller.abort(); };
  }, [conversationId, refresh]);

  async function remove() {
    if (!preview?.eligible || !preview.fingerprint || !reviewed || submitting.current) return;
    submitting.current = true; setDeleting(true); setError(null);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/deletion`, { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, fingerprint: preview.fingerprint, confirmMetadataDeletion: true }) });
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Konuşma kaydı silinemedi.");
      if (alive.current) onDeleted();
    } catch (cause) {
      if (alive.current) { setError(cause instanceof Error ? cause.message : "Konuşma kaydı silinemedi."); setReviewed(false); setPreview(null); }
    } finally { submitting.current = false; if (alive.current) setDeleting(false); }
  }

  return <section className="settings-card" aria-label="Konuşma kaydını silme önizlemesi">
    <div className="config-heading"><strong>Konuşma kaydını silme önizlemesi</strong>
      <button className="secondary-button" type="button" disabled={deleting} onClick={onCancel}>Vazgeç</button>
    </div>
    <small>Konuşma kimliği: {conversationId}</small>
    <p className="section-hint">Yalnızca tüm çalışma içerikleri kaldırılmış konuşmanın kimliği ve üyelik bağlantıları silinir. Yedeklerde ve indirdiğiniz dosyalarda bulunan kopyalar korunur; geri yükleme bu kayıtları yeniden getirebilir. Bu işlem yeni model isteği göndermez.</p>
    {preview && <>
      <p>{preview.eligible ? `Silinecek: 1 konuşma kaydı ve ${preview.recordedRunCount} üyelik bağlantısı.` : `Konuşmada ${preview.recordedRunCount} üyelik bağlantısı var; silme engellendi.`}</p>
      {preview.blockedReasons.map((reason) => <p className="section-hint" key={reason}>{reasons[reason]}</p>)}
      {preview.eligible && <>
        {preview.memberRunIds.length > 0 && <details><summary>Silinecek üyelik bağlantıları</summary><ul>{preview.memberRunIds.map((id) => <li key={id}>{id}</li>)}</ul></details>}
        <label><input type="checkbox" checked={reviewed} disabled={deleting} onChange={(event) => setReviewed(event.target.checked)} /> Bu konuşmanın kaydını ve üyelik bağlantılarını silmek istiyorum.</label>
        <button className="secondary-button danger-button" type="button" disabled={!reviewed || deleting} onClick={() => void remove()}>{deleting ? "Siliniyor…" : "Konuşma kaydını kalıcı olarak sil"}</button>
      </>}
    </>}
    {!preview && !error && <p className="hint">Silme önizlemesi yükleniyor…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <button className="secondary-button" type="button" disabled={deleting} onClick={() => { setReviewed(false); setPreview(null); setError(null); setRefresh((value) => value + 1); }}>Silme önizlemesini yenile</button>
  </section>;
}
