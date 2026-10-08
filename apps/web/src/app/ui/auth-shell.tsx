"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LocalSessionSummary } from "@deliberation-ai/contracts";
import { setSessionOwner } from "../../lib/session-fetch";
import { CouncilWorkbench } from "./council-workbench";
import { AccountDeletionPanel, RootManagement } from "./account-management";
import { accountRequest, announceSessionChange } from "../../lib/account-client";

export function AuthShell() {
  const [session, setSession] = useState<LocalSessionSummary | null>(null);
  const previousSession = useRef<LocalSessionSummary | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [register, setRegister] = useState(false), [busy, setBusy] = useState(false);
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
        target.reset(); setRegister(false); setNotice("Hesabınız oluşturuldu. Şimdi giriş yapabilirsiniz.");
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
  if (!ready) return <main className="account-login"><p>Oturum kontrol ediliyor…</p></main>;
  if (!session) return <main className="account-login"><section className="account-login-card">
    <span className="eyebrow">DELIBERATION AI</span><h1>{register ? "Hesap oluştur" : "Giriş yap"}</h1>
    <p>{register ? "Kendi kullanıcı adınızı ve parolanızı seçin." : "API bağlantılarınızı ve sohbetlerinizi kendi hesabınızda yönetin."}</p>
    {error && <p role="alert" className="inline-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form onSubmit={authenticate}>
      <label>Kullanıcı adı<input name="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*" /></label>
      <label>Parola<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : 1} maxLength={128} /></label>
      <button type="submit" disabled={busy}>{busy ? "Bekleyin…" : register ? "Hesap oluştur" : "Giriş yap"}</button>
    </form>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { setRegister(!register); setError(""); setNotice(""); }}>{register ? "Girişe dön" : "Yeni hesap oluştur"}</button>
  </section></main>;
  return <>
    <header className="account-bar" aria-label="Hesap">
      <div><strong>{session.user.displayName}</strong><small>@{session.user.username} {session.user.role === "root" ? "· Root" : ""}</small>
        </div>
      <div className="account-actions">
        {session.user.role === "user" && <button type="button" className="secondary-button" disabled={busy} onClick={() => setDeletion(!deletion)}>Hesabımı sil</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setPasswordPanel(!passwordPanel)}>Parolayı değiştir</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void logout()}>Çıkış yap</button>
      </div>
    </header>
    {error && <p className="account-message inline-error" role="alert">{error}</p>}{notice && <p className="account-message" role="status">{notice}</p>}
    {passwordPanel && <section className="account-panel" aria-label="Parola değiştirme"><h2>Parolayı değiştir</h2>
      <form onSubmit={changePassword}><label>Mevcut parola<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <label>Yeni parola<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} /></label><button disabled={busy}>Parolayı kaydet</button></form>
      <p>Diğer oturumlarınız kapatılır.</p></section>}
    {deletion && <AccountDeletionPanel onClose={() => setDeletion(false)} />}
    {session.user.role === "root" ? <RootManagement session={session} /> : <CouncilWorkbench key={`${session.user.id}:${session.scope.id}`} />}
  </>;
}
