"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { guideSections } from "./help-content";
import { ThemeSelect } from "./workspace-shell";
import { BrandHomeLink } from "./brand-home-link";

function normalize(value: string) { return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i"); }
export function HelpGuide() {
  const [query, setQuery] = useState("");
  useEffect(() => {
    let collapsed: HTMLDetailsElement[] = [];
    const before = () => { collapsed = Array.from(document.querySelectorAll<HTMLDetailsElement>(".help-technical:not([open])")); collapsed.forEach((item) => { item.open = true; }); };
    const after = () => { collapsed.forEach((item) => { item.open = false; }); collapsed = []; };
    window.addEventListener("beforeprint", before); window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = guideSections.filter((section) => {
    const text = normalize([section.title, section.summary, ...section.paragraphs, ...(section.steps ?? []), ...section.technical, section.example?.text ?? ""].join(" "));
    return words.every((word) => text.includes(word));
  });
  return <div className="help-page" id="help-top">
    <a className="skip-link" href="#help-content">Kılavuza geç</a>
    <header className="help-header"><BrandHomeLink className="help-brand" strong /><div><ThemeSelect /><Link prefetch={false} className="help-return" href="/">Uygulamayı aç →</Link></div></header>
    <div className="help-hero"><span className="eyebrow">YARDIM VE KULLANIM KILAVUZU</span><h1>İlk sorudan<br /><span>izlenebilir karara.</span></h1><p>Kurulum adımları, gerçek kullanım örnekleri ve teknik ayrıntılar. Yeni başlıyorsanız ilk sohbet rehberiyle başlayın; bir özelliği arıyorsanız içerik dizinini kullanın.</p>
      <div className="help-hero-actions"><a href="#baslangic">İlk sohbetimi başlatmak istiyorum →</a><a href="#zamanlayici">Zamanlayıcıyı öğren</a></div>
      <p className="help-version">9 Ekim 2026 · {guideSections.length} bölüm · Bu sayfa hesap veya model çağrısı gerektirmez.</p>
    </div>
    <div className="help-layout">
      <aside className="help-index" aria-label="Kılavuz dizini"><label htmlFor="help-search">Kılavuzda ara</label><input id="help-search" type="search" placeholder="Örn. bağlantı, zamanlayıcı, token" value={query} onChange={(event) => setQuery(event.target.value)} aria-describedby="help-search-status" />
        <p id="help-search-status" role="status">{query.trim() ? `${matches.length} bölüm bulundu. İçeriğe gitmek için bir başlık seçin.` : "Bir başlığa tıklayarak ilgili bölüme geçin."}</p>
        {matches.length === 0 && <p>Sonuç yok. Daha kısa bir sözcük deneyin veya aramayı temizleyin.</p>}
        <nav aria-label="Yardım konuları">{matches.map((section) => <a key={section.id} href={`#${section.id}`}><span>{String(guideSections.indexOf(section) + 1).padStart(2, "0")}</span>{section.title}</a>)}</nav>
      </aside>
      <main id="help-content" className="help-articles"><div className="help-reading-note"><strong>Okurken uygulamanız açık kalsın.</strong><p>Yardım menüsü ayrı sekme açar. İlk sekmeye dönerek adımları uygulayın. Arama yalnız dizini daraltır; aşağıdaki kılavuzun tamamı görünür kalır ve yazdırılabilir.</p><button className="secondary-button" type="button" onClick={() => window.print()}>Kılavuzu yazdır / PDF olarak kaydet</button></div>
        {guideSections.map((section, index) => <article className="help-article" id={section.id} key={section.id} aria-labelledby={`help-title-${section.id}`}>
          <span className="help-section-number">BÖLÜM {String(index + 1).padStart(2, "0")}</span><h2 id={`help-title-${section.id}`}>{section.title}</h2><p className="help-summary">{section.summary}</p>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.steps && <><h3>Nasıl kullanılır?</h3><ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol></>}
          {section.example && <section className="help-example" aria-label={section.example.title}><h3>{section.example.title}</h3><pre>{section.example.text}</pre></section>}
          <details className="help-technical"><summary>Teknik ayrıntılar ve sınırlar</summary>{section.technical.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</details>
          <div className="help-related"><span>İlgili konular</span>{section.related?.map((id) => { const item = guideSections.find((candidate) => candidate.id === id)!; return <a href={`#${id}`} key={id}>{item.title} →</a>; })}<a href="#help-top">Başa dön ↑</a></div>
        </article>)}
      </main>
    </div><footer className="help-footer">Deliberation AI · Bağımsız görüşler, görünür itirazlar, korunmuş köken. Uzlaşı doğruluk değildir.</footer>
  </div>;
}
