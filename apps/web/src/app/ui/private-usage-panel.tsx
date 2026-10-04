import type { PrivateDelivery } from "@deliberation-ai/contracts";
import { summarizePrivateUsage, type PrivateUsageCounter } from "@deliberation-ai/domain";

function Counter({ label, value }: { label: string; value: PrivateUsageCounter }) {
  return <p>{label}: {value.total ?? "bilinmiyor"}
    {value.total === null && value.knownSubtotal !== null ? ` · Bildirilen kısım: ${value.knownSubtotal}` : ""}
    {` · Sayaç kapsamı: ${value.reported}/${value.attempts} gönderim`}</p>;
}
export function PrivateUsagePanel({ branchId, deliveries }: { branchId: string; deliveries: readonly PrivateDelivery[] }) {
  const summary = summarizePrivateUsage(branchId, deliveries);
  return <details className="composer-disclosure private-usage-summary" aria-label="Özel dal kullanım özeti">
    <summary>Bu dalın token kullanımı</summary>
    <p>Bu dala ait kayıt: {summary.ownReceipts} · Sağlayıcıya gönderim kaydı: {summary.submittedAttempts}</p>
    <p>Kopyalanan kayıt: {summary.copiedReceipts} · Kopyalar bu dalın kullanımına tekrar eklenmez.</p>
    <p>Bekleyen kayıt: {summary.pending} · Sonucu belirsiz veya kapatılmış belirsiz kayıt: {summary.uncertain}</p>
    <p className="section-hint">Yalnız açık dalın sağlayıcı tarafından bildirilen sayaçlarıdır. Eksikler sıfır sayılmaz; bağlantı/model ve sayaç türleri ayrı tutulur. Fatura, toplam harcama veya parasal bütçe değildir. Tekil gönderim kayıtları aşağıda incelenebilir.</p>
    {summary.groups.length === 0 ? <p>Bu dalda sağlayıcıya gönderim kaydı yok; kullanım hesaplanmadı.</p> : null}
    {summary.groups.map((group, index) => <article key={group.key} aria-label={`Özel kullanım grubu ${index + 1}`}>
      <strong>{group.model}</strong><p>Bağlantı kimliği: {group.connectionId}</p>
      <Counter label={group.inputKind === "uncached" ? "Girdi tokenı (önbellek hariç)" : "Girdi tokenı"} value={group.input} />
      <Counter label={group.outputKind === "candidates" ? "Aday yanıt tokenı" : "Çıktı tokenı"} value={group.output} />
      {group.inputKind === "unknown" || group.inputKind === "provider_defined" ? <p>Girdi sayacının kapsamı sağlayıcıdan doğrulanmadı.</p> : null}
      {group.outputKind === "unknown" || group.outputKind === "provider_defined" ? <p>Çıktı sayacının kapsamı sağlayıcıdan doğrulanmadı.</p> : null}
      {group.cachedInput.reported > 0 ? <Counter label="Önbellekten okunan token" value={group.cachedInput} /> : null}
      {group.cacheWriteInput.reported > 0 ? <Counter label="Önbelleğe yazılan token" value={group.cacheWriteInput} /> : null}
      {group.reasoning.reported > 0 ? <Counter label="Reasoning / düşünce tokenı" value={group.reasoning} /> : null}
      {group.providerTotal.reported > 0 ? <Counter label="Sağlayıcının bildirdiği toplam" value={group.providerTotal} /> : null}
      {group.inputKind === "inclusive" ? <p>Önbellekten okunan token girdi sayacına dahildir; tekrar eklenmez.</p> : null}
      {group.inputKind === "uncached" ? <p>Önbellek okuma/yazma sayaçları girdiden ayrıdır; bu ekranda birleştirilmez.</p> : null}
      {group.outputKind === "inclusive" ? <p>Reasoning varsa çıktı sayacına dahildir; tekrar eklenmez.</p> : null}
      {group.outputKind === "candidates" ? <p>Düşünce tokenları aday yanıt sayacından ayrıdır. Sağlayıcı toplamı eksikse hesaplanmaz.</p> : null}
    </article>)}
  </details>;
}
