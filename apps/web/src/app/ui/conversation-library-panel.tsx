"use client";

import { ownerFetch } from "../../lib/session-fetch";
import { useEffect, useRef, useState } from "react";
import type { ConversationLibraryPage } from "@deliberation-ai/persistence";
import { RefreshIcon } from "./refresh-icon";

export function ConversationLibraryPanel({ refreshKey, onOpenRun, onReviewDeletion, onOpenPrivate, activeRunId, archived = false, onArchiveChange }: {
  archived?: boolean; onArchiveChange: () => void;
  onReviewDeletion: (id: string) => void; onOpenPrivate: (id: string) => void; activeRunId: string | undefined;
  refreshKey: number; onOpenRun: (id: string) => Promise<void>;
}) {
  const [page, setPage] = useState<ConversationLibraryPage>({ conversations: [], nextCursor: null });
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const archiveRequest = useRef(false);
  const endpoint = archived ? "/api/conversations?archived=true" : "/api/conversations";
  const generation = useRef(0);
  const olderRequest = useRef<AbortController | null>(null);
  const openingRequest = useRef(false);
  const initialRequest = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    initialRequest.current = true;
    olderRequest.current?.abort();
    olderRequest.current = null;
    const controller = new AbortController();
    void ownerFetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json() as ConversationLibraryPage & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Müzakereler yüklenemedi.");
      if (!controller.signal.aborted && current === generation.current) { setPage(body); setError(null); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && current === generation.current) setError(cause instanceof Error ? cause.message : "Müzakereler yüklenemedi.");
    }).finally(() => {
      if (!controller.signal.aborted && current === generation.current) { initialRequest.current = false; setLoading(false); setOlderLoading(false); }
    });
    return () => { controller.abort(); olderRequest.current?.abort(); };
  }, [refreshKey, refresh, endpoint]);

  async function older() {
    if (!page.nextCursor || olderRequest.current || loading || initialRequest.current) return;
    const controller = new AbortController();
    olderRequest.current = controller;
    const current = generation.current;
    setOlderLoading(true); setError(null);
    try {
      const response = await ownerFetch(`${endpoint}${archived ? "&" : "?"}before=${encodeURIComponent(page.nextCursor)}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json() as ConversationLibraryPage & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Eski müzakereler yüklenemedi.");
      if (!controller.signal.aborted && current === generation.current) setPage((value) => ({
        conversations: [...value.conversations, ...body.conversations.filter((item) => !value.conversations.some((existing) => existing.conversationId === item.conversationId))],
        nextCursor: body.nextCursor,
      }));
    } catch (cause) {
      if (!controller.signal.aborted && current === generation.current) setError(cause instanceof Error ? cause.message : "Eski müzakereler yüklenemedi.");
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
    catch { setError("Müzakeredeki çalışma açılamadı. Listeyi yenileyip tekrar deneyebilirsiniz."); }
    finally { openingRequest.current = false; setOpening(null); }
  }

  function reload() {
    ++generation.current;
    olderRequest.current?.abort(); olderRequest.current = null;
    setLoading(true); setOlderLoading(false); setError(null);
    setRefresh((value) => value + 1);
  }

  async function archive(id: string) {
    if (archiveRequest.current) return;
    archiveRequest.current = true;
    setArchiving(id); setError(null);
    try {
      const response = await ownerFetch("/api/conversations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id, archived: !archived }) });
      if (!response.ok) throw new Error("Arşiv durumu kaydedilemedi. Listeyi yenileyip tekrar deneyebilirsiniz.");
      reload(); onArchiveChange();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Arşiv durumu kaydedilemedi."); }
    finally { archiveRequest.current = false; setArchiving(null); }
  }

  const Container = archived ? "details" : "section";
  return <Container className="settings-card conversation-library" aria-label={archived ? "Arşiv" : "Kayıtlı müzakereler"}>
    {archived && <summary>Arşiv</summary>}
    <div className="config-heading"><strong>{archived ? "Arşivlenen müzakereler" : "Kayıtlı müzakereler"}</strong>
      <button className="secondary-button history-refresh" type="button" aria-label={archived ? "Arşivi yenile" : "Müzakere listesini yenile"} title={archived ? "Arşivi yenile" : "Müzakere listesini yenile"} disabled={loading} onClick={reload}><RefreshIcon /></button>
    </div>
    <p className="section-hint">Her müzakerenin son erişilebilir çalışmasını açabilirsiniz. Soru taslağı ve model seçimleri korunur; yeni model isteği gönderilmez.</p>
    {loading ? <p className="hint">Müzakereler yükleniyor…</p> : <div className="run-history-list">
      {page.conversations.length === 0 && !error && <p className="hint">{archived ? "Henüz arşivlenmiş müzakere yok." : "Henüz kayıtlı müzakere yok."}</p>}
      {page.conversations.map((item) => <article key={item.conversationId} data-conversation-id={item.conversationId} className={item.latestAvailableRun?.runId === activeRunId ? "active" : ""}>
        <div><button type="button" className="history-title" disabled={!item.latestAvailableRun || Boolean(opening)} data-open-history title={item.latestAvailableRun?.question} onClick={() => item.latestAvailableRun && void open(item.latestAvailableRun.runId)}>{item.latestAvailableRun?.question ?? "Bu müzakerenin çalışma içerikleri artık erişilebilir değil"}</button>
          <small>{new Date(item.createdAt).toLocaleString("tr-TR")} · {item.recordedRunCount} çalışma · {item.unavailableRunCount} erişilemeyen içerik</small>
          {item.origin === "legacy-reconstructed" && <small>Eski kayıtlar mevcut bağlantılarından birleştirildi; eksik geçmiş bulunabilir.</small>}
        </div>
        <button className="secondary-button" type="button" disabled={!item.latestAvailableRun || Boolean(opening)}
          data-open-history onClick={() => item.latestAvailableRun && void open(item.latestAvailableRun.runId)}>
          {opening === item.latestAvailableRun?.runId ? "Açılıyor…" : item.latestAvailableRun ? "Müzakereyi aç" : "İçerik erişilemiyor"}
        </button>
        <button className="secondary-button" type="button" disabled={Boolean(archiving) || Boolean(opening)} onClick={() => void archive(item.conversationId)}>{archiving === item.conversationId ? "Kaydediliyor…" : archived ? "Arşivden çıkar" : "Arşive ekle"}</button>
        <button className="secondary-button private-history-button" type="button" disabled={Boolean(opening)} data-open-history onClick={() => onOpenPrivate(item.conversationId)}>Özel dal taslaklarını göster</button>
        <button className="secondary-button" type="button" disabled={Boolean(opening)}
          aria-label="Müzakereyi Sil" aria-haspopup="dialog" onClick={() => onReviewDeletion(item.conversationId)}>Sil</button>
      </article>)}
    </div>}
    {!loading && page.nextCursor && <button className="secondary-button" type="button" disabled={olderLoading} onClick={() => void older()}>{olderLoading ? "Yükleniyor…" : "Daha eski müzakereleri göster"}</button>}
    {error && <p role="alert" className="error">{error}</p>}
  </Container>;
}
