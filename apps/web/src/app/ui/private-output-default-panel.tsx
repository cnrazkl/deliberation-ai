"use client";
import { useState, useSyncExternalStore } from "react";
import { privateOutputCaps, readPrivateOutputDefault, savePrivateOutputDefault, subscribePrivateOutputDefault } from "../../lib/private-output-default";

export function PrivateOutputDefaultPanel() {
  const saved = useSyncExternalStore(subscribePrivateOutputDefault, readPrivateOutputDefault, () => 1024);
  const [draft, setDraft] = useState<number | null>(null); const [message, setMessage] = useState("");
  function save(value: number) {
    if (savePrivateOutputDefault(value)) { setDraft(null); setMessage("Varsayılan bu tarayıcıya kaydedildi."); }
    else setMessage("Tarayıcı ayarı kaydedilemedi. Mevcut seçim ve gönderim kayıtları korunuyor.");
  }
  return <section className="settings-card" aria-label="Özel yanıt varsayılanı">
    <strong>Özel yanıt varsayılanı</strong>
    <p className="section-hint">Yeni açılan özel dallar ve yeni çatallar bu sınırla başlar. Açık dallardaki seçimler, konsey ayarları ve onaylanan gönderimler değişmez. Her gönderim ayrıca incelenip onaylanır.</p>
    <p>Kaydedilen varsayılan: {saved} token</p>
    <label className="theme-picker">Varsayılan özel çıktı sınırı
      <select value={draft ?? saved} onChange={(event) => { setDraft(Number(event.target.value)); setMessage(""); }}>
        {privateOutputCaps.map((value) => <option key={value} value={value}>{value} token</option>)}
      </select>
    </label>
    <div className="config-heading">
      <button type="button" onClick={() => save(draft ?? saved)}>Varsayılanı bu tarayıcıya kaydet</button>
      <button type="button" className="secondary-button" onClick={() => save(1024)}>{"Varsayılanı 1024'e sıfırla"}</button>
    </div>
    <p className="section-hint">Yalnız bu tarayıcıda saklanır. Daha düşük sınır yanıtı kesebilir; kullanım veya ücret tahmini değildir.</p>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
