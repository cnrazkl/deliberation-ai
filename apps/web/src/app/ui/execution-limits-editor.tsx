"use client";

import { executionLimitsSchema, type ExecutionLimits } from "@deliberation-ai/contracts";

export const defaultExecutionLimits: ExecutionLimits = {
  version: "dispatch-limits-v1",
  maxProviderCalls: 24,
  maxOutputTokensPerCall: 8_192,
  maxReservedOutputTokens: 196_608,
};

export function executionLimitError(limits: ExecutionLimits | undefined, plannedProviderCalls: number): string | undefined {
  if (!limits) return undefined;
  if (!executionLimitsSchema.safeParse(limits).success) {
    return "Sınırlar tam sayı olmalı: çağrı sayısı 1–100, çağrı başına yanıt kotası 128–32.768 ve toplam rezervasyon kotası 128–3.276.800 arasında olmalıdır.";
  }
  if (limits.maxProviderCalls < plannedProviderCalls) {
    return `Seçili tam çalışma için en az ${plannedProviderCalls} çağrı gerekir. Çağrı sınırını artırın veya üye/tur sayısını azaltın.`;
  }
  const requiredOutputTokens = plannedProviderCalls * limits.maxOutputTokensPerCall;
  if (limits.maxReservedOutputTokens < requiredOutputTokens) {
    return `Seçili tam çalışma için en az ${requiredOutputTokens.toLocaleString("tr-TR")} yanıt tokenı rezervasyon kotası gerekir.`;
  }
  return undefined;
}

export function ExecutionLimitsEditor({ enabled, limits, plannedProviderCalls, onEnabledChange, onChange }: {
  enabled: boolean;
  limits: ExecutionLimits;
  plannedProviderCalls: number;
  onEnabledChange: (enabled: boolean) => void;
  onChange: (limits: ExecutionLimits) => void;
}) {
  const error = executionLimitError(enabled ? limits : undefined, plannedProviderCalls);
  const requiredOutputTokens = plannedProviderCalls * limits.maxOutputTokensPerCall;
  return (
    <section className="execution-limits-control" aria-label="Çağrı ve yanıt kotası sınırları">
      <label className="checkbox-label">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
        Bu çalışma için çağrı ve yanıt kotası sınırı uygula
      </label>
      <p className="hint">Seçili üyeler ve inceleme turları için planlanan tam çalışma: {plannedProviderCalls} API çağrısı. Yeniden denemeler ek çağrı tüketir.</p>
      {enabled ? <>
        <div className="execution-limits-fields">
          <label>En fazla API çağrısı
            <input type="number" min={1} max={100} step={1} required value={Number.isFinite(limits.maxProviderCalls) ? limits.maxProviderCalls : ""} onChange={(event) => onChange({ ...limits, maxProviderCalls: event.target.valueAsNumber })} />
          </label>
          <label>Çağrı başına yanıt tokenı kotası
            <input type="number" min={128} max={32_768} step={1} required value={Number.isFinite(limits.maxOutputTokensPerCall) ? limits.maxOutputTokensPerCall : ""} onChange={(event) => onChange({ ...limits, maxOutputTokensPerCall: event.target.valueAsNumber })} />
          </label>
          <label>Toplam yanıt tokenı rezervasyon kotası
            <input type="number" min={128} max={3_276_800} step={1} required value={Number.isFinite(limits.maxReservedOutputTokens) ? limits.maxReservedOutputTokens : ""} onChange={(event) => onChange({ ...limits, maxReservedOutputTokens: event.target.valueAsNumber })} />
          </label>
        </div>
        {Number.isFinite(requiredOutputTokens) ? <p className="hint">Planın gerekli rezervasyonu: {plannedProviderCalls} × {limits.maxOutputTokensPerCall.toLocaleString("tr-TR")} = {requiredOutputTokens.toLocaleString("tr-TR")} yanıt tokenı. Kullanılmayan kota yeniden denemelere ayrılabilir.</p> : null}
        <p className="hint">Her yeni gönderimden önce bir çağrı ve çağrı başına yanıt kotası ayrılır. Sonucu belirsiz gönderimlerin rezervasyonu geri verilmez. Bu sınırlar giriş tokenlarını, araç ücretlerini veya para tutarını sınırlamaz; fatura garantisi değildir.</p>
        {error ? <p className="inline-warning" role="alert">{error}</p> : null}
      </> : null}
    </section>
  );
}
