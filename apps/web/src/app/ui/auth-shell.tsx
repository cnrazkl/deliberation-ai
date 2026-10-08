"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LocalSessionSummary, LocalUserSummary } from "@deliberation-ai/contracts";
import { setSessionOwner } from "../../lib/session-fetch";
import { CouncilWorkbench } from "./council-workbench";

type Connections = { provider: Array<{ id: string; label: string; provider: string; defaultModel: string }>;
  mcp: Array<{ id: string; label: string; endpoint: string }>; decision: Array<{ id: string; label: string }> };
async function accountRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, { cache: "no-store", ...(body !== undefined ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Hesap işlemi tamamlanamadı.");
  return result;
}
function announceSessionChange() { const channel = new BroadcastChannel("deliberation-accounts"); channel.postMessage("changed"); channel.close(); }
export function AuthShell() {
  const [session, setSession] = useState<LocalSessionSummary | null>(null);
  const previousSession = useRef<LocalSessionSummary | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [register, setRegister] = useState(false), [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<LocalUserSummary[]>([]), [management, setManagement] = useState(false);
  const [inspected, setInspected] = useState<{ user: LocalUserSummary; connections: Connections } | null>(null);
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
          setUsers([]); setInspected(null); setManagement(false);
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
        await accountRequest("register", { username, password, displayName: String(form.get("displayName")) });
        target.reset(); setRegister(false); setNotice("Hesabınız oluşturuldu. Şimdi giriş yapabilirsiniz.");
      } else {
        await accountRequest("login", { username, password }); announceSessionChange(); window.location.reload();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "İşlem tamamlanamadı."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try { await accountRequest("logout", {}); setSessionOwner(null); setSession(null); setUsers([]); setInspected(null); announceSessionChange(); window.location.reload(); }
    catch { setError("Çıkış yapılamadı; tekrar deneyin."); setBusy(false); }
  }
  async function showUsers() {
    setError(""); setBusy(true);
    try { const result = await accountRequest<{ users: LocalUserSummary[] }>("users"); setUsers(result.users); setManagement(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Kullanıcılar alınamadı."); }
    finally { setBusy(false); }
  }
  async function chooseScope(user: LocalUserSummary) {
    setError(""); setBusy(true);
    try { await accountRequest("scope", { userId: user.id }); setSessionOwner(null); setSession(null); announceSessionChange(); window.location.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Kullanıcı alanı açılamadı."); setBusy(false); }
  }
  async function inspectConnections(user: LocalUserSummary) {
    setBusy(true); setError("");
    try { const connections = await accountRequest<Connections>(`users/${user.id}/connections`); setInspected({ user, connections }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Bağlantılar alınamadı."); }
    finally { setBusy(false); }
  }
  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const target = event.currentTarget, form = new FormData(target);
    try { await accountRequest("users", { username: String(form.get("username")), displayName: String(form.get("displayName")), password: String(form.get("password")) }); target.reset(); await showUsers(); setNotice("Kullanıcı oluşturuldu."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Kullanıcı oluşturulamadı."); }
    finally { setBusy(false); }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { await accountRequest("password", { currentPassword: String(form.get("currentPassword")), password: String(form.get("password")) }); announceSessionChange(); window.location.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Parola değiştirilemedi."); setBusy(false); }
  }
  if (!ready) return <main className="account-login"><p>Oturum kontrol ediliyor…</p></main>;
  if (!session) return <main className="account-login"><section className="account-login-card">
    <span className="eyebrow">DELIBERATION AI</span><h1>{register ? "Hesap oluştur" : "Giriş yap"}</h1>
    <p>API bağlantılarınızı ve sohbetlerinizi kendi hesabınızda yönetin.</p>
    {error && <p role="alert" className="inline-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form onSubmit={authenticate}>
      {register && <label>Adınız<input name="displayName" autoComplete="name" required maxLength={80} /></label>}
      <label>Kullanıcı adı<input name="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*" /></label>
      <label>Parola<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : 1} maxLength={128} /></label>
      <button type="submit" disabled={busy}>{busy ? "Bekleyin…" : register ? "Hesap oluştur" : "Giriş yap"}</button>
    </form>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { setRegister(!register); setError(""); setNotice(""); }}>{register ? "Girişe dön" : "Yeni hesap oluştur"}</button>
  </section></main>;
  return <>
    <header className="account-bar" aria-label="Hesap">
      <div><strong>{session.user.displayName}</strong><small>@{session.user.username} {session.user.role === "root" ? "· Root" : ""}</small>
        {session.scope.id !== session.user.id && <span className="account-scope">{session.scope.displayName} kullanıcısının alanı</span>}</div>
      <div className="account-actions">
        {session.user.role === "root" && <button type="button" className="secondary-button" disabled={busy} onClick={() => management ? setManagement(false) : void showUsers()}>Kullanıcı yönetimi</button>}
        {session.scope.id !== session.user.id && <button type="button" className="secondary-button" disabled={busy} onClick={() => void chooseScope(session.user)}>Root alanına dön</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setPasswordPanel(!passwordPanel)}>Parolayı değiştir</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void logout()}>Çıkış yap</button>
      </div>
    </header>
    {error && <p className="account-message inline-error" role="alert">{error}</p>}{notice && <p className="account-message" role="status">{notice}</p>}
    {passwordPanel && <section className="account-panel" aria-label="Parola değiştirme"><h2>Parolayı değiştir</h2>
      <form onSubmit={changePassword}><label>Mevcut parola<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <label>Yeni parola<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} /></label><button disabled={busy}>Parolayı kaydet</button></form>
      <p>Diğer oturumlarınız kapatılır.</p></section>}
    {management && session.user.role === "root" && <section className="account-panel" aria-label="Kullanıcı yönetimi"><h2>Kullanıcı yönetimi</h2>
      <p>Kullanıcı alanını açınca o hesaba ait bağlantı ve sohbetleri yönetebilirsiniz. Kaydedilmemiş taslak bu sayfada kapanır.</p>
      <div className="account-user-list">{users.map(user => <article key={user.id}><div><strong>{user.displayName}</strong><small>@{user.username} · {user.role === "root" ? "Root" : "Kullanıcı"}</small></div>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void inspectConnections(user)}>Bağlantıları gör</button>
        <button type="button" disabled={busy} onClick={() => void chooseScope(user)}>Kullanıcı alanını aç</button></article>)}</div>
      {inspected && <section aria-label={`${inspected.user.username} bağlantıları`}><h3>{inspected.user.displayName} — bağlantılar</h3>
        {inspected.connections.provider.map(item => <p key={item.id}>{item.label} · {item.provider} · {item.defaultModel}</p>)}
        {inspected.connections.mcp.map(item => <p key={item.id}>{item.label} · MCP</p>)}
        {inspected.connections.decision.map(item => <p key={item.id}>{item.label} · Karar sağlayıcısı</p>)}
        {!Object.values(inspected.connections).some(items => items.length) && <p>Kayıtlı bağlantı yok.</p>}</section>}
      <details><summary>Yeni kullanıcı oluştur</summary><form onSubmit={createUser}>
        <label>Adı<input name="displayName" required maxLength={80} autoComplete="off" /></label>
        <label>Kullanıcı adı<input name="username" required minLength={3} maxLength={32} autoComplete="off" /></label>
        <label>Başlangıç parolası<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>
        <button disabled={busy}>Kullanıcı oluştur</button></form></details>
    </section>}
    <CouncilWorkbench key={`${session.user.id}:${session.scope.id}`} />
  </>;
}
