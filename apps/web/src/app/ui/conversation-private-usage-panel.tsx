"use client";
import { ownerFetch } from "../../lib/session-fetch";
import { useEffect, useRef, useState } from "react";
import type { ConversationPrivateUsage } from "@deliberation-ai/persistence";
import { PrivateUsageGroups } from "./private-usage-panel";

export function ConversationPrivateUsagePanel({ conversationId }: { conversationId: string }) {
  const [usage, setUsage] = useState<ConversationPrivateUsage>();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null); const generation = useRef(0);
  useEffect(() => () => { generation.current++; active.current?.abort(); }, []);
  async function refresh() {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const current = ++generation.current; setBusy(true); setError(""); setUsage(undefined);
    try {
      const response = await ownerFetch(`/api/conversations/${conversationId}/private-usage`, { cache: "no-store", signal: controller.signal });
      const body = await response.json() as { usage: ConversationPrivateUsage; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Konuşma kullanımı okunamadı.");
      if (current === generation.current && !controller.signal.aborted) setUsage(body.usage);
    } catch (caught) {
      if (current === generation.current && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Konuşma kullanımı okunamadı.");
    } finally { if (current === generation.current) setBusy(false); }
  }
  return <details className="composer-disclosure private-usage-summary" aria-label="Konuşmanın özel kullanım özeti">
    <summary>Konuşmadaki tüm özel dalların token kullanımı</summary>
    <p className="section-hint">Bu konuşmanın özel gönderimleri bir kez sayılır. Silinen dalların saklanan kullanım kayıtları dahildir; konsey çağrıları dahil değildir. Eksikler sıfır sayılmaz. Fatura veya parasal bütçe değildir.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Kullanım okunuyor…" : "Konuşma kullanımını getir"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {usage ? <>
      <p>Özetin alındığı zaman: {new Date(usage.checkedAt).toLocaleString("tr-TR")}. Yeni gönderim veya silme sonrasında tekrar getirin.</p>
      <p>Saklanan dal: {usage.retainedBranches} · Silinen dal kaydı: {usage.deletedBranches}</p>
      <p>Asıl gönderim kaydı: {usage.ownReceipts} · Sağlayıcıya gönderim kaydı: {usage.submittedAttempts}</p>
      <p>Kopyalanan kayıt: {usage.copiedReceipts} · Kopyalar tekrar sayılmaz.</p>
      {usage.unattributedCopies > 0 ? <p role="status">Asıl kaydı bulunamayan kopya: {usage.unattributedCopies}. Bunların kullanımı hesaplanmadı; konuşma kapsamı eksik.</p> : null}
      <p>Bekleyen kayıt: {usage.pending} · Sonucu belirsiz veya kapatılmış belirsiz kayıt: {usage.uncertain}</p>
      <p className="section-hint">Bağlantı, bildirilen model ve sayaç türleri ayrı tutulur. Bildirilmemiş model kimliği bilinmiyor olarak gösterilir.</p>
      {usage.groups.length === 0 ? <p>Sağlayıcıya gönderim kaydı yok; kullanım hesaplanmadı.</p> : null}
      <PrivateUsageGroups groups={usage.groups} />
    </> : null}
  </details>;
}
