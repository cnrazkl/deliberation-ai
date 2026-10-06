export type LocalDiagnosticsAlertInput = {
  workerStatus: "ready" | "stale" | "stopped" | "never_seen";
  readyWorkers: number;
  queuedRuns: number;
  runningRuns: number;
  unresolvedProviderAttempts: number;
  activeSchedules: number;
};

export function localDiagnosticsAlerts(input: LocalDiagnosticsAlertInput): string[] {
  const alerts: string[] = [];
  if (input.workerStatus !== "ready" && (input.queuedRuns > 0 || input.runningRuns > 0 || input.activeSchedules > 0)) {
    alerts.push("Worker hazır görünmüyor. Bekleyen veya çalışıyor görünen konsey işleri ve etkin zamanlamalar ilerlemeyebilir. Worker durumunu kontrol edin; çalışıyor görünmesi işlemin sürdüğünü kanıtlamaz.");
  }
  if (input.unresolvedProviderAttempts > 0) {
    alerts.push(`${input.unresolvedProviderAttempts} konsey sağlayıcı işleminin sonucu belirsiz. İşlem sağlayıcıya ulaşmış olabilir. İlgili çalışmadaki işlem kaydını inceleyin; sonucu bilmeden yeniden göndermek ek çağrı ve ücrete yol açabilir.`);
  }
  if (input.readyWorkers > 1) {
    alerts.push("Birden fazla worker nabzı var. Aynı bilgisayarda birden fazla worker süreci çalışıyor olabilir.");
  }
  return alerts;
}
