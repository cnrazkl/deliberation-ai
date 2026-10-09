"use client";

import { useState } from "react";

export function ConnectionModelPicker({ models, selectedModels, onChange, disabled = false, label = "Sohbette kullanılacak modeller" }: {
  models: string[]; selectedModels: string[]; onChange: (models: string[]) => void; disabled?: boolean; label?: string;
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
        <details className="connection-model-manual"><summary>Listede olmayan model ekle</summary>
          <p className="hint">Listeleme desteklenmiyorsa veya katalog eksikse model kimliğini bir kez burada ekleyin. Sohbette hazır seçenek olur.</p>
          <label>Model kimliği<input value={customModel} maxLength={120} disabled={disabled} onChange={event => setCustomModel(event.target.value)} /></label>
          <button type="button" className="secondary-button" disabled={disabled || !customModel.trim() || selectedModels.length >= 100}
            onClick={() => { const id = customModel.trim(); if (!selectedModels.includes(id)) onChange([...selectedModels, id]); setCustomModel(""); }}>Modeli Ekle</button>
        </details>
      </div>
    </details>
    {selectedModels.length ? <div className="connection-selected-models" aria-label="Seçilen modeller">{selectedModels.map(id => <span key={id}>{id}<button type="button" disabled={disabled}
      aria-label={`${id} seçimini kaldır`} onClick={() => onChange(selectedModels.filter(item => item !== id))}>×</button></span>)}</div> : <p className="hint">Model seçmeden bağlantıyı kaydedebilirsiniz. Sohbette kullanmak için buradan model seçin.</p>}
  </div>;
}

export function SavedConnectionModels({ models, selectedModels, onSave, label }: {
  models: string[]; selectedModels: string[]; onSave: (models: string[]) => Promise<void>; label: string;
}) {
  const [draft, setDraft] = useState(selectedModels), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [binding, setBinding] = useState(JSON.stringify(selectedModels));
  if (binding !== JSON.stringify(selectedModels)) { setBinding(JSON.stringify(selectedModels)); setDraft(selectedModels); }
  const changed = JSON.stringify(draft) !== JSON.stringify(selectedModels);
  return <section className="saved-connection-models" aria-label={`${label} model seçimleri`}>
    <ConnectionModelPicker models={models} selectedModels={draft} onChange={value => { setDraft(value); setNotice(""); setFailed(false); }} disabled={busy} />
    {changed ? <button type="button" className="primary-button" disabled={busy} onClick={async () => {
      setBusy(true); setNotice(""); setFailed(false);
      try { await onSave(draft); setNotice("Model seçimleri kaydedildi. Sohbette bu bağlantıdan seçebilirsiniz."); }
      catch { setNotice("Model seçimleri kaydedilemedi. Tekrar deneyin."); setFailed(true); }
      finally { setBusy(false); }
    }}>{busy ? "Kaydediliyor…" : "Model Seçimini Kaydet"}</button> : null}
    {notice ? <p role={failed ? "alert" : "status"}>{notice}</p> : null}
  </section>;
}
