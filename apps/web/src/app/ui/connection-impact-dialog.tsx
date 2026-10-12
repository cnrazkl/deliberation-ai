"use client";
import type { ConnectionImpact } from "@deliberation-ai/persistence";
import { ConnectionDialog } from "./connection-dialog";
export function ConnectionImpactDialog({ impact, draftModels, onDecision }: { impact: ConnectionImpact | null; draftModels: string[]; onDecision: (approved: boolean) => void }) {
  return <ConnectionDialog open={Boolean(impact)} title="Bağlı Kayıtları İnceleyin" description="Bu değişiklikten etkilenen kayıtları inceleyin." busy={false} onClose={() => onDecision(false)}>
    {impact ? <section className="connection-impact-review" aria-label="Bağlantı bağımlılıkları"><h3>{impact.label} · {impact.action === "delete" ? "Bağlantıyı Sil" : "Bağlantıyı Güncelle"}</h3>
      <p>{impact.action === "delete" ? "Bağlantı ve API anahtarı kaldırılacak." : impact.transportChanged ? "API anahtarı veya aktarım ayarları değişecek." : "Aşağıdaki modeller kullanılabilir seçimlerden kaldırılacak."}</p>
      {impact.removedModels.length ? <p className="hint">Kaldırılacak modeller: {impact.removedModels.join(", ")}</p> : null}
      <p>Eski sohbetlerin dondurulmuş kayıtları korunur. Bağlı konseyleri ve duraklatılmış zamanlayıcıları tekrar kullanmadan önce model seçimlerini düzeltmeniz gerekir.</p>
      {draftModels.length ? <p className="inline-warning">Bu tarayıcıdaki konsey taslağı: {draftModels.join(", ")}. Yeni gönderim için seçimleri güncelleyin.</p> : null}
      <ul className="connection-impact-list">{impact.references.map(reference => <li key={`${reference.kind}:${reference.id}`}><strong>{reference.kind} · {reference.label}</strong><small>{reference.models.join(", ")} · {reference.status}</small>{reference.blocking ? <span className="inline-warning">Bu işlem değişikliği engelliyor.</span> : null}</li>)}</ul>
      {!impact.references.length ? <p className="hint">Bu bağlantıya bağlı kayıt bulunamadı.</p> : null}
      {impact.blockedReasons.map(reason => <p className="inline-warning" key={reason}>{reason}</p>)}
      <div className="connection-chat-actions"><button type="button" className={impact.action === "delete" ? "danger-button" : undefined} disabled={!impact.eligible} title="Güncel bağımlılıkları tekrar denetleyerek bu değişikliği uygular." onClick={() => onDecision(true)}>{impact.action === "delete" ? "Eminim, Bağlantıyı Sil" : "Değişikliği Onayla"}</button><button type="button" className="secondary-button" title="Hiçbir değişiklik yapmadan düzenlemeye döner." onClick={() => onDecision(false)}>Vazgeç</button></div>
    </section> : null}
  </ConnectionDialog>;
}
