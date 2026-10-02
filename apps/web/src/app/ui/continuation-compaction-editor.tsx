"use client";

import type { ContinuationArchive, ContinuationCompactionPacket } from "@deliberation-ai/contracts";

const labels = {
  report: "Raporun tamamı: ham yanıtlar, iddia defteri ve azınlık görüşleri, incelemeler, başarısızlıklar ve kanıt etiketleri",
  "earlier-context": "Önceki çalışmalara ait gönderilmiş geçmiş bağlam",
  "earlier-archive": "Daha önce kısaltılan geçmişin özgün arşivi",
};

export function CompactionOmissions({ packet }: { packet: ContinuationCompactionPacket }) {
  return <ul>{packet.omissions.map((item) => <li key={item.section}>{labels[item.section]} · yaklaşık {Math.ceil(item.bytes / 1024).toLocaleString("tr-TR")} KiB. Tam metni yeni üyelere gönderilmez; aşağıdaki özgün arşivde korunur.</li>)}</ul>;
}

export function ContinuationCompactionEditor({ packet, summary, reviewed, disabled, onSummaryChange, onReviewedChange, onRemove }: {
  packet: ContinuationCompactionPacket; summary: string; reviewed: boolean; disabled: boolean;
  onSummaryChange: (value: string) => void; onReviewedChange: (value: boolean) => void; onRemove: () => void;
}) {
  return <section aria-label="Geçmişi elle kısaltma">
    <h3>Geçmişi elle kısaltarak devam</h3>
    <p>Kaynak soru aynen korunur: {packet.sourceQuestion}</p>
    <p>Rapor ve önceki geçmiş yerine yazacağınız özet gönderilir. Azınlık görüşlerini, çözümsüz itirazları, başarısızlıkları ve belirsizlikleri özette nasıl koruduğunuzu inceleyin. Uygulama özetin doğruluğunu, eksiksizliğini veya anlam eşdeğerliğini onaylamaz.</p>
    <h4>Tam metni gönderilmeyecek bölümler</h4>
    <CompactionOmissions packet={packet} />
    <details><summary>Özgün geçmişi ve çıkarılan ayrıntıları incele</summary><pre>{packet.originalContent}</pre></details>
    <label htmlFor="continuation-summary">Yeni çalışmaya gönderilecek geçmiş özeti</label>
    <textarea id="continuation-summary" value={summary} minLength={10} maxLength={8000} disabled={disabled}
      onChange={(event) => onSummaryChange(event.target.value)} />
    <small>10–8000 karakter. Kaynak soru, sürüm bilgisi ve atlanan bölüm dökümü özete ayrıca eklenir. Token önizlemesi yalnızca gönderilecek metni sayar.</small>
    <label><input type="checkbox" disabled={disabled || summary.trim().length < 10} checked={reviewed}
      onChange={(event) => onReviewedChange(event.target.checked)} />Özeti ve atlanan bilgileri inceledim; bu kısaltmayla devam et</label>
    <button type="button" className="secondary-button" disabled={disabled} onClick={onRemove}>Geçmiş bağlamı kaldır</button>
    <p className="hint">Kaynak metin değişirse yeniden seçin. Özgün geçmiş şifreli saklanır; kaynak silinse de bu çalışmanın arşiv kopyası kendi saklama süresine kadar kalır. Modele gönderilmez. 2 MiB üzerindeki arşiv için bu akış kullanılamaz. Yüksek risk kontrolleri özetle düşürülemez.</p>
  </section>;
}

export function ContinuationArchiveDetails({ archive }: { archive: ContinuationArchive }) {
  return <details><summary>Kısaltılmış geçmişin özgün arşivini ve atlanan bölümleri incele</summary>
    <p>Bu arşiv modele gönderilmedi. Kaynak soru: {archive.packet.sourceQuestion}. Özgün kopya, bu çalışmanın saklama süresine bağlıdır. JSON indirmesi arşivi şifresiz olarak içerir.</p>
    <p>İncelenmiş kullanıcı özeti: {archive.selection.summary}</p>
    <CompactionOmissions packet={archive.packet} />
    <pre>{archive.packet.originalContent}</pre>
  </details>;
}
