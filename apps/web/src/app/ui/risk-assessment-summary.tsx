import type { RiskAssessment } from "@deliberation-ai/contracts";

const categories = {
  health: "Sağlık / tedavi",
  legal: "Hukuk / sözleşme",
  financial: "Finans / yatırım",
  "physical-safety": "Fiziksel güvenlik",
  irreversible: "Geri alınamayan işlem",
  "uninspected-image": "İçeriği önceden incelenmeyen görsel",
};
const sources = { question: "soru", document: "PDF metni", memory: "seçili bellek", tool: "araç bağlamı", image: "görsel", conversation: "geçmiş rapor" };

export function RiskAssessmentSummary({ assessment }: { assessment: RiskAssessment }) {
  return <div className="risk-assessment" aria-label="Risk ön değerlendirmesi">
    <strong>Uygulanacak profil: {assessment.effectiveProfile === "high" ? "Yüksek risk" : "Standart"}</strong>
    {assessment.signals.length > 0 ? <ul>{assessment.signals.map((signal) => <li key={signal.category}>
      {categories[signal.category]} · {signal.sources.map((source) => sources[source]).join(", ")}
    </li>)}</ul> : <p className="hint">Belirgin bir risk işareti bulunmadı; bu sonuç güvenli olduğuna dair onay değildir.</p>}
    {assessment.effectiveProfile === "high" ? <p className="hint">{assessment.requestedProfile === "high" ? "Yüksek risk tercihiniz korunur." : "Otomatik kontrol veya kaynak çalışmanın profili yüksek risk gerektiriyor; standart tercihi bunu düşürmez."} Red-team ve en az bir çapraz inceleme gerekir.</p> : null}
    <p className="hint">Türkçe/İngilizce metinlerde yerel kural kontrolü ({assessment.policyVersion}). Bağlamı veya tüm riskleri anlayan bir değerlendirme değildir; alıntılar ve genel açıklamalar da işaretlenebilir. Görsel içeriği incelenmediği için görselli görevlerde yüksek risk uygulanır. Ek model çağrısı yapılmaz.</p>
  </div>;
}
