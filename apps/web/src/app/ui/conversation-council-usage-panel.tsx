"use client";
import { ownerFetch } from "../../lib/session-fetch";
import { useEffect, useRef, useState } from "react";
import type { ConversationCouncilUsage } from "@deliberation-ai/persistence";
import type { PrivateUsageCounter } from "@deliberation-ai/domain";
function Counter({ label, value }: { label: string; value: PrivateUsageCounter }) {
  return <p>{label}: {value.total ?? "bilinmiyor"}
    {value.total === null && value.knownSubtotal !== null ? ` · Bildirilen kısım: ${value.knownSubtotal}` : ""}
    {` · Sayaç kapsamı: ${value.reported}/${value.attempts} işlem kaydı`}</p>;
}
export function ConversationCouncilUsagePanel({ conversationId }: { conversationId: string }) {
  const [usage, setUsage] = useState<ConversationCouncilUsage>(); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); const active = useRef<AbortController | null>(null); const generation = useRef(0);
  useEffect(() => () => { generation.current++; active.current?.abort(); }, []);
  async function refresh() {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const current = ++generation.current; setBusy(true); setError(""); setUsage(undefined);
    try {
      const response = await ownerFetch(`/api/conversations/${conversationId}/council-usage`, { cache: "no-store", signal: controller.signal });
      const body = await response.json() as { usage: ConversationCouncilUsage; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Konsey kullanımı okunamadı.");
      if (current === generation.current && !controller.signal.aborted) setUsage(body.usage);
    } catch (caught) { if (current === generation.current && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Konsey kullanımı okunamadı."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <details className="composer-disclosure private-usage-summary" aria-label="Konuşmanın konsey kullanım özeti">
    <summary>Konuşmadaki konsey işlemlerinin token kullanımı</summary>
    <p className="section-hint">İlk tur, incelemeler ve yeniden denemelerin kayıtlarıdır. İşlem kaydı gerçek API çağrısı sayısı değildir. Özel dal kullanımı aşağıda ayrı alınır; özetlerin zamanları farklı olabilir. Fatura veya parasal bütçe değildir.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Kullanım okunuyor…" : "Konsey kullanımını getir"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {usage ? <>
      <p>Özetin alındığı zaman: {new Date(usage.checkedAt).toLocaleString("tr-TR")}. Yeni işlem veya silme sonrasında tekrar getirin.</p>
      <p>İndekslenen çalışma: {usage.indexedRuns} · Silinen çalışma kaydı: {usage.deletedRuns}</p>
      <p>Kullanım geçmişi bulunamayan çalışma: {usage.unavailableRuns} · İşlem kaydı bulunmayan çalışma: {usage.runsWithoutReceipts}</p>
      <p>Konsey işlem kaydı: {usage.operationCount} · Bekleyen: {usage.pending} · Belirsiz veya kapatılmış belirsiz: {usage.uncertain}</p>
      <p className="section-hint">Sağlayıcı, istenen model, tur ve sayaç kapsamları ayrı tutulur. Eksik sayaçlar ve eksik geçmiş sıfır değildir; farklı gruplar toplanmaz.</p>
      {usage.groups.length === 0 ? <p>Konsey işlem kaydı yok; kullanım hesaplanmadı.</p> : null}
      {usage.groups.map((group) => <article key={group.key}>
        <strong>İstenen model: {group.model} · Tur {group.round}</strong><p>Sağlayıcı: {group.provider}</p>
        <Counter label={group.inputKind === "uncached" ? "Girdi tokenı (önbellek hariç)" : "Girdi tokenı"} value={group.input} />
        <Counter label={group.outputKind === "candidates" ? "Aday yanıt tokenı" : "Çıktı tokenı"} value={group.output} />
        {group.cachedInput.reported ? <Counter label="Önbellekten okunan token" value={group.cachedInput} /> : null}
        {group.cacheWriteInput.reported ? <Counter label="Önbelleğe yazılan token" value={group.cacheWriteInput} /> : null}
        {group.reasoning.reported ? <Counter label="Reasoning / düşünce tokenı" value={group.reasoning} /> : null}
        {group.toolInput.reported ? <Counter label="Araç girdi tokenı" value={group.toolInput} /> : null}
        {group.providerTotal.reported ? <Counter label="Sağlayıcının bildirdiği toplam" value={group.providerTotal} /> : null}
        <p>{group.inputKind === "inclusive" ? "Önbellek okuma tokenı girdi sayacına dahildir." : group.inputKind === "uncached" ? "Önbellek okuma/yazma sayaçları girdiden ayrıdır." : "Girdi sayacının kapsamı doğrulanmadı."}</p>
        <p>{group.outputKind === "inclusive" ? "Düşünce tokenı çıktı sayacına dahildir." : group.outputKind === "candidates" ? "Düşünce tokenı aday yanıttan ayrıdır." : "Çıktı sayacının kapsamı doğrulanmadı."} Sayaçlar tekrar eklenmez; eksik sağlayıcı toplamı hesaplanmaz.</p>
      </article>)}
    </> : null}
  </details>;
}
