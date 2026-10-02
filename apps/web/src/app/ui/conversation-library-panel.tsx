"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationLibraryPage } from "@deliberation-ai/persistence";
import { ConversationDeletionPanel } from "./conversation-deletion-panel";
import { PrivateBranchesPanel } from "./private-branches-panel";

export function ConversationLibraryPanel({ refreshKey, onOpenRun }: {
  refreshKey: number; onOpenRun: (id: string) => Promise<void>;
}) {
  const [page, setPage] = useState<ConversationLibraryPage>({ conversations: [], nextCursor: null });
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletionId, setDeletionId] = useState<string | null>(null);
  const [privateId, setPrivateId] = useState<string | null>(null);
  const generation = useRef(0);
  const olderRequest = useRef<AbortController | null>(null);
  const openingRequest = useRef(false);
  const initialRequest = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    initialRequest.current = true;
    olderRequest.current?.abort();
    const controller = new AbortController();
    void fetch("/api/conversations", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json() as ConversationLibraryPage & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Konuşmalar yüklenemedi.");
      if (!controller.signal.aborted && current === generation.current) { setPage(body); setError(null); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && current === generation.current) setError(cause instanceof Error ? cause.message : "Konuşmalar yüklenemedi.");
    }).finally(() => {
      if (!controller.signal.aborted && current === generation.current) { initialRequest.current = false; setLoading(false); setOlderLoading(false); }
    });
    return () => { controller.abort(); olderRequest.current?.abort(); };
  }, [refreshKey, refresh]);

  async function older() {
    if (!page.nextCursor || olderRequest.current || loading || initialRequest.current) return;
    const controller = new AbortController();
    olderRequest.current = controller;
    const current = generation.current;
    setOlderLoading(true); setError(null);
    try {
      const response = await fetch(`/api/conversations?before=${encodeURIComponent(page.nextCursor)}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json() as ConversationLibraryPage & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Eski konuşmalar yüklenemedi.");
      if (!controller.signal.aborted && current === generation.current) setPage((value) => ({
        conversations: [...value.conversations, ...body.conversations.filter((item) => !value.conversations.some((existing) => existing.conversationId === item.conversationId))],
        nextCursor: body.nextCursor,
      }));
    } catch (cause) {
      if (!controller.signal.aborted && current === generation.current) setError(cause instanceof Error ? cause.message : "Eski konuşmalar yüklenemedi.");
    } finally {
      if (olderRequest.current === controller) olderRequest.current = null;
      if (current === generation.current) setOlderLoading(false);
    }
  }

  async function open(runId: string) {
    if (openingRequest.current) return;
    openingRequest.current = true;
    setOpening(runId); setError(null);
    try { await onOpenRun(runId); }
    catch { setError("Konuşmadaki çalışma açılamadı. Listeyi yenileyip tekrar deneyebilirsiniz."); }
    finally { openingRequest.current = false; setOpening(null); }
  }

  function reload() {
    setDeletionId(null);
    ++generation.current;
    olderRequest.current?.abort(); olderRequest.current = null;
    setLoading(true); setOlderLoading(false); setError(null);
    setRefresh((value) => value + 1);
  }

  return <section className="settings-card" aria-label="Kayıtlı konuşmalar">
    <div className="config-heading"><strong>Kayıtlı konuşmalar</strong>
      <button className="secondary-button" type="button" disabled={loading} onClick={reload}>Konuşma listesini yenile</button>
    </div>
    <p className="section-hint">Her konuşmanın son erişilebilir çalışmasını açabilirsiniz. Soru taslağı ve model seçimleri korunur; yeni model isteği gönderilmez.</p>
    {loading ? <p className="hint">Konuşmalar yükleniyor…</p> : <div className="run-history-list">
      {page.conversations.length === 0 && !error && <p className="hint">Henüz kayıtlı konuşma yok.</p>}
      {page.conversations.map((item) => <article key={item.conversationId} data-conversation-id={item.conversationId}>
        <div><strong>{item.latestAvailableRun?.question ?? "Bu konuşmanın çalışma içerikleri artık erişilebilir değil"}</strong>
          <small>{new Date(item.createdAt).toLocaleString("tr-TR")} · {item.recordedRunCount} çalışma · {item.unavailableRunCount} erişilemeyen içerik</small>
          {item.origin === "legacy-reconstructed" && <small>Eski kayıtlar mevcut bağlantılarından birleştirildi; eksik geçmiş bulunabilir.</small>}
        </div>
        <button className="secondary-button" type="button" disabled={!item.latestAvailableRun || Boolean(opening)}
          onClick={() => item.latestAvailableRun && void open(item.latestAvailableRun.runId)}>
          {opening === item.latestAvailableRun?.runId ? "Açılıyor…" : item.latestAvailableRun ? "Konuşmayı aç" : "İçerik erişilemiyor"}
        </button>
        {item.availableRunCount === 0 && <button className="secondary-button" type="button" disabled={Boolean(opening)}
          onClick={() => setDeletionId(item.conversationId)}>Kayıt silmeyi incele</button>}
        <button className="secondary-button" type="button" disabled={Boolean(opening)} onClick={() => setPrivateId(item.conversationId)}>Özel dal taslaklarını göster</button>
      </article>)}
    </div>}
    {!loading && page.nextCursor && <button className="secondary-button" type="button" disabled={olderLoading} onClick={() => void older()}>{olderLoading ? "Yükleniyor…" : "Daha eski konuşmaları göster"}</button>}
    {error && <p role="alert" className="error">{error}</p>}
    {deletionId && <ConversationDeletionPanel key={deletionId} conversationId={deletionId}
      onDeleted={reload} onCancel={() => setDeletionId(null)} />}
    {privateId && <PrivateBranchesPanel key={privateId} conversationId={privateId} onClose={() => setPrivateId(null)} />}
  </section>;
}
