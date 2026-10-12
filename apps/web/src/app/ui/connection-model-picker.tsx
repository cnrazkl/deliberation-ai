"use client";

import { useState } from "react";

export function ConnectionModelPicker({ models, selectedModels, onChange, aliases = {}, onAliasesChange, disabled = false, label = "Müzakerede kullanılacak modeller" }: {
  models: string[]; selectedModels: string[]; onChange: (models: string[]) => void; aliases?: Record<string, string>; onAliasesChange?: (aliases: Record<string, string>) => void; disabled?: boolean; label?: string;
}) {
  const [search, setSearch] = useState("");
  const [customModel, setCustomModel] = useState("");
  const available = [...new Set([...selectedModels, ...models])];
  const filtered = available.filter(id => id.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")));
  return <div className="connection-model-selection">
    <details className="connection-model-dropdown">
      <summary aria-label={label}><span>{label}</span><strong>{selectedModels.length} seçili</strong></summary>
      <div className="connection-model-options">
        <label>Modellerde ara<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Örn. Claude, Gemini, Qwen" /></label>
        <div className="connection-model-checklist" aria-label="Model seçenekleri">
          {filtered.map(id => <label key={id}><input type="checkbox" aria-label={id} checked={selectedModels.includes(id)}
            disabled={disabled || !selectedModels.includes(id) && selectedModels.length >= 100}
            onChange={event => onChange(event.target.checked ? [...selectedModels, id] : selectedModels.filter(item => item !== id))} /><span>{id}</span></label>)}
          {!filtered.length ? <p className="hint">{available.length ? "Aramayla eşleşen model yok." : "Modelleri listeleyerek burada seçim yapabilirsiniz."}</p> : null}
        </div>
        <section className="connection-model-manual" aria-label="Listede olmayan model ekle"><h4>Listede Olmayan Model Ekle</h4>
          <p className="hint">Listeleme desteklenmiyorsa veya katalog eksikse model kimliğini bir kez burada ekleyin. Müzakerede hazır seçenek olur.</p>
          <label>Model kimliği<input value={customModel} maxLength={120} disabled={disabled} onChange={event => setCustomModel(event.target.value)} /></label>
          <button type="button" title="Yazdığınız model kimliğini bu bağlantının seçimlerine ekler; API çağrısı yapmaz." className="secondary-button" disabled={disabled || !customModel.trim() || selectedModels.length >= 100}
            onClick={() => { const id = customModel.trim(); if (!selectedModels.includes(id)) onChange([...selectedModels, id]); setCustomModel(""); }}>Modeli Ekle</button>
        </section>
      </div>
    </details>
    {selectedModels.length ? <div className="connection-selected-models" aria-label="Seçilen modeller">{selectedModels.map(id => <span key={id}>{aliases[id] ?? id}<button type="button" disabled={disabled}
      aria-label={`${id} seçimini kaldır`} title="Bu modeli seçim taslağından çıkarır. Kaydederken bağlı kayıtlar denetlenir." onClick={() => onChange(selectedModels.filter(item => item !== id))}>×</button></span>)}</div> : <p className="hint">Model seçmeden bağlantıyı kaydedebilirsiniz. Müzakerede kullanmak için buradan model seçin.</p>}
    {onAliasesChange && selectedModels.length ? <section className="connection-model-aliases" aria-label="Model takma adları"><h4>Model Takma Adları</h4><p className="hint">İsterseniz kısa bir ad verin. Gerçek model kimliği değişmez.</p>
      {selectedModels.map(id => <label key={id}><span title={id}>{id}</span><input aria-label={`${id} takma adı`} value={aliases[id] ?? ""} maxLength={80} placeholder="İsteğe bağlı takma ad" disabled={disabled}
        onChange={event => { const next = { ...aliases }; if (event.target.value.trim()) next[id] = event.target.value; else delete next[id]; onAliasesChange(next); }} /></label>)}
    </section> : null}
  </div>;
}

export function SavedConnectionModels({ models, selectedModels, aliases = {}, onSave, label }: {
  models: string[]; selectedModels: string[]; aliases?: Record<string, string>; onSave: (models: string[], aliases: Record<string, string>) => Promise<void>; label: string;
}) {
  const [draft, setDraft] = useState(selectedModels), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [draftAliases, setDraftAliases] = useState(aliases);
  const savedBinding = JSON.stringify([selectedModels, aliases]);
  const [binding, setBinding] = useState(savedBinding);
  if (binding !== savedBinding) { setBinding(savedBinding); setDraft(selectedModels); setDraftAliases(aliases); }
  const changed = JSON.stringify([draft, draftAliases]) !== savedBinding;
  return <section className="saved-connection-models" aria-label={`${label} model seçimleri`}>
    <ConnectionModelPicker models={[...new Set([...models, ...selectedModels])]} selectedModels={draft} aliases={draftAliases} onAliasesChange={setDraftAliases} onChange={value => { setDraft(value); setNotice(""); setFailed(false); }} disabled={busy} />
    {changed ? <button type="button" title="Model seçimlerini ve takma adlarını kaydeder; kaldırılan modellerin bağlı kayıtlarını önce gösterir." className="primary-button" disabled={busy} onClick={async () => {
      setBusy(true); setNotice(""); setFailed(false);
      try { await onSave(draft, Object.fromEntries(Object.entries(draftAliases).filter(([id]) => draft.includes(id)))); setNotice("Model seçimleri ve takma adlar kaydedildi. Müzakerede bu bağlantıdan seçebilirsiniz."); }
      catch { setNotice("Model seçimleri kaydedilemedi. Tekrar deneyin."); setFailed(true); }
      finally { setBusy(false); }
    }}>{busy ? "Kaydediliyor…" : "Model Seçimini Kaydet"}</button> : null}
    {notice ? <p role={failed ? "alert" : "status"}>{notice}</p> : null}
  </section>;
}
