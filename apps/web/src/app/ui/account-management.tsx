"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { LocalAccountDeletionPreview, LocalSessionSummary, LocalUserSummary } from "@deliberation-ai/contracts";
import { ownerFetch } from "../../lib/session-fetch";
import { accountRequest, announceSessionChange } from "../../lib/account-client";

export function AccountDeletionPanel({ user, onClose }: { user?: LocalUserSummary; onClose: () => void }) {
  const [preview, setPreview] = useState<LocalAccountDeletionPreview | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const path = user ? `users/${user.id}/deletion` : "account/deletion";
  useEffect(() => {
    let active = true;
    void accountRequest<LocalAccountDeletionPreview>(path).then(result => { if (active) setPreview(result); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Hesap incelenemedi."); });
    return () => { active = false; };
  }, [path]);
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!preview) return; setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try {
      await accountRequest(path, { currentPassword: String(form.get("currentPassword")), username: String(form.get("username")), fingerprint: preview.fingerprint });
      announceSessionChange(); window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Hesap silinemedi."); setBusy(false); }
  }
  return <section className="account-panel account-panel-danger" aria-label="Hesap silme"><span className="account-form-eyebrow">KALICI SİLME</span><h2>Hesabı kalıcı olarak sil</h2>
    <p>Hesap, tüm oturumları, sohbetleri, özel mesajları, kaynakları, zamanlamaları ve API bağlantıları bu kurulumdan kalıcı olarak silinir.</p>
    <p>Önceden alınan yedekler ve dışa aktarılan dosyalar ayrıca yönetilir. Silme, sağlayıcılardaki API anahtarlarını iptal etmez.</p>
    {error && <p role="alert" className="inline-error">{error}</p>}
    {!preview && !error && <p>Hesap verileri inceleniyor…</p>}
    {preview && <><p><strong>@{preview.user.username}</strong> · {preview.runCount} sohbet çalışması · {preview.connectionCount} bağlantı · {preview.recordCount} uygulama kaydı</p>
      {preview.blockers.map(block => <p key={block} role="alert">{block}</p>)}
      {preview.eligible && <form onSubmit={confirm}>
        <label>Silinecek kullanıcı adı<input name="username" required autoComplete="off" /></label>
        <label>{user ? "Root parolanız" : "Mevcut parolanız"}<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <label className="account-check"><input type="checkbox" required />Tüm hesap verilerinin kalıcı silinmesini onaylıyorum.</label>
        <button type="submit" className="danger-submit" disabled={busy}>Hesabı silmeyi onayla</button>
      </form>}
    </>}
    <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Vazgeç</button>
  </section>;
}
type Connection = { id: string; label: string; defaultModel?: string; endpoint?: string; [key: string]: unknown };
type Connections = { provider: Connection[]; mcp: Connection[]; decision: Connection[] };
export function RootManagement({ session }: { session: LocalSessionSummary }) {
  const [users, setUsers] = useState<LocalUserSummary[]>([]), [edited, setEdited] = useState<LocalUserSummary | null>(null);
  const [connections, setConnections] = useState<Connections | null>(null), [deletion, setDeletion] = useState<LocalUserSummary | null>(null);
  const [connectionEdit, setConnectionEdit] = useState<{ kind: keyof Connections; item: Connection } | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""), [loaded, setLoaded] = useState(false);
  const ordinaryUsers = users.filter(user => user.role === "user");
  const search = query.trim().toLowerCase();
  const visibleUsers = ordinaryUsers.filter(user => `${user.username} ${user.displayName}`.toLowerCase().includes(search));
  const scope = session.scope.role === "user" ? session.scope : null;
  useEffect(() => {
    let active = true;
    void accountRequest<{ users: LocalUserSummary[] }>("users").then(result => { if (active) { setUsers(result.users); setLoaded(true); } }).catch(() => { if (active) { setError("Kullanıcılar alınamadı."); setLoaded(true); } });
    if (scope) void accountRequest<Connections>(`users/${scope.id}/connections`).then(result => { if (active) setConnections(result); }).catch(() => { if (active) setError("Bağlantılar alınamadı."); });
    return () => { active = false; };
  }, [scope]);
  async function chooseScope(user: LocalUserSummary) {
    setError(""); setBusy(true);
    try { await accountRequest("scope", { userId: user.id }); announceSessionChange(); window.location.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Kullanıcı seçilemedi."); setBusy(false); }
  }
  async function updateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!edited) return; setBusy(true); setError("");
    const form = new FormData(event.currentTarget), password = String(form.get("password"));
    try {
      await accountRequest(`users/${edited.id}`, { username: String(form.get("username")), displayName: String(form.get("displayName")), ...(password ? { password } : {}) }, "PATCH");
      setEdited(null); setUsers((await accountRequest<{ users: LocalUserSummary[] }>("users")).users); setNotice("Kullanıcı güncellendi."); announceSessionChange();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kullanıcı güncellenemedi."); } finally { setBusy(false); }
  }
  async function changeConnection(kind: keyof Connections, item: Connection, form?: FormData) {
    setBusy(true); setError("");
    try {
      const endpoint = `/api/${kind === "provider" ? "provider" : kind === "mcp" ? "mcp" : "decision"}-connections`;
      const response = await ownerFetch(form ? endpoint : `${endpoint}?id=${encodeURIComponent(item.id)}`, {
        method: form ? "POST" : "DELETE", ...(form ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...item,
          label: String(form.get("label")), ...(kind === "mcp" ? { endpoint: String(form.get("endpoint")) } : { defaultModel: String(form.get("defaultModel")), apiKey: String(form.get("apiKey")) }) }) } : {}) });
      const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error ?? "Bağlantı değiştirilemedi.");
      setConnectionEdit(null); setConnections(await accountRequest<Connections>(`users/${scope!.id}/connections`)); setNotice(form ? "Bağlantı güncellendi." : "Bağlantı silindi.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Bağlantı değiştirilemedi."); } finally { setBusy(false); }
  }
  return <main className="account-admin">
    {error && <p className="account-message inline-error" role="alert">{error}</p>}{notice && <p className="account-message" role="status">{notice}</p>}
    <section className="account-panel" aria-label="Kullanıcı yönetimi">
      <div className="account-admin-heading"><div><span className="account-form-eyebrow">YÖNETİM MERKEZİ</span><h1>Kullanıcı yönetimi</h1><p>Kayıtlı kullanıcıları, hesap bilgilerini ve bağlantılarını tek yerden yönetin.</p></div><span className="account-count">{loaded ? `${ordinaryUsers.length} kullanıcı` : "Yükleniyor…"}</span></div>
      <div className="account-user-toolbar"><label htmlFor="account-user-search">Kullanıcı ara</label><input id="account-user-search" type="search" placeholder="Kullanıcı adı veya görünen ad" value={query} onChange={event => setQuery(event.target.value)} disabled={!loaded} />{search && <p role="status">{visibleUsers.length} kullanıcı bulundu.</p>}</div>
      {!loaded && <p role="status">Kullanıcılar yükleniyor…</p>}
      {loaded && !error && ordinaryUsers.length === 0 && <div className="account-empty-state"><strong>İlk kullanıcı henüz kaydolmadı</strong><p>Yeni kullanıcılar giriş ekranındaki “Yeni hesap oluştur” düğmesiyle kendi hesaplarını açabilir.</p></div>}
      {loaded && ordinaryUsers.length > 0 && visibleUsers.length === 0 && <div className="account-empty-state"><strong>Eşleşen kullanıcı yok</strong><p>Farklı bir ad deneyin veya arama alanını temizleyin.</p></div>}
      <div className="account-user-list">{visibleUsers.map(user => <article key={user.id} data-selected={scope?.id === user.id || undefined}><span className="account-user-avatar" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</span><div className="account-user-identity"><strong>{user.displayName}</strong><small>@{user.username}{scope?.id === user.id ? " · Bağlantıları açık" : ""}</small></div><div className="account-user-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void chooseScope(user)}>Bağlantıları yönet</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => setEdited(user)}>Kullanıcıyı düzenle</button>
        <button className="secondary-button danger-button" type="button" disabled={busy} onClick={() => setDeletion(user)}>Kullanıcıyı sil</button>
      </div></article>)}</div>
      {edited && <section className="account-edit-section" aria-label="Kullanıcı düzenleme"><h2>{edited.username} — hesap bilgileri</h2><form key={edited.id} onSubmit={updateUser}>
        <label>Görünen ad<input name="displayName" required maxLength={80} defaultValue={edited.displayName} /></label>
        <label>Kullanıcı adı<input name="username" required minLength={3} maxLength={32} defaultValue={edited.username} /></label>
        <label>Yeni parola<input name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" /></label>
        <p>Parolayı değiştirmek istemiyorsanız boş bırakın. Parola veya kullanıcı adı değişince kullanıcının oturumları kapatılır.</p>
        <button disabled={busy}>Kullanıcıyı kaydet</button><button className="secondary-button" type="button" onClick={() => setEdited(null)}>Vazgeç</button>
      </form></section>}
    </section>
    {deletion && <AccountDeletionPanel key={deletion.id} user={deletion} onClose={() => setDeletion(null)} />}
    {scope && connections && <section className="account-panel" aria-label={`${scope.username} bağlantıları`}><h2>{scope.displayName} — bağlantılar</h2>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void chooseScope(session.user)}>Bağlantıları kapat</button>
      {(["provider", "mcp", "decision"] as const).map(kind => connections[kind].map(item => <article className="account-connection" key={item.id}>
        <p>{item.label} · {kind === "mcp" ? "MCP" : item.defaultModel}</p>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => setConnectionEdit({ kind, item })}>Bağlantıyı düzenle</button>
        <details><summary>Bağlantıyı sil</summary><p>Bu bağlantı kaydı ve kayıtlı anahtarı silinir.</p><button type="button" disabled={busy} onClick={() => void changeConnection(kind, item)}>Bağlantıyı silmeyi onayla</button></details>
      </article>))}
      {!Object.values(connections).some(items => items.length) && <p>Kayıtlı bağlantı yok.</p>}
      {connectionEdit && <form key={connectionEdit.item.id} onSubmit={event => { event.preventDefault(); void changeConnection(connectionEdit.kind, connectionEdit.item, new FormData(event.currentTarget)); }}>
        <label>Bağlantı adı<input name="label" required maxLength={80} defaultValue={connectionEdit.item.label} /></label>
        {connectionEdit.kind === "mcp" ? <label>Adres<input name="endpoint" type="url" required defaultValue={connectionEdit.item.endpoint} /></label> : <>
          <label>Varsayılan model<input name="defaultModel" required maxLength={120} defaultValue={connectionEdit.item.defaultModel} /></label>
          <label>Yeni API anahtarı<input name="apiKey" type="password" maxLength={512} autoComplete="new-password" /></label><p>Boş bırakılırsa mevcut anahtar korunur.</p>
        </>}
        <button disabled={busy}>Bağlantıyı kaydet</button><button className="secondary-button" type="button" onClick={() => setConnectionEdit(null)}>Vazgeç</button>
      </form>}
    </section>}
  </main>;
}
