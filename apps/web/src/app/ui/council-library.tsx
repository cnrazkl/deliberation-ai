"use client";
import type { CouncilMemberConfig } from "@deliberation-ai/contracts";
type SavedCouncil = { id: string; name: string; members: CouncilMemberConfig[]; settings?: { reviewRounds: number } };
export function CouncilLibrary({ templates, selectedId, invalidIds, disabled, onEdit, onDelete, modelLabel }: {
  templates: SavedCouncil[]; selectedId: string; invalidIds: string[]; disabled: boolean;
  onEdit: (id: string) => void; onDelete: (id: string) => void; modelLabel: (member: CouncilMemberConfig) => string;
}) {
  return <section className="council-library" aria-label="Konsey Havuzu">
    <div className="council-library-heading"><div><h2>Konsey Havuzu</h2><p className="hint">Kayıtlı konseylerinizi inceleyin ve yönetin.</p></div><span className="connection-count">{templates.length}</span></div>
    {!templates.length ? <p className="hint">Henüz kayıtlı konsey yok. Aşağıdaki yapılandırmayı tamamlayıp yeni konsey oluşturun.</p> : <div className="council-library-grid">
      {templates.map(template => <article key={template.id} className="council-preview-card" data-template-id={template.id}>
        <div className="council-preview-heading"><h3>{template.name}</h3>{selectedId === template.id && <small className="badge">Müzakerede Seçili</small>}</div>
        <p className="hint">{template.members.length} üye · {template.settings?.reviewRounds ?? 1} inceleme turu</p>
        <div className="council-preview-models">{template.members.slice(0, 3).map(member => <span key={member.id} title={member.model}>{modelLabel(member)}</span>)}{template.members.length > 3 && <span>+{template.members.length - 3} model</span>}</div>
        {invalidIds.includes(template.id) && <small className="inline-warning">Bağlantı veya model seçimini güncelleyin.</small>}
        <div className="council-preview-actions"><button type="button" className="secondary-button" disabled={disabled} aria-label={`${template.name} konseyini düzenle`} title="Bu konseyin üyelerini ve ayarlarını aşağıdaki editöre yükler." onClick={() => onEdit(template.id)}>Düzenle</button>
          <button type="button" className="secondary-button danger-button" disabled={disabled} aria-label={`${template.name} konseyini sil`} title="Konseyi silmeden önce seçili kullanım ve korunacak kopyaları gösterir." onClick={() => onDelete(template.id)}>Sil</button></div>
      </article>)}
    </div>}
  </section>;
}
export function CouncilEditorActions({ name, selected, disabled, canSave, saving, notice, error, onName, onSave, onCreate, onNew }: {
  name: string; selected: boolean; disabled: boolean; canSave: boolean; saving: boolean; notice: string | undefined; error: string | undefined;
  onName: (name: string) => void; onSave: () => void; onCreate: () => void; onNew: () => void;
}) {
  return <section className="council-editor-save" aria-label="Konsey kaydı">
    <label>Konsey Adı<input aria-label="Şablon adı" value={name} maxLength={80} disabled={disabled} placeholder="Örn. Günlük Çalışma Konseyi" onChange={event => onName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!disabled && canSave && name.trim()) (selected ? onSave : onCreate)(); } }} /></label>
    <div className="council-editor-actions">{selected && <button type="button" disabled={disabled || !canSave || !name.trim()} onClick={onSave}>Değişiklikleri Kaydet</button>}
      <button type="button" className={selected ? "secondary-button" : undefined} disabled={disabled || !canSave || !name.trim()} title="Yapılandırmayı yeni bir adla konsey havuzuna kaydeder; model çağrısı yapmaz." onClick={onCreate}>{saving ? "Kaydediliyor…" : "Yeni Konsey Oluştur"}</button>
      <button type="button" className="text-button" disabled={disabled} title="Mevcut üyelerle yeni konsey taslağı açar." onClick={onNew}>Yeni Taslak</button></div>
    {notice && <p className="connection-notice" role="status">{notice}</p>}{error && <p className="inline-warning" role="alert">{error}</p>}
  </section>;
}
