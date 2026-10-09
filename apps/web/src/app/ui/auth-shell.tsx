"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LocalSessionSummary } from "@deliberation-ai/contracts";
import { setSessionOwner } from "../../lib/session-fetch";
import { CouncilWorkbench } from "./council-workbench";
import { AccountDeletionPanel, RootManagement } from "./account-management";
import { accountRequest, announceSessionChange } from "../../lib/account-client";
import { HelpLink } from "./help-link";
import { AccountBar } from "./account-bar";
import { AccountMenu } from "./account-menu";
import { ThemeSelect } from "./workspace-shell";

export function AuthShell() {
  const [session, setSession] = useState<LocalSessionSummary | null>(null);
  const previousSession = useRef<LocalSessionSummary | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [register, setRegister] = useState(false), [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [deletion, setDeletion] = useState(false);
  const [passwordPanel, setPasswordPanel] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await accountRequest<{ session: LocalSessionSummary | null }>("session");
        if (!active) return;
        setSessionOwner(result.session?.scope.ownerId ?? null);
        const previous = previousSession.current;
        if (previous && (previous.user.id !== result.session?.user.id || previous.scope.id !== result.session?.scope.id)) {
          setDeletion(false);
        }
        previousSession.current = result.session; setSession(result.session);
        setReady(true);
      } catch { if (active) { setSessionOwner(null); setSession(null); setError("Hesap sistemi kullanılamıyor. Biraz sonra sayfayı yenileyin."); setReady(true); } }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    const channel = new BroadcastChannel("deliberation-accounts");
    channel.onmessage = () => { setSessionOwner(null); setSession(null); setReady(false); void refresh(); };
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); channel.close(); window.removeEventListener("focus", refresh); setSessionOwner(null); };
  }, []);
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const target = event.currentTarget, form = new FormData(target);
    try {
      const username = String(form.get("username")), password = String(form.get("password"));
      if (register) {
        await accountRequest("register", { username, password });
        target.reset(); setRegister(false); setPasswordVisible(false); setNotice("Hesabınız oluşturuldu. Şimdi giriş yapabilirsiniz.");
      } else {
        await accountRequest("login", { username, password }); announceSessionChange(); window.location.reload();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "İşlem tamamlanamadı."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try { await accountRequest("logout", {}); setSessionOwner(null); setSession(null); announceSessionChange(); window.location.reload(); }
    catch { setError("Çıkış yapılamadı; tekrar deneyin."); setBusy(false); }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { await accountRequest("password", { currentPassword: String(form.get("currentPassword")), password: String(form.get("password")) }); announceSessionChange(); window.location.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Parola değiştirilemedi."); setBusy(false); }
  }
  if (!ready) return <main className="account-login"><p role="status">Oturum kontrol ediliyor…</p></main>;
  if (!session) return <main className="account-login">
    <div className="account-entry-appearance"><ThemeSelect /></div>
    <div className="account-login-layout">
      <section className="account-welcome" aria-label="Deliberation AI hakkında">
        <div className="account-brand"><span className="account-brand-mark" aria-hidden="true">D<span>·</span></span>Deliberation AI</div>
        <div className="account-welcome-copy">
          <span className="account-kicker">BİRLİKTE DÜŞÜN, DAHA İYİ KARAR VER</span>
          <h2>Bir soruya,{" "}<br /><span>farklı bakış açıları.</span></h2>
          <p>Yapay zekâ modellerini aynı masada buluşturun. Yanıtları karşılaştırın, ortak noktaları ve ayrışan görüşleri birlikte inceleyin.</p>
        </div>
        <div className="account-council-visual" aria-hidden="true">
          <span className="account-model-dot">01</span><span className="account-model-dot">02</span><span className="account-model-dot">03</span>
          <div className="account-visual-caption"><span className="account-visual-line" />Bir soru · Birden çok perspektif</div>
        </div>
        <p className="account-welcome-footer">Kendi modelleriniz. Kendi çalışma alanınız.</p>
      </section>
      <section className="account-login-card" aria-labelledby="account-login-title">
        <span className="account-form-eyebrow">{register ? "YENİ BİR BAŞLANGIÇ" : "ÇALIŞMA ALANINIZA DÖNÜN"}</span>
        <h1 id="account-login-title">{register ? "Hesap oluştur" : "Giriş yap"}</h1>
        <p className="account-form-intro">{register ? "Kullanıcı adınızı ve parolanızı seçin. Bağlantılarınızı hesabınızı oluşturduktan sonra ekleyebilirsiniz." : "Sohbetleriniz ve API bağlantılarınız, kendi hesabınızda sizi bekliyor."}</p>
        {error && <p role="alert" className="account-auth-message account-auth-error">{error}</p>}
        {notice && <p role="status" className="account-auth-message account-auth-success">{notice}</p>}
        <form onSubmit={authenticate} aria-busy={busy}>
          <div className="account-field">
            <label htmlFor="account-username">Kullanıcı adı</label>
            <input id="account-username" name="username" placeholder="kullanıcı_adınız" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*" aria-describedby={register ? "account-username-hint" : undefined} disabled={busy} />
            {register && <p id="account-username-hint" className="account-field-hint">3–32 karakter. İngilizce harfler, rakamlar, nokta, tire veya alt çizgi; ilk karakter harf ya da rakam olmalı.</p>}
          </div>
          <div className="account-field">
            <label htmlFor="account-password">Parola</label>
            <div className="account-password-field">
              <input id="account-password" name="password" type={passwordVisible ? "text" : "password"} placeholder={register ? "En az 8 karakter" : "Parolanızı girin"} autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : 1} maxLength={128} disabled={busy} />
              <button type="button" className="account-password-toggle" aria-label={passwordVisible ? "Parolayı gizle" : "Parolayı göster"} aria-controls="account-password" aria-pressed={passwordVisible} disabled={busy} onClick={() => setPasswordVisible(!passwordVisible)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{passwordVisible && <path d="m3 3 18 18" />}</svg>
              </button>
            </div>
          </div>
          <button type="submit" className="account-submit" disabled={busy}><span>{busy ? "Bekleyin…" : register ? "Hesap oluştur" : "Giriş yap"}</span><span aria-hidden="true">→</span></button>
        </form>
        <div className="account-login-switch"><p>{register ? "Zaten bir hesabınız var mı?" : "Henüz bir hesabınız yok mu?"}</p>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => { setRegister(!register); setPasswordVisible(false); setError(""); setNotice(""); }}>{register ? "Girişe dön" : "Yeni hesap oluştur"}</button>
        </div>
        <p className="account-form-footer">{register ? "Her kullanıcı kendi API bağlantılarını yönetir." : "Kullanıcı adınız ve parolanızla devam edin."}</p>
        <div className="account-help"><HelpLink /></div>
      </section>
    </div>
  </main>;
  return <>
    <AccountBar>
      <div><span className="account-bar-brand"><span className="brand-symbol" aria-hidden="true">D·</span>Deliberation AI</span><span className="account-role-badge">{session.user.role === "root" ? "Yönetim merkezi" : "Kişisel çalışma alanı"}</span></div>
      <div className="account-actions">
        <HelpLink />
        <AccountMenu name={session.user.displayName} username={session.user.username} role={session.user.role === "root" ? "Yönetici" : "Kişisel hesap"}>
        {session.user.role === "root" && <ThemeSelect />}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setPasswordPanel(!passwordPanel)}>Parolayı değiştir</button>
        {session.user.role === "user" && <button type="button" className="secondary-button danger-button" disabled={busy} onClick={() => setDeletion(!deletion)}>Hesabımı sil</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void logout()}>Çıkış yap</button>
        </AccountMenu>
      </div>
    </AccountBar>
    {error && <p className="account-message inline-error" role="alert">{error}</p>}{notice && <p className="account-message" role="status">{notice}</p>}
    {passwordPanel && <section className="account-panel" aria-label="Parola değiştirme"><h2>Parolayı değiştir</h2>
      <form onSubmit={changePassword}><label>Mevcut parola<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <label>Yeni parola<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} /></label><button disabled={busy}>Parolayı kaydet</button></form>
      <p>Diğer oturumlarınız kapatılır.</p></section>}
    {deletion && <AccountDeletionPanel onClose={() => setDeletion(false)} />}
    {session.user.role === "root" ? <RootManagement session={session} /> : <CouncilWorkbench key={`${session.user.id}:${session.scope.id}`} />}
  </>;
}
