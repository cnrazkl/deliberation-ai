"use client";

import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { BrandHomeLink } from "./brand-home-link";

export type WorkspaceView = "chat" | "schedules" | "settings";
type Theme = "system" | "light" | "dark";
const themeKey = "deliberation-theme";
function themeSnapshot(): Theme {
  try { const value = localStorage.getItem(themeKey); return value === "light" || value === "dark" ? value : "system"; }
  catch { const value = document.documentElement.dataset.theme; return value === "light" || value === "dark" ? value : "system"; }
}
function subscribeTheme(callback: () => void) {
  const update = () => {
    document.documentElement.dataset.theme = themeSnapshot();
    callback();
  };
  window.addEventListener("storage", update);
  window.addEventListener("deliberation-theme", callback);
  return () => { window.removeEventListener("storage", update); window.removeEventListener("deliberation-theme", callback); };
}
export function ThemeSelect() {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => "system" as Theme);
  return <label className="theme-picker">Görünüm
    <select aria-label="Tema" value={theme} onChange={(event) => {
      const value = event.target.value as Theme;
      document.documentElement.dataset.theme = value;
      try { localStorage.setItem(themeKey, value); } catch { /* Appearance still applies for this page. */ }
      window.dispatchEvent(new Event("deliberation-theme"));
    }}>
      <option value="system">Sistem teması</option><option value="light">Açık tema</option><option value="dark">Koyu tema</option>
    </select>
  </label>;
}
const labels: Record<WorkspaceView, string> = { chat: "Sohbet", schedules: "Zamanlayıcı", settings: "Ayarlar" };
function WorkspaceIcon({ view }: { view: WorkspaceView }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {view === "chat" ? <path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" /> : view === "schedules" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> : <><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="3" fill="var(--sidebar)" /><circle cx="16" cy="17" r="3" fill="var(--sidebar)" /></>}
  </svg>;
}
export function WorkspaceShell({ view, onViewChange, sidebarOpen, onSidebarOpenChange: setSidebarOpen, onNewChat, newChatDisabled, attentionCount, sidebar, children }: {
  view: WorkspaceView; onViewChange: (view: WorkspaceView) => void; onNewChat: () => void;
  newChatDisabled: boolean; attentionCount: number; sidebar: ReactNode; children: ReactNode;
  sidebarOpen: boolean; onSidebarOpenChange: (open: boolean) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  function closeSidebar() { setSidebarOpen(false); toggle.current?.focus(); }
  function focusContent() { window.requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); heading.current?.closest("main")?.scrollIntoView({ block: "start" }); }); }
  return <div className="app-shell">
    <a className="skip-link" href="#workspace-content">İçeriğe geç</a>
    {sidebarOpen && <button className="sidebar-backdrop" aria-label="Geçmiş menüsünü kapat" onClick={closeSidebar} />}
    <aside id="workspace-sidebar" className={`app-sidebar ${sidebarOpen ? "is-open" : ""}`} aria-label="Sohbet geçmişi ve gezinme"
      onKeyDown={(event) => { if (event.key === "Escape") closeSidebar(); }}>
      <div className="sidebar-brand"><BrandHomeLink strong onHome={() => { onViewChange("chat"); setSidebarOpen(false); focusContent(); }} />
        <button type="button" className="sidebar-close secondary-button" aria-label="Geçmiş menüsünü kapat" onClick={closeSidebar}>×</button>
      </div>
      <button type="button" className="new-chat-button" aria-label="＋ Yeni sohbet" disabled={newChatDisabled} onClick={() => { onNewChat(); setSidebarOpen(false); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Yeni sohbet</button>
      <nav className="workspace-nav" aria-label="Ana menü">
        {(Object.keys(labels) as WorkspaceView[]).map((item) => <button type="button" key={item} aria-label={labels[item]}
          aria-current={view === item ? "page" : undefined} onClick={() => { onViewChange(item); setSidebarOpen(false); focusContent(); }}>
          <WorkspaceIcon view={item} />{labels[item]}
          {item === "settings" && attentionCount > 0 && <small className="nav-attention" title={`${attentionCount} sağlayıcı işlemi karar bekliyor`}>{attentionCount}</small>}
        </button>)}
      </nav>
      <div className="sidebar-history" onClick={(event) => { if ((event.target as HTMLElement).closest("[data-open-history]")) { setSidebarOpen(false); focusContent(); } }}><p className="sidebar-section-label">SOHBET GEÇMİŞİ</p>{sidebar}</div>
      <div className="sidebar-footer"><ThemeSelect /><small>Bağımsız görüşler · İzlenebilir sonuçlar</small></div>
    </aside>
    <main className="app-main" id="workspace-content">
      <header className="workspace-topbar">
        <button ref={toggle} type="button" className="sidebar-toggle secondary-button" aria-label="Sohbet geçmişini aç" aria-expanded={sidebarOpen} aria-controls="workspace-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
        <div><span className="eyebrow">ÇALIŞMA ALANI</span><h1 ref={heading} tabIndex={-1}>{view === "chat" ? "Birlikte düşünelim." : labels[view]}</h1></div>
        <span className="local-badge"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>Size ait çalışma alanı</span>
      </header>
      {children}
      <footer className="workspace-footer">Uzlaşı doğruluk değildir · Ham yanıtlar ve farklı görüşler korunur.</footer>
    </main>
  </div>;
}
