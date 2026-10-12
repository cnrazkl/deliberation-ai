"use client";

import { ownerFetch } from "../../lib/session-fetch";
import { useEffect, useRef, useState } from "react";
import type { RunHistoryPage } from "@deliberation-ai/persistence";
import { RefreshIcon } from "./refresh-icon";

const statusLabels: Record<RunHistoryPage["runs"][number]["status"], string> = {
  queued: "Sırada",
  running: "Çalışıyor",
  completed: "Tamamlandı",
  partially_completed: "Kısmi sonuç",
  failed: "Başarısız",
  cancelled: "İptal edildi",
};

type Props = {
  activeRunId: string | undefined;
  refreshKey: number;
  onOpenRun: (runId: string) => Promise<void>;
  onReviewDeletion: (runId: string) => void;
  deletionPending: boolean;
};

export function RunHistoryPanel({ activeRunId, refreshKey, onOpenRun, onReviewDeletion, deletionPending }: Props) {
  const [page, setPage] = useState<RunHistoryPage>({ runs: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [openingRunId, setOpeningRunId] = useState<string>();
  const [error, setError] = useState<string>();
  const [manualRefresh, setManualRefresh] = useState(0);

  const generation = useRef(0);
  const olderRequest = useRef<AbortController | null>(null);
  const initialRequest = useRef(false);
  const openingRequest = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    initialRequest.current = true;
    olderRequest.current?.abort();
    olderRequest.current = null;
    const controller = new AbortController();
    void ownerFetch("/api/runs", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Çalışma geçmişi yüklenemedi.");
        const body = await response.json() as RunHistoryPage;
        if (!controller.signal.aborted && current === generation.current) {
          setPage(body);
          setError(undefined);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && current === generation.current) setError("Çalışma geçmişi yüklenemedi.");
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current) {
          initialRequest.current = false;
          setLoading(false);
          setLoadingOlder(false);
        }
      });
    return () => { controller.abort(); olderRequest.current?.abort(); };
  }, [refreshKey, manualRefresh]);

  async function loadOlder(): Promise<void> {
    if (deletionPending || !page.nextCursor || olderRequest.current || loading || initialRequest.current) return;
    const controller = new AbortController();
    const current = generation.current;
    olderRequest.current = controller;
    setLoadingOlder(true);
    setError(undefined);
    try {
      const response = await ownerFetch(`/api/runs?before=${encodeURIComponent(page.nextCursor)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Eski çalışmalar yüklenemedi.");
      const older = await response.json() as RunHistoryPage;
      if (!controller.signal.aborted && current === generation.current) setPage((value) => ({
        runs: [...value.runs, ...older.runs.filter((item) => !value.runs.some((existing) => existing.runId === item.runId))],
        nextCursor: older.nextCursor,
      }));
    } catch {
      if (!controller.signal.aborted && current === generation.current) setError("Eski çalışmalar yüklenemedi.");
    } finally {
      if (olderRequest.current === controller) olderRequest.current = null;
      if (current === generation.current) setLoadingOlder(false);
    }
  }

  function reload(): void {
    ++generation.current;
    olderRequest.current?.abort();
    olderRequest.current = null;
    setLoading(true);
    setLoadingOlder(false);
    setError(undefined);
    setManualRefresh((value) => value + 1);
  }

  async function openRun(runId: string): Promise<void> {
    if (deletionPending || openingRequest.current) return;
    openingRequest.current = true;
    setOpeningRunId(runId);
    setError(undefined);
    try {
      await onOpenRun(runId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Çalışma açılamadı.");
    } finally {
      openingRequest.current = false;
      setOpeningRunId(undefined);
    }
  }

  return (
    <details className="run-history settings-card" open>
      <summary>Son çalışmalar</summary>
      <button className="secondary-button history-refresh" type="button" aria-label="Listeyi yenile" title="Listeyi yenile" disabled={loading || deletionPending} onClick={reload}><RefreshIcon /></button>
      {loading ? <p className="hint">Geçmiş yükleniyor…</p> : page.runs.length === 0 ? <p className="hint">Henüz kayıtlı çalışma yok.</p> : (
        <div className="run-history-list">
          {page.runs.map((item) => (
            <article key={item.runId} data-run-id={item.runId} className={`compact-history-item ${item.runId === activeRunId ? "active" : ""}`}>
              <button className="history-title" type="button" aria-label="Çalışmayı aç" title={`${item.question} · ${new Date(item.createdAt).toLocaleString("tr-TR")} · ${statusLabels[item.status]}`} disabled={Boolean(openingRunId) || deletionPending} data-open-history onClick={() => void openRun(item.runId)}>
                {openingRunId === item.runId ? "Açılıyor…" : item.question}
              </button>
              {item.status !== "queued" && item.status !== "running" && <button type="button" className="secondary-button"
                aria-label="Çalışmayı Sil" title="Bu çalışmayı silmeden önce kapsamını ve engellerini gösterir." disabled={Boolean(openingRunId) || deletionPending || loadingOlder} onClick={() => onReviewDeletion(item.runId)}>Sil</button>}
            </article>
          ))}
        </div>
      )}
      {!loading && page.nextCursor ? <button className="secondary-button" type="button" disabled={loadingOlder || deletionPending} onClick={() => void loadOlder()}>{loadingOlder ? "Yükleniyor…" : "Daha eski çalışmaları göster"}</button> : null}
      {error ? <p className="inline-warning" role="alert">{error}</p> : null}
    </details>
  );
}
