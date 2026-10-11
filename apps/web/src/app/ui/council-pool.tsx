"use client";

import type { CouncilMemberConfig } from "@deliberation-ai/contracts";

export function CouncilPool({ templates, selectedId, selectedName, modified, members, reviewRounds,
  name, disabled, canSave, saving, notice, error, onSelect, onNameChange, onSave }: {
  templates: { id: string; name: string; memberCount: number }[];
  selectedId: string; selectedName?: string | undefined; modified: boolean; members: CouncilMemberConfig[]; reviewRounds: number;
  name: string; disabled: boolean; canSave: boolean; saving: boolean; notice?: string | undefined; error?: string | undefined;
  onSelect: (id: string) => void; onNameChange: (name: string) => void; onSave: () => void;
}) {
  return <section className="council-pool" aria-label="Konsey Havuzu">
    <div className="council-pool-heading"><div><h3>Konsey Havuzu</h3><p>Kaydettiğiniz konseyi seçin; modeller ve tur ayarları hazır gelsin.</p></div>
      <span className="council-pool-badge">{members.length} üye · {reviewRounds} inceleme turu</span></div>
    <label className="council-pool-selector">Kayıtlı Konsey
      <select value={modified ? "" : selectedId} disabled={disabled} onChange={event => onSelect(event.target.value)}>
        <option value="">{modified && selectedName ? `${selectedName} · Düzenlenmiş Taslak` : "Özel Konsey Taslağı"}</option>
        {templates.map(template => <option key={template.id} value={template.id}>{template.name} · {template.memberCount} üye</option>)}
      </select>
    </label>
    <ul className="council-pool-models" aria-label="Hazır modeller">{members.map(member => <li key={member.id}><strong>{member.label}</strong><span>{member.model || "Model seçin"}</span></li>)}</ul>
    <div className="council-pool-save"><label>Konsey Adı<input aria-label="Şablon adı" value={name} maxLength={80}
      placeholder="Örn. Günlük Çalışma Konseyi" disabled={disabled} onChange={event => onNameChange(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!disabled && canSave && name.trim()) onSave(); } }} /></label>
      <button type="button" className="secondary-button" disabled={disabled || !canSave || !name.trim()} onClick={onSave}>{saving ? "Kaydediliyor…" : "Konseyi Kaydet"}</button></div>
    {!templates.length && <p className="hint">Henüz kayıtlı konsey yok. Üyeleri düzenleyin, isim verin ve havuza kaydedin.</p>}
    {notice && <p className="connection-notice" role="status">{notice}</p>}
    {error && <p className="inline-warning" role="alert">{error}</p>}
  </section>;
}
