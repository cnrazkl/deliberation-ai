"use client";

import { useEffect, useState } from "react";
import { localDiagnosticsAlerts } from "../../lib/local-diagnostics-alerts";

type Diagnostics = {
  checkedAt: string;
  database: "ready";
  workerStatus: "ready" | "stale" | "stopped" | "never_seen";
  readyWorkers: number;
  latestHeartbeatAt: string | null;
  queuedRuns: number;
  runningRuns: number;
  unresolvedProviderAttempts: number;
  activeSchedules: number;
};

const workerLabels: Record<Diagnostics["workerStatus"], string> = {
  ready: "Hazır",
  stale: "Nabız gecikmiş",
  stopped: "Durdurulmuş",
  never_seen: "Henüz görülmedi",
};

async function fetchDiagnostics(): Promise<Diagnostics> {
  const response = await fetch("/api/local-diagnostics", { cache: "no-store" });
  if (!response.ok) throw new Error("Local diagnostics unavailable.");
  return (await response.json()) as Diagnostics;
}

export function LocalDiagnosticsPanel() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function refresh(): Promise<void> {
    setPending(true);
    try {
      setDiagnostics(await fetchDiagnostics());
      setError(undefined);
    } catch {
      setDiagnostics(undefined);
      setError("Yerel çalışma durumu okunamadı. Veritabanını ve uygulamayı kontrol edin.");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function poll(): Promise<void> {
      try {
        const result = await fetchDiagnostics();
        if (active) {
          setDiagnostics(result);
          setError(undefined);
        }
      } catch {
        if (active) {
          setDiagnostics(undefined);
          setError("Yerel çalışma durumu okunamadı. Veritabanını ve uygulamayı kontrol edin.");
        }
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  return (
    <details className="settings-card diagnostics-card" aria-label="Yerel çalışma durumu">
      <summary>Yerel çalışma durumu · {error ? "Okunamadı" : diagnostics ? `Worker ${workerLabels[diagnostics.workerStatus].toLowerCase()}` : "Kontrol ediliyor"}</summary>
      {error ? <p className="error">{error}</p> : null}
      {diagnostics ? (
        <>
          <div className="diagnostics-grid">
            <div><small>Veritabanı</small><strong>Bağlı</strong></div>
            <div><small>Worker</small><strong>{workerLabels[diagnostics.workerStatus]}{diagnostics.readyWorkers > 1 ? ` · ${diagnostics.readyWorkers} süreç` : ""}</strong></div>
            <div><small>Sıradaki çalışma</small><strong>{diagnostics.queuedRuns}</strong></div>
            <div><small>Çalışıyor</small><strong>{diagnostics.runningRuns}</strong></div>
            <div><small>Belirsiz sağlayıcı işlemi (konsey)</small><strong>{diagnostics.unresolvedProviderAttempts}</strong></div>
            <div><small>Etkin zamanlama</small><strong>{diagnostics.activeSchedules}</strong></div>
          </div>
          {localDiagnosticsAlerts(diagnostics).map((message) => <p key={message} className="inline-warning" role="status">{message}</p>)}
          <p className="hint">Son kontrol: {new Date(diagnostics.checkedAt).toLocaleString("tr-TR")} · Son worker nabzı: {diagnostics.latestHeartbeatAt ? new Date(diagnostics.latestHeartbeatAt).toLocaleString("tr-TR") : "yok"}. İşlem sayaçları konsey çalışmalarını kapsar; özel sohbet ve karar değerlendirme işlemlerini kapsamaz. Bu gösterge sağlayıcı API bağlantısını veya bir model isteğini test etmez.</p>
        </>
      ) : null}
      <button type="button" className="secondary-button" disabled={pending} onClick={() => void refresh()}>Durumu yenile</button>
    </details>
  );
}
