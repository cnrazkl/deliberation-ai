"use client";

import { useEffect, useRef, useState } from "react";
import type { RunBranches, RunBranchItem, RunBranchKind } from "@deliberation-ai/persistence";

const labels: Record<RunBranchKind, string> = {
  independent: "Bağımsız çalışma", "continuation-full": "Tam geçmişle devam",
  "continuation-compacted": "Kısaltılmış geçmişle devam", "member-rerun": "Seçili üye tekrarı",
};
const statuses: Record<RunBranchItem["status"], string> = {
  queued: "Sırada", running: "Çalışıyor", completed: "Tamamlandı", partially_completed: "Kısmen tamamlandı", failed: "Başarısız", cancelled: "İptal edildi",
};

export function RunBranchesPanel({ runId, refreshKey, onOpenRun }: {
  runId: string; refreshKey: number; onOpenRun: (id: string) => Promise<void>;
}) {
  const [data, setData] = useState<RunBranches | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [manualRefresh, setManualRefresh] = useState(0);
  const [opening, setOpening] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  // Remount per run in the parent; abort on status refresh or navigation.
  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current = controller;
    void fetch(`/api/runs/${runId}/branches`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value = await response.json() as RunBranches & { error?: string };
        if (!response.ok) throw new Error(value.error ?? "Çalışma bağlantıları yüklenemedi.");
        if (!controller.signal.aborted) { setData(value); setError(null); }
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : "Çalışma bağlantıları yüklenemedi."); }
      }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [runId, refreshKey, manualRefresh]);

  async function older(section: "siblings" | "children") {
    const cursor = data?.[section].nextCursor;
    const controller = activeRequest.current;
    if (!cursor || busy || !controller || controller.signal.aborted) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${runId}/branches?${section}Before=${encodeURIComponent(cursor)}`, { cache: "no-store", signal: controller.signal });
      const value = await response.json() as RunBranches & { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Diğer bağlantılar yüklenemedi.");
      if (controller.signal.aborted) return;
      setData((previous) => previous ? { ...previous, [section]: {
        runs: [...new Map([...previous[section].runs, ...value[section].runs].map((item) => [item.runId, item])).values()],
        nextCursor: value[section].nextCursor,
      } } : previous);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Diğer bağlantılar yüklenemedi."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function open(id: string) {
    setOpening(true);
    try { await onOpenRun(id); }
    catch { setError("Bağlı çalışma açılamadı."); }
    finally { setOpening(false); }
  }
  function items(values: RunBranchItem[]) {
    return values.length ? <div className="run-history-list">{values.map((item) => <article className="run-history-item" key={item.runId} data-branch-run-id={item.runId}>
      <div><strong>{item.question}</strong><small>{labels[item.kind]} · {statuses[item.status]} · {new Date(item.createdAt).toLocaleString("tr-TR")}</small></div>
      <button type="button" className="secondary-button" disabled={opening || busy} onClick={() => void open(item.runId)}>Bağlı çalışmayı aç</button>
    </article>)}</div> : <p className="empty">Bağlı çalışma yok.</p>;
  }
  return <section className="settings-card" aria-label="Çalışma dalları">
    <div className="config-heading"><strong>Çalışma dalları</strong><small>{data ? labels[data.current.kind] : busy ? "Bağlantılar yükleniyor…" : "Bağlantılar yüklenemedi"}</small>
      <button type="button" className="secondary-button" disabled={busy || opening} onClick={() => { setBusy(true); setError(null); setManualRefresh((value) => value + 1); }}>Dalları yenile</button>
    </div>
    <p className="section-hint">Önceki kaynaklara, aynı kaynaktan açılan diğer dallara ve doğrudan devam çalışmalarına geçebilirsiniz. Çalışma açmak yeni soru taslağınızı değiştirmez.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {data && <>
      <h3>Önceki kaynaklar</h3>
      {items(data.ancestors)}
      {data.unavailableSourceRunId && <p className="section-hint">Önceki kaynak artık erişilebilir değil: {data.unavailableSourceRunId}. Saklanan geçmiş bağlam, açılan çalışmada incelenebilir.</p>}
      {data.ancestorsTruncated && <p className="section-hint">İlk 64 kaynak gösteriliyor. En eski görünen kaynağı açarak daha geriye gidebilirsiniz.</p>}
      <h3>Aynı kaynaktan açılan diğer dallar</h3>
      {items(data.siblings.runs)}
      {data.siblings.nextCursor && <button className="secondary-button" disabled={busy || opening} onClick={() => void older("siblings")}>Daha eski kardeş dallar</button>}
      <h3>Bu çalışmadan açılan dallar</h3>
      {items(data.children.runs)}
      {data.children.nextCursor && <button className="secondary-button" disabled={busy || opening} onClick={() => void older("children")}>Daha eski devam dalları</button>}
    </>}
  </section>;
}
