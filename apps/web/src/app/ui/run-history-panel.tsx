"use client";

import { useEffect, useRef, useState } from "react";
import type { RunHistoryPage } from "@deliberation-ai/persistence";

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
};

export function RunHistoryPanel({ activeRunId, refreshKey, onOpenRun }: Props) {
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
    void fetch("/api/runs", { cache: "no-store", signal: controller.signal })
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
    if (!page.nextCursor || olderRequest.current || loading || initialRequest.current) return;
    const controller = new AbortController();
    const current = generation.current;
    olderRequest.current = controller;
    setLoadingOlder(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/runs?before=${encodeURIComponent(page.nextCursor)}`, { cache: "no-store", signal: controller.signal });
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
    if (openingRequest.current) return;
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
      <p className="hint">Kayıtlı bir çalışmayı açıp raporunu inceleyebilir veya indirebilirsiniz. Soru alanınız ve model seçimleriniz değişmez.</p>
      <button className="secondary-button" type="button" disabled={loading} onClick={reload}>Listeyi yenile</button>
      {loading ? <p className="hint">Geçmiş yükleniyor…</p> : page.runs.length === 0 ? <p className="hint">Henüz kayıtlı çalışma yok.</p> : (
        <div className="run-history-list">
          {page.runs.map((item) => (
            <article key={item.runId} data-run-id={item.runId} className={item.runId === activeRunId ? "active" : ""}>
              <div>
                <strong>{item.question}</strong>
                <small>{new Date(item.createdAt).toLocaleString("tr-TR")} · {statusLabels[item.status]} · {item.memberCount} üye{item.riskProfile === "high" ? " · yüksek risk" : ""}{item.attachmentCount > 0 ? ` · ${item.attachmentCount} ek` : ""}</small>
              </div>
              <button className="secondary-button" type="button" disabled={Boolean(openingRunId)} onClick={() => void openRun(item.runId)}>
                {openingRunId === item.runId ? "Açılıyor…" : item.runId === activeRunId ? "Yeniden yükle" : "Çalışmayı aç"}
              </button>
            </article>
          ))}
        </div>
      )}
      {!loading && page.nextCursor ? <button className="secondary-button" type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Yükleniyor…" : "Daha eski çalışmaları göster"}</button> : null}
      {error ? <p className="inline-warning" role="alert">{error}</p> : null}
    </details>
  );
}
