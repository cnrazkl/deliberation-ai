"use client";

import { ownerFetch } from "../../lib/session-fetch";
import { useEffect, useRef, useState } from "react";
import type { ConversationContentDeletionBlock, ConversationContentDeletionPreview } from "@deliberation-ai/persistence";
import { DeletionDialog } from "./deletion-dialog";

const reasons: Record<ConversationContentDeletionBlock, string> = {
  active_run: "Bu konuşmada hâlâ çalışan bir işlem var. İşlem bittikten sonra silebilirsiniz.",
  pending_operations: "Sağlayıcı sonucu bekleyen veya belirsiz bir işlem var. Önce Ayarlar bölümündeki işlemi sonuçlandırın.",
  pending_delivery: "Özel sohbette sonucu beklenen bir mesaj var. Önce bu işlemi sonuçlandırın.",
  copied_content: "Bu konuşmadan alınmış içerikler başka kayıtlarda kullanılıyor.",
  copied_branches: "Bu özel sohbetten alınmış içerikler başka bir özel sohbette kullanılıyor.",
  retained_references: "Bu konuşmanın bağlantıları başka bir konuşmada kullanılıyor.",
  decision_boundary: "Bu konuşmaya bağlı kaynak değerlendirmesi var; bu işlemle birlikte silinemiyor.",
  pending_index: "Konuşma kayıtlarının aktarımı tamamlanmayı bekliyor.",
  owner_mismatch: "Kayıtların sahipliği doğrulanamadığı için silme durduruldu.",
  schema_changed: "Veri yapısı değiştiği için silme durduruldu.",
  too_many_members: "Bu konuşma tek işlem için desteklenen 100 çalışma ve özel sohbet sınırını aşıyor.",
  inspection_limit: "Bu konuşma güvenli silme incelemesinin boyut sınırını aşıyor.",
  audit_capacity: "Silme kayıtlarının kapasitesi dolduğu için silme durduruldu.",
  invalid_queue_job: "İşlem kaydı doğrulanamadığı için silme durduruldu.",
};
const dependencyNames = { conversation: "Bağlı konuşma", run: "İçeriği kullanan çalışma", private: "İçeriği kullanan özel sohbet", publication: "Kütüphaneye kaydedilmiş kanıt" };

export function ConversationDeletionPanel({ conversationId, onDeleted, onCancel }: {
  conversationId: string; onDeleted: (runIds: string[]) => void; onCancel: () => void;
}) {
  const [preview, setPreview] = useState<ConversationContentDeletionPreview>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false), submitting = useRef(false), reviewedIds = useRef<string[]>([]);
  const deleted = useRef(onDeleted);
  useEffect(() => { deleted.current = onDeleted; }, [onDeleted]);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void ownerFetch(`/api/conversations/${conversationId}/deletion?scope=content`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (response.status === 404) { if (!controller.signal.aborted) deleted.current(reviewedIds.current); return; }
      const value = await response.json() as ConversationContentDeletionPreview & { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Konuşma incelenemedi.");
      if (!controller.signal.aborted) { setPreview(value); reviewedIds.current = value.runIds; setError(undefined); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Konuşma incelenemedi."); });
    return () => { alive.current = false; controller.abort(); };
  }, [conversationId, refresh]);
  function reload() { setPreview(undefined); setError(undefined); setRefresh(value => value + 1); }
  async function remove() {
    if (!preview?.eligible || !preview.fingerprint || submitting.current) return;
    submitting.current = true; setBusy(true); setError(undefined);
    try {
      const response = await ownerFetch(`/api/conversations/${conversationId}/deletion`, { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, fingerprint: preview.fingerprint, confirmContentDeletion: true }) });
      const value = await response.json() as { error?: string; deletedRunIds?: string[] };
      if (!response.ok) throw new Error(value.error ?? "Konuşma silinemedi.");
      if (alive.current) deleted.current(value.deletedRunIds ?? preview.runIds);
    } catch (cause) {
      if (alive.current) { setError(cause instanceof Error ? cause.message : "Sonuç alınamadı. Durumu yenileyerek kontrol edin."); setPreview(undefined); }
    } finally { submitting.current = false; if (alive.current) setBusy(false); }
  }
  return <DeletionDialog title="Konuşmayı Sil" busy={busy} onCancel={onCancel}>
    <section aria-label="Konuşma silme onayı">
      <p className="deletion-question">Bu konuşmayı silmek istediğinize emin misiniz?</p>
      {preview && <>
        <p>{preview.eligible ? `Konuşma, ${preview.runIds.length} çalışma ve ${preview.privateBranchIds.length} özel sohbet ile birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.` : "Silme koşulları kontrol edildi. Aşağıdaki durum çözülmeden konuşma silinemez."}</p>
        {preview.knowledgeRecordCount > 0 && <p>Bu konuşmanın kaynak seçimleri ve hazırlanmış bağlamları da silinir. Kütüphanedeki dosyalar korunur.</p>}
        {preview.blockedReasons.length > 0 && <div className="deletion-blockers" role="status"><strong>Şu Anda Silinemiyor</strong>
          <ul>{preview.blockedReasons.map(reason => <li key={reason}>{reasons[reason]}</li>)}</ul>
        </div>}
        {preview.dependencies.length > 0 && <div className="deletion-blockers"><strong>Bağlı Kayıtlar Korunacak</strong>
          <p>Bu konuşmadan kopyalanmış içerikler aşağıdaki kayıtlarda bulunuyor. Yalnız bu konuşma silinir; diğer kayıtlardaki bağımsız kopyalar kalır.</p>
          <details><summary>Bağlı Kayıtları Göster ({preview.dependencies.length})</summary>
            <ul>{preview.dependencies.map(item => <li key={`${item.kind}:${item.id}`}>{dependencyNames[item.kind]}: <code>{item.id}</code></li>)}</ul>
          </details>
        </div>}
        <p className="section-hint">Kullanım kayıtları, bağımsız kaynaklar, zamanlamalar ve yedeklerdeki kopyalar korunur. Yeni API isteği gönderilmez.</p>
      </>}
      {!preview && !error && <p className="hint" role="status">Konuşma ve bağlantıları kontrol ediliyor…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="deletion-dialog-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Vazgeç</button>
        <button type="button" className="danger-button secondary-button" disabled={busy || !preview?.eligible} onClick={() => void remove()}>{busy ? "Siliniyor…" : "Evet, Konuşmayı Sil"}</button>
      </div>
      {(error || preview && !preview.eligible) && <button type="button" className="secondary-button" disabled={busy} onClick={reload}>Durumu Yenile</button>}
    </section>
  </DeletionDialog>;
}
