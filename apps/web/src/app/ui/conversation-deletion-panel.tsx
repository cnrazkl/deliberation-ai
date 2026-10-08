"use client";

import { ownerFetch } from "../../lib/session-fetch";
import { useEffect, useRef, useState } from "react";
import type { ConversationDeletionBlock, ConversationDeletionPreview } from "@deliberation-ai/persistence";
import { RunDeletionPanel } from "./run-deletion-panel";
import { PrivateBranchDeletionPanel } from "./private-branch-deletion-panel";

const reasons: Record<ConversationDeletionBlock, string> = {
  available_runs: "Önce aşağıdaki çalışma içeriklerini ayrı ayrı inceleyip silin; ardından konuşma kaydını kaldırabilirsiniz.",
  private_branches: "Önce aşağıdaki özel dalları ayrı ayrı inceleyip silin. Kaynaklarını kullanan kopyalar varsa en son dallardan başlayın.",
  pending_index: "Eski konuşma kayıtlarının aktarımı tamamlanmayı bekliyor.",
  owner_mismatch: "Konuşma sahipliği doğrulanamadı.",
  retained_references: "Başka kayıtlar hâlâ bu konuşmanın bağlantılarına ihtiyaç duyuyor.",
  too_many_members: "Bu önizleme en fazla 1.000 çalışma veya 1.000 özel dal için kullanılabilir.",
  schema_changed: "Kayıt yapısı değişmiş. Silme politikasının güncellenmesi gerekiyor.",
};

export function ConversationDeletionPanel({ conversationId, onDeleted, onDeletedRun, onCancel }: {
  conversationId: string; onDeleted: () => void; onDeletedRun: (id: string) => void; onCancel: () => void;
}) {
  const [preview, setPreview] = useState<ConversationDeletionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [contentReview, setContentReview] = useState<{ kind: "run" | "private"; id: string } | null>(null);
  const [contentBusy, setContentBusy] = useState(false);
  const submitting = useRef(false);
  const alive = useRef(false);
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "start" });
  }, []);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void ownerFetch(`/api/conversations/${conversationId}/deletion`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const value = await response.json() as ConversationDeletionPreview & { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Silme önizlemesi yüklenemedi.");
      if (!controller.signal.aborted) { setPreview(value); setError(null); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Silme önizlemesi yüklenemedi.");
    });
    return () => { alive.current = false; controller.abort(); };
  }, [conversationId, refresh]);

  function reload() {
    setReviewed(false); setPreview(null); setError(null); setRefresh((value) => value + 1);
  }

  function contentDeleted() {
    if (contentReview?.kind === "run") onDeletedRun(contentReview.id);
    setContentReview(null); reload();
  }

  async function remove() {
    if (!preview?.eligible || !preview.fingerprint || !reviewed || contentReview || submitting.current) return;
    submitting.current = true; setDeleting(true); setError(null);
    try {
      const response = await ownerFetch(`/api/conversations/${conversationId}/deletion`, { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, fingerprint: preview.fingerprint, confirmMetadataDeletion: true }) });
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Konuşma kaydı silinemedi.");
      if (alive.current) onDeleted();
    } catch (cause) {
      if (alive.current) { setError(cause instanceof Error ? cause.message : "Konuşma kaydı silinemedi."); setReviewed(false); setPreview(null); }
    } finally { submitting.current = false; if (alive.current) setDeleting(false); }
  }

  return <section ref={panel} tabIndex={-1} className="settings-card" aria-label="Konuşma kaydını silme önizlemesi">
    <div className="config-heading"><strong>Konuşma kaydını silme önizlemesi</strong>
      <button className="secondary-button" type="button" disabled={deleting || contentBusy} onClick={onCancel}>Vazgeç</button>
    </div>
    <small>Konuşma kimliği: {conversationId}</small>
    <p className="section-hint">İçeriği olan konuşmalarda önce özel dalları ve çalışma içeriklerini ayrı onaylarla silin, ardından konuşma kaydını kaldırın. Her adımda silinecek içerik ve engeller gösterilir. Yedeklerde ve indirdiğiniz dosyalarda bulunan kopyalar korunur; geri yükleme bu kayıtları yeniden getirebilir. Bu işlem yeni model isteği göndermez.</p>
    {preview && <>
      <p>{preview.eligible ? `Silinecek: 1 konuşma kaydı ve ${preview.recordedRunCount} üyelik bağlantısı.` : `Konuşmada ${preview.recordedRunCount} üyelik bağlantısı var; silme engellendi.`}</p>
      {preview.blockedReasons.map((reason) => <p className="section-hint" key={reason}>{reasons[reason]}</p>)}
      {!!preview.privateBranchIds?.length && <div className="run-history-list" aria-label="Silinebilecek özel dalları incele">
        {preview.privateBranchIds.map((id) => <article key={id} data-private-branch-id={id}><small>Özel dal: {id}</small>
          <button className="secondary-button" type="button" disabled={Boolean(contentReview) || deleting}
            onClick={() => { setReviewed(false); setContentReview({ kind: "private", id }); }}>Özel dal silmeyi incele</button>
        </article>)}
      </div>}
      {!!preview.availableRunIds?.length && <div className="run-history-list" aria-label="Silinebilecek çalışmaları incele">
        {preview.availableRunIds.map((id) => <article key={id} data-run-id={id}><small>Çalışma: {id}</small>
          <button className="secondary-button" type="button" disabled={Boolean(contentReview) || deleting}
            onClick={() => { setReviewed(false); setContentReview({ kind: "run", id }); }}>Çalışma silmeyi incele</button>
        </article>)}
      </div>}
      {preview.eligible && <>
        {preview.memberRunIds.length > 0 && <details><summary>Silinecek üyelik bağlantıları</summary><ul>{preview.memberRunIds.map((id) => <li key={id}>{id}</li>)}</ul></details>}
        <label><input type="checkbox" checked={reviewed} disabled={deleting} onChange={(event) => setReviewed(event.target.checked)} /> Bu konuşmanın kaydını ve üyelik bağlantılarını silmek istiyorum.</label>
        <button className="secondary-button danger-button" type="button" disabled={!reviewed || deleting} onClick={() => void remove()}>{deleting ? "Siliniyor…" : "Konuşma kaydını kalıcı olarak sil"}</button>
      </>}
    </>}
    {!preview && !error && <p className="hint">Silme önizlemesi yükleniyor…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {contentReview?.kind === "run" && <RunDeletionPanel key={contentReview.id} runId={contentReview.id} onBusy={setContentBusy}
      onCancel={() => setContentReview(null)} onDeleted={contentDeleted} />}
    {contentReview?.kind === "private" && <PrivateBranchDeletionPanel key={contentReview.id} branchId={contentReview.id} onBusy={setContentBusy}
      onCancel={() => setContentReview(null)} onDeleted={contentDeleted} />}
    <button className="secondary-button" type="button" disabled={deleting || Boolean(contentReview)} onClick={reload}>Silme önizlemesini yenile</button>
  </section>;
}
