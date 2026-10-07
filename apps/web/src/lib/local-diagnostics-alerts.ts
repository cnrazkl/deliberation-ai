export type LocalDiagnosticsAlertInput = {
  workerStatus: "ready" | "stale" | "stopped" | "never_seen";
  readyWorkers: number;
  queuedRuns: number;
  runningRuns: number;
  unresolvedProviderAttempts: number;
  activeSchedules: number;
  operational?: { recoveryHold: boolean; privatePending: number; privateUnknown: number; probePending: number; probeUnknown: number;
    decisionPending: number; decisionUnknown: number; decisionEnabled: boolean; queryMs: number;
    queue: { state?: "ready" | "unavailable"; pending: number | null; active: number | null; oldestDueSeconds: number | null };
    backup: { state: string; count: number; latestAt: string | null } };
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
  const extra = input.operational;
  if (extra) {
    if (extra.recoveryHold) alerts.push("Salt okunur kurtarma incelemesi açık. Veri değişikliği, API gönderimi, kuyruk ve zamanlama çalıştırma kapalı.");
    if (extra.privateUnknown || extra.probeUnknown || extra.decisionUnknown) alerts.push(`Konsey dışında sonucu doğrulanmamış işlemler var: özel sohbet ${extra.privateUnknown}, bağlantı denemesi ${extra.probeUnknown}, karar ${extra.decisionUnknown}. Kayıtları incelemeden yeniden gönderim yapmayın.`);
    if (input.workerStatus !== "ready" && (extra.privatePending || extra.decisionPending)) alerts.push("Worker hazır değil; özel sohbet veya karar işleri bekliyor. Kuyruk sayısı sağlayıcıya yeniden gönderme izni değildir.");
    if (!extra.decisionEnabled && extra.decisionPending) alerts.push("Karar değerlendirmesi kapalı; bekleyen karar işleri çalıştırılmıyor.");
    if (extra.queue.state === "unavailable") alerts.push("Kuyruk henüz başlatılmamış; iş sayısı bilinmiyor. Worker durumunu kontrol edin.");
    if ((extra.queue.oldestDueSeconds ?? 0) > 86_400) alerts.push("Çalıştırılma zamanı geçmiş kuyruk kayıtları bir günden eski. Arşiv işleri veya eksik hedefler olabilir; kurtarma incelemesi olmadan tekrar başlatmayın.");
    if (extra.backup.state !== "metadata_only" || !extra.backup.count || !extra.backup.latestAt) alerts.push("Kayıtlı yedek bilgisi yok veya okunamadı. Kurtarma öncesinde yedek oluşturup geri yükleme doğrulaması yapın.");
    else if (Date.now() - Date.parse(extra.backup.latestAt) > 7 * 86_400_000) alerts.push("Son kayıtlı yedek yedi günden eski. Yeni yedek ve geri yükleme doğrulaması önerilir.");
    if (extra.queryMs >= 2000) alerts.push("Yerel durum sorgusu iki saniyeden uzun sürdü. Bu anlık ölçümü veritabanı yüküyle birlikte değerlendirin.");
  }
  return alerts;
}
