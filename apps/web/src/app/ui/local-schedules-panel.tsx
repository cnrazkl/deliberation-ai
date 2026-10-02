"use client";

import { useEffect, useState } from "react";
import type { CouncilMemberConfig, ExecutionLimits, RiskProfile, ReviewRoundCount, ScheduleCadence } from "@deliberation-ai/contracts";
import { executionLimitError } from "./execution-limits-editor";

type Schedule = {
  id: string;
  name: string;
  question: string;
  providerMode: "fake" | "remote";
  reviewRounds: ReviewRoundCount;
  selfRevisionEnabled: boolean;
  executionLimits?: ExecutionLimits | null;
  riskProfile: RiskProfile;
  cadence: ScheduleCadence;
  status: "active" | "paused";
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunId: string | null;
};

function tomorrowLocal(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  date.setSeconds(0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function LocalSchedulesPanel({ question, members, reviewRounds, selfRevisionEnabled, riskProfile, executionLimits, creationBlockedReason }: {
  creationBlockedReason?: string | undefined;
  question: string;
  members: CouncilMemberConfig[];
  reviewRounds: ReviewRoundCount;
  selfRevisionEnabled: boolean;
  riskProfile: RiskProfile;
  executionLimits?: ExecutionLimits;
}) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState<ScheduleCadence>("daily");
  const [nextRunAt, setNextRunAt] = useState(tomorrowLocal);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const limitsError = executionLimitError(executionLimits, members.length * (1 + reviewRounds));

  async function refresh(): Promise<void> {
    const response = await fetch("/api/local-schedules", { cache: "no-store" });
    if (!response.ok) throw new Error("Zamanlamalar yüklenemedi.");
    const body = (await response.json()) as { schedules: Schedule[] };
    setSchedules(body.schedules);
  }

  useEffect(() => {
    void fetch("/api/local-schedules", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Zamanlamalar yüklenemedi.");
      const body = (await response.json()) as { schedules: Schedule[] };
      setSchedules(body.schedules);
    }).catch(() => setError("Zamanlamalar yüklenemedi."));
  }, []);

  async function create(): Promise<void> {
    if (limitsError || creationBlockedReason) return;
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("/api/local-schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          question,
          providerMode: "remote",
          reviewRounds,
          selfRevisionEnabled,
          ...(executionLimits ? { executionLimits } : {}),
          riskProfile,
          cadence,
          nextRunAt: new Date(nextRunAt).toISOString(),
          members,
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Zamanlama oluşturulamadı.");
      setName("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Zamanlama oluşturulamadı.");
    } finally { setPending(false); }
  }

  async function setStatus(id: string, status: Schedule["status"]): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/local-schedules?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Zamanlama güncellenemedi.");
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Zamanlama güncellenemedi.");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/local-schedules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Zamanlama silinemedi.");
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Zamanlama silinemedi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-card local-schedules-panel" aria-label="Yerel zamanlamalar">
      <div className="memory-heading"><div><strong>Yerel zamanlamalar</strong><small>{schedules.length} kayıt</small></div></div>
      <p className="hint">Geçerli soru ve konsey üyeleri şifreli snapshot olarak kaydedilir. Yeni zamanlama güvenlik için duraklatılmış başlar; ayrıca etkinleştirmeniz gerekir. Bilgisayar ve worker kapalıyken çağrı yapılmaz, yeniden açıldığında süresi geçen çalışma sıraya alınır.</p>
      {executionLimits ? <p className="hint">Yeni zamanlama her çalışmada aynı sınırları kullanır: {Number.isFinite(executionLimits.maxProviderCalls) ? executionLimits.maxProviderCalls : "—"} çağrı, çağrı başına {Number.isFinite(executionLimits.maxOutputTokensPerCall) ? executionLimits.maxOutputTokensPerCall.toLocaleString("tr-TR") : "—"} yanıt tokenı, toplam {Number.isFinite(executionLimits.maxReservedOutputTokens) ? executionLimits.maxReservedOutputTokens.toLocaleString("tr-TR") : "—"} rezervasyon. Her çalışma ayrı kota tutar; zamanlamanın tüm çalışmaları için ortak bütçe değildir.</p> : null}
      {limitsError ? <p className="inline-warning">{limitsError}</p> : null}
      {creationBlockedReason ? <p className="inline-warning">{creationBlockedReason}</p> : null}
      <div className="schedule-form">
        <label>Zamanlama adı<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        <label>Tekrar<select value={cadence} onChange={(event) => setCadence(event.target.value as ScheduleCadence)}><option value="daily">Her gün</option><option value="weekly">Her hafta</option></select></label>
        <label>İlk çalışma<input type="datetime-local" value={nextRunAt} onChange={(event) => setNextRunAt(event.target.value)} /></label>
        <button type="button" disabled={pending || Boolean(creationBlockedReason) || Boolean(limitsError) || !name.trim() || question.trim().length < 10 || (riskProfile === "high" && (reviewRounds < 1 || !members.some((member) => member.councilRole === "red-team")))} onClick={() => void create()}>Duraklatılmış zamanlama oluştur</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="schedule-list">
        {schedules.map((schedule) => (
          <article key={schedule.id}>
            <div><strong>{schedule.name}</strong><small>{schedule.cadence === "daily" ? "Her gün" : "Her hafta"} · {schedule.riskProfile === "high" ? "yüksek risk" : "standart"} · sonraki {new Date(schedule.nextRunAt).toLocaleString("tr-TR")}</small><p>{schedule.question}</p>{schedule.executionLimits ? <small>Çalışma başına sınır: {schedule.executionLimits.maxProviderCalls} çağrı · çağrı başına {schedule.executionLimits.maxOutputTokensPerCall.toLocaleString("tr-TR")} yanıt tokenı · {schedule.executionLimits.maxReservedOutputTokens.toLocaleString("tr-TR")} rezervasyon.</small> : null}{schedule.lastRunAt ? <small>Son çalışma {new Date(schedule.lastRunAt).toLocaleString("tr-TR")}</small> : null}</div>
            <span className={schedule.status}>{schedule.status === "active" ? "Etkin" : "Duraklatıldı"}</span>
            <div className="schedule-actions">
              <button type="button" className="secondary-button" disabled={pending || (schedule.providerMode === "fake" && schedule.status === "paused")} onClick={() => void setStatus(schedule.id, schedule.status === "active" ? "paused" : "active")}>{schedule.status === "active" ? "Duraklat" : "Etkinleştir"}</button>
              <button type="button" className="secondary-button danger-button" disabled={pending} onClick={() => void remove(schedule.id)}>Sil</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
