"use client";
import { useEffect, useState } from "react";
import type { ConversationView } from "@deliberation-ai/persistence";

export function ConversationPanel({ runId, onOpenRun }: { runId: string; onOpenRun: (id: string) => Promise<void> }) {
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/runs/${runId}/conversation`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json() as ConversationView & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Konuşma yüklenemedi.");
      if (!controller.signal.aborted) { setConversation(body); setError(null); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Konuşma yüklenemedi."); });
    return () => controller.abort();
  }, [runId, refresh]);
  async function download(format: "json" | "md" = "json") {
    if (!conversation || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/conversations/${conversation.conversationId}/export?format=${format}`, { method: "POST", cache: "no-store" });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Konuşma indirilemedi."); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url;
      link.download = `deliberationai-conversation-${conversation.conversationId}.${format}`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Konuşma indirilemedi."); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true);
    try { await onOpenRun(id); } catch { setError("Çalışma açılamadı."); }
    finally { setBusy(false); }
  }
  return <section className="settings-card" aria-label="Konuşma kaydı">
    <div className="config-heading"><strong>Konuşma</strong>
      <button className="secondary-button" type="button" disabled={!conversation || busy} onClick={() => void download()}>{busy ? "Hazırlanıyor…" : "Konuşmayı indir (JSON)"}</button>
      <button className="secondary-button" type="button" disabled={!conversation || busy} onClick={() => void download("md")}>Konuşmayı indir (MD)</button>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Konuşmayı yenile</button>
    </div>
    <p className="section-hint">Dosya, bu konuşmanın tüm kayıtlı çalışmalarını, özel dal taslaklarını, ham yanıtlarını ve saklanan özgün geçmişini okunabilir metin olarak içerir. Silinen çalışmalar eksik olarak belirtilir; devam edenlerin o anki durumu alınır. Ayrı ek dosyalar ve harici kaynak kayıtları dahil edilmez.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {conversation && <>
      <small>Konuşma kimliği: {conversation.conversationId}</small>
      <p>{conversation.runs.length} çalışma · {conversation.runs.filter((item) => item.detail === null).length} erişilemeyen çalışma</p>
      {conversation.origin === "legacy-reconstructed" && <p className="section-hint">Eski kayıtlar mevcut kaynak bağlantılarıyla birleştirildi. Aktarımdan önce silinen bağlantılar nedeniyle geçmişin tamamı yeniden kurulamayabilir.</p>}
      {conversation.unavailableSourceRunIds.length > 0 && <p className="section-hint">Kaydı bulunamayan önceki kaynaklar: {conversation.unavailableSourceRunIds.join(", ")}</p>}
      <details><summary>Konuşmadaki tüm çalışmaları göster</summary>
        <div className="run-history-list">{conversation.runs.map((item) => <article key={item.runId} className="run-history-item">
          <div><strong>{item.detail?.question ?? "Çalışmanın içeriği artık erişilebilir değil"}</strong><small>{item.runId}</small></div>
          {item.detail && <button className="secondary-button" type="button" disabled={busy || item.runId === runId} onClick={() => void open(item.runId)}>{item.runId === runId ? "Açık çalışma" : "Konuşmadaki çalışmayı aç"}</button>}
        </article>)}</div>
      </details>
    </>}
  </section>;
}
