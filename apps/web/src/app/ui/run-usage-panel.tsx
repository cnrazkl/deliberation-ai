"use client";

import { ownerFetch } from "../../lib/session-fetch";
import { useEffect, useState } from "react";
import type { RunRecord } from "@deliberation-ai/application";
import type { RunProviderUsage } from "@deliberation-ai/persistence";

const operationStatusLabels: Record<RunProviderUsage["operations"][number]["status"], string> = {
  prepared: "Hazırlandı",
  submitted: "Gönderildi",
  succeeded: "Tamamlandı",
  failed: "Başarısız",
  outcome_unknown: "Sonuç belirsiz",
  discarded: "Başarısız sayıldı",
  retry_authorized: "Yeniden denemeye izin verildi",
};
const detailLabels = {
  totalTokens: "Sağlayıcı toplamı", cachedInputTokens: "Önbellekten okunan giriş",
  cacheWriteInputTokens: "Önbelleğe yazılan giriş", reasoningTokens: "Düşünme", toolInputTokens: "Araç girdisi",
} as const;
const costReasonLabels: Record<string, string> = {
  no_submission: "Sağlayıcıya gönderilmedi", price_unavailable_at_submission: "Gönderim sırasında geçerli fiyat yoktu",
  returned_model_unconfirmed: "Yanıtın model kimliği fiyatla eşleşmedi", usage_incomplete: "Token sayımı eksik",
  counting_convention_mismatch: "Token sayımı fiyatın kapsamıyla eşleşmedi", cache_usage_incomplete: "Önbellek sayımı eksik",
  cache_write_breakdown_unavailable: "Önbelleğe yazma ücretinin kapsamı bilinmiyor", invalid_cache_usage: "Önbellek sayımı tutarsız",
  cache_price_unavailable: "Önbellek fiyatı yok", price_input_band_exceeded: "Giriş, kayıtlı fiyatın token aralığını aştı",
  reasoning_usage_incomplete: "Düşünme sayımı eksik", invalid_reasoning_usage: "Düşünme sayımı tutarsız",
  usage_changed_after_estimate: "Hesaptan sonra kullanım kaydı değişti",
  price_integrity_unconfirmed: "Fiyat kaydının bütünlüğü doğrulanamadı",
};
const costComponentLabels = { input: "Giriş", cached_input: "Önbellekten giriş", output: "Çıkış" };
const billingComponentLabels = { tokens: "Token", tools: "Araç", cache_write: "Önbelleğe yazma", storage: "Depolama",
  modality: "Görsel/ses/video", tax: "Vergi", credit: "İndirim/iade", other: "Diğer" };

type Props = { runId: string; runStatus: RunRecord["status"] };

export function RunUsagePanel({ runId, runStatus }: Props) {
  const [usage, setUsage] = useState<{ key: string; value: RunProviderUsage }>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string>();
  const requestKey = `${runId}:${runStatus}:${refreshKey}`;

  useEffect(() => {
    const controller = new AbortController();
    void ownerFetch(`/api/runs/${runId}/usage`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Token kullanımı yüklenemedi.");
        setUsage({ key: requestKey, value: await response.json() as RunProviderUsage });
        setError(undefined);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Token kullanımı yüklenemedi.");
      });
    return () => controller.abort();
  }, [runId, requestKey]);

  const current = usage?.key === requestKey ? usage.value : undefined;
  return (
    <section className="usage-card" aria-label="Sağlayıcının bildirdiği token kullanımı">
      <div className="usage-heading">
        <div>
          <strong>Sağlayıcının bildirdiği token kullanımı</strong>
          <small>İlk tur, çapraz inceleme ve izin verilen yeniden denemeler ayrı gösterilir.</small>
        </div>
        <button className="secondary-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Kullanımı yenile</button>
      </div>
      {!current ? <p className="hint">Kullanım kayıtları yükleniyor…</p> : (
        <>
          {current.executionBudget ? (
            <section className="execution-budget-summary" aria-label="Gönderim rezervasyonu">
              <strong>Gönderim rezervasyonu</strong>
              <small>Kaydedilen sınırlar: {current.executionBudget.limits.maxProviderCalls} API çağrısı · çağrı başına {current.executionBudget.limits.maxOutputTokensPerCall.toLocaleString("tr-TR")} yanıt tokenı · toplam {current.executionBudget.limits.maxReservedOutputTokens.toLocaleString("tr-TR")} yanıt tokenı rezervasyon kotası.</small>
              <p>{current.executionBudget.submittedCalls} çağrı için {current.executionBudget.reservedOutputTokens.toLocaleString("tr-TR")} yanıt tokenı ayrıldı.</p>
              <small>Kalan: {current.executionBudget.remainingCalls} çağrı · {current.executionBudget.remainingOutputTokens.toLocaleString("tr-TR")} yanıt tokenı rezervasyonu. Sonucu belirsiz gönderimlerin rezervasyonu korunur.</small>
              <small>Rezervasyon, aşağıdaki sağlayıcı sayımlarından ayrıdır; kullanılan gerçek token veya ödenen para değildir. Giriş tokenlarını ve araç ücretlerini kapsamaz.</small>
            </section>
          ) : <p className="hint">Bu çalışma için çağrı/yanıt kotası sınırı etkinleştirilmemiş.</p>}
          {current.inputReportCount > 0 || current.outputReportCount > 0 ? (
            <p><strong>{current.inputReportCount > 0 ? current.reportedInputTokens.toLocaleString("tr-TR") : "Bildirilmedi"}</strong> giriş · <strong>{current.outputReportCount > 0 ? current.reportedOutputTokens.toLocaleString("tr-TR") : "Bildirilmedi"}</strong> çıkış tokenı</p>
          ) : <p>Bu çalışma için sağlayıcı token sayımı bildirilmedi.</p>}
          <small>{current.inputReportCount}/{current.operationCount} işlem giriş, {current.outputReportCount}/{current.operationCount} işlem çıkış tokenı bildirdi.</small>
          <section aria-label="Token maliyet tahmini">
            <strong>Token maliyet tahmini</strong>
            <p>{current.costLedger?.estimatedTokenSubtotalUsd !== null && current.costLedger?.estimatedTokenSubtotalUsd !== undefined
              ? `Hesaplanabilen token ara toplamı: ${current.costLedger.estimatedTokenSubtotalUsd} USD`
              : "Token tutarı hesaplanamadı."}</p>
            <small>{current.costLedger?.estimatedOperations ?? 0} işlem hesaplandı · {current.costLedger?.unavailableOperations ?? current.operationCount} işlem için fiyat veya kullanım doğrulanamadı.</small>
            <p className="hint">Çağrı gönderildiğinde kaydedilen fiyat sürümü kullanılır. Bu yalnız bildirilen tokenların tahminidir; araç, depolama, indirim ve vergileri kapsamaz. Fatura toplamı veya parasal harcama sınırı değildir. Eksik kayıtlar sıfır sayılmaz.</p>
          </section>
          <div className="usage-operations">
            {Object.entries(detailLabels).map(([key, label]) => {
              const metric = current.tokenDetails?.[key as keyof typeof detailLabels] ?? { reportedTokens: null, reportCount: 0 };
              return <small key={key}>{label}: {metric.reportedTokens?.toLocaleString("tr-TR") ?? "bildirilmedi"} · {metric.reportCount}/{current.operationCount} işlem bildirdi</small>;
            })}
          </div>
          {current.uncertainUsageCount > 0 ? <p className="inline-warning">{current.uncertainUsageCount} gönderilmiş veya kapanmış işlemde kullanım sayımı eksik. Bu işlemler ücretlendirilmiş olabilir; görünen toplam fatura toplamı değildir.</p> : null}
          <p className="hint">Görünen toplamlar yalnız bildirilen kayıtları kapsar; eksik sayım sıfır değildir. Önbellek, düşünme ve araç sayımları diğer toplamlarla örtüşebilir; birbirine eklenmez. Claude giriş sayısı önbelleği dışarıda bırakır, Gemini çıkışı yalnız yanıt adaylarını sayar. Token sayımları tek başına faturayı doğrulamaz.</p>
          <div role="region" aria-label="Gözden geçirilmiş fatura kayıtları">
            <strong>{current.billingLedger?.recordedSubtotalUsd !== null && current.billingLedger?.recordedSubtotalUsd !== undefined
              ? `Kaydedilen fatura ara toplamı: ${current.billingLedger.recordedSubtotalUsd} USD` : "Eşleştirilmiş fatura tutarı yok"}</strong>
            <p className="hint">{current.billingLedger?.recordedOperations ?? 0} çağrı eşleştirildi · {current.billingLedger?.pendingOperations ?? 0} çağrı için kayıt bekleniyor · {current.billingLedger?.mismatchedOperations ?? 0} kayıt çağrıyla artık eşleşmiyor · {current.billingLedger?.voidedOperations ?? 0} kayıt iptal edildi · {current.billingLedger?.reallocatedOperations ?? 0} eski eşleştirme başka kayda taşındı.</p>
            {(current.billingLedger?.voidedOperations ?? 0) > 0 ? <p className="inline-warning">Fatura kaydının iptali sağlayıcı ücretini sıfırlamaz. Bu çağrıların ücretleri yeniden eşleştirme bekliyor.</p> : null}
            {(current.billingLedger?.reallocatedOperations ?? 0) > 0 ? <p className="inline-warning">Eski eşleştirme toplamdan çıkarıldı; yeni kayıt ilgili çağrıda bir kez sayılır. Eski çağrının ücreti sıfır kabul edilmez.</p> : null}
            <p className="hint">Belgesi sahibi tarafından gözden geçirilen kayıtların ara toplamıdır. Ödeme onayı veya parasal bütçe sınırı değildir; token tahminine eklenmez. Fatura kayıtları henüz otomatik alınmaz.</p>
          </div>
          {current.operations.length > 0 ? (
            <details>
              <summary>İşlem ayrıntıları ({current.operationCount})</summary>
              <div className="usage-operations">
                {current.operations.map((operation) => (
                  <div key={operation.id}>
                    <span>{operation.memberId} · tur {operation.round} · deneme {operation.attempt} · {operation.provider}/{operation.model} · {operationStatusLabels[operation.status]}</span>
                    <small>Giriş: {operation.inputTokens?.toLocaleString("tr-TR") ?? "bildirilmedi"} · Çıkış: {operation.outputTokens?.toLocaleString("tr-TR") ?? "bildirilmedi"}</small>
                    <small>{Object.entries(detailLabels).map(([key, label]) => `${label}: ${operation.tokenDetails?.[key as keyof typeof detailLabels]?.toLocaleString("tr-TR") ?? "bildirilmedi"}`).join(" · ")}</small>
                    <small>{operation.tokenDetails?.inputTokenKind === "uncached" ? "Giriş önbelleği dışarıda bırakır. " : ""}{operation.tokenDetails?.outputTokenKind === "candidates" ? "Çıkış yanıt adaylarıdır; düşünme ayrı bildirilir. " : ""}{operation.tokenDetails?.inputTokenKind === "provider_defined" ? "Sayım kapsamını uyumlu uç nokta belirler. " : ""}{!operation.tokenDetails ? "Eski makbuzda ayrıntı kaydedilmemiş." : ""}</small>
                    <small>Token tahmini: {operation.costEstimate?.amountUsd ? `${operation.costEstimate.amountUsd} USD` : "hesaplanamadı"} · {operation.costEstimate?.reason ? costReasonLabels[operation.costEstimate.reason] ?? "Fiyat veya kullanım doğrulanamadı" : (operation.costEstimate?.status === "estimated" ? "Bildirilen tokenlardan hesaplandı" : "Fiyat/kullanım kaydı yok")}</small>
                    {operation.billing ? <details><summary>Fatura eşleştirmesi: {operation.billing.status === "owner_recorded" ? `${operation.billing.totalUsd} USD` : operation.billing.status === "voided" ? "kayıt iptal edildi" : operation.billing.status === "reallocated" ? "başka kayda taşındı" : "çağrı kaydı değişti"}</summary>
                      <small>Belge: {operation.billing.statementId} · satır: {operation.billing.lineId} · belge özeti: {operation.billing.documentSha256}</small>
                      <small>Gözden geçirme: {operation.billing.reviewedAt} · Tam çağrı eşleşmesi; tüm çağrı ücretlerini kapsadığı sahibi tarafından bildirildi.</small>
                      {operation.billing.status === "voided" ? <small>Aşağıdaki bileşenler iptal edilen kayda aittir; ara toplama katılmaz.</small> : null}
                      {operation.billing.reallocationOut ? <small>Eski eşleştirme ara toplama katılmaz. Yeni kayıt: {operation.billing.reallocationOut.targetRecordId} · {operation.billing.reallocationOut.input.reason}</small> : null}
                      {operation.billing.reallocationIn ? <small>Yeniden eşleştirme kaynağı: {operation.billing.reallocationIn.input.sourceRecordId} · {operation.billing.reallocationIn.input.reason}</small> : null}
                      {operation.billing.components.map((component, index) => <small key={index}>{billingComponentLabels[component.kind]}: {component.amountUsd} USD</small>)}
                      {operation.billing.changeCount > 0 ? <details><summary>Düzeltme geçmişi ({operation.billing.changeCount})</summary>
                        <small>İlk kayıt: {operation.billing.original.totalUsd} USD · belge özeti: {operation.billing.original.documentSha256}</small>
                        {operation.billing.changes.map((change) => <div key={change.id}><small>{change.sequence}. {change.action === "void" ? "İptal" : "Düzeltme"} · {change.reviewedAt} · {change.reason}</small>
                          <small>{change.action === "replace" ? `${change.replacement.totalUsd} USD` : "Geçerli fatura tutarı yok"} · belge özeti: {change.documentSha256}</small></div>)}
                        {operation.billing.historyTruncated ? <small>Son 10 düzeltme gösterilir; tam geçmiş yerel fatura kaydında korunur.</small> : null}
                      </details> : null}
                    </details> : null}
                    {operation.costEstimate?.priceSnapshotId ? <details><summary>Fiyat ve hesap kaydı</summary>
                      <small>Fiyat sürümü: {operation.costEstimate.priceSnapshotId} · fiyat özeti: {operation.costEstimate.priceFingerprint} · kullanım özeti: {operation.costEstimate.usageFingerprint}</small>
                      {operation.costEstimate.components.map((component) => <small key={component.kind}>{costComponentLabels[component.kind]}: {component.tokens} token × {component.usdPerMillion} USD / milyon token</small>)}
                    </details> : null}
                  </div>
                ))}
              </div>
              {current.recentOperationsTruncated ? <p className="hint">Yalnızca son 100 işlem listelenir; yukarıdaki toplamlar tüm kayıtları kapsar.</p> : null}
            </details>
          ) : null}
        </>
      )}
      {error ? <p className="inline-warning" role="alert">{error}</p> : null}
    </section>
  );
}
