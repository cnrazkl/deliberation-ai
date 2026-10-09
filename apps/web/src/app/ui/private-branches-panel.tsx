"use client";
import { ownerFetch } from "../../lib/session-fetch";
import { createBrowserRequestId } from "../../lib/browser-request-id";
import { useEffect, useRef, useState } from "react";
import type { CreatePrivateBranch, AppendPrivateDraft, PrivateBranchSeed } from "@deliberation-ai/contracts";
import type { PrivateBranchSummary, PrivateBranchView } from "@deliberation-ai/persistence";
import { PrivateDeliveryPanel } from "./private-delivery-panel";
import { PrivateBranchDeletionPanel } from "./private-branch-deletion-panel";
import { ConversationPrivateUsagePanel } from "./conversation-private-usage-panel";
import { readPrivateOutputDefault } from "../../lib/private-output-default";

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await ownerFetch(url, { ...options, cache: "no-store" });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(body.error ?? "Özel dal işlemi tamamlanamadı."), { status: response.status });
  return body;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function downloadBranch(id: string) {
  const body = await jsonRequest<unknown>(`/api/private-branches/${id}/export`, { method: "POST" });
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `deliberationai-private-branch-${id}.json`;
  document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PrivateBranchesPanel({ conversationId, initialBranch, onClose }: {
  conversationId: string; initialBranch?: PrivateBranchView; onClose: () => void;
}) {
  const [items, setItems] = useState<PrivateBranchSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialBranch?.id ?? null);
  const [branch, setBranch] = useState<PrivateBranchView | null>(initialBranch ?? null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialBranch));
  const [refresh, setRefresh] = useState(0);
  const [deletionId, setDeletionId] = useState<string | null>(null);
  const [preservedDraft, setPreservedDraft] = useState("");
  const alive = useRef(true); const working = useRef(false);
  const readGeneration = useRef(0);
  const drafts = useRef(new Map<string, string>());
  const [outputCaps, setOutputCaps] = useState<Record<string, number>>(() => initialBranch ? { [initialBranch.id]: readPrivateOutputDefault() } : {});
  const intent = useRef<{ key: string; body: CreatePrivateBranch | AppendPrivateDraft } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const generation = readGeneration.current;
    const controller = new AbortController();
    void jsonRequest<{ branches: PrivateBranchSummary[] }>(`/api/conversations/${conversationId}/private-branches`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted && generation === readGeneration.current) setItems(value.branches); })
      .catch((cause: unknown) => { if (!controller.signal.aborted && generation === readGeneration.current) setError(cause instanceof Error ? cause.message : "Dallar yüklenemedi."); })
      .finally(() => { if (!controller.signal.aborted && generation === readGeneration.current) setLoading(false); });
    return () => controller.abort();
  }, [conversationId, refresh]);
  useEffect(() => {
    if (!selectedId) return;
    const generation = readGeneration.current;
    const controller = new AbortController();
    void jsonRequest<PrivateBranchView>(`/api/private-branches/${selectedId}`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted && generation === readGeneration.current) setBranch(value); })
      .catch((cause: unknown) => { if (!controller.signal.aborted && generation === readGeneration.current) { setBranch(null); setError(cause instanceof Error ? cause.message : "Dal yüklenemedi."); } })
      .finally(() => { if (!controller.signal.aborted && generation === readGeneration.current) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, refresh]);
  useEffect(() => {
    if (!branch?.body.deliveries?.some((item) => ["prepared", "submitted"].includes(item.status))) return;
    const timer = window.setInterval(() => { if (!working.current) setRefresh((value) => value + 1); }, 2_000);
    return () => window.clearInterval(timer);
  }, [branch]);
  function reload() { ++readGeneration.current; setLoading(true); setDetailLoading(Boolean(selectedId)); setError(null); setRefresh((value) => value + 1); }
  function select(id: string) {
    if (working.current || deletionId || selectedId === id) return;
    if (selectedId) drafts.current.set(selectedId, text);
    setOutputCaps((previous) => previous[id] === undefined ? { ...previous, [id]: readPrivateOutputDefault() } : previous);
    ++readGeneration.current; setSelectedId(id); setBranch(null); setText(drafts.current.get(id) ?? ""); setDetailLoading(true); setError(null); intent.current = null;
    setRefresh((value) => value + 1);
  }
  async function mutate(action: "append" | "fork") {
    if (!branch || deletionId || working.current || loading || detailLoading) return;
    working.current = true; setBusy(true); setError(null);
    const key = JSON.stringify([action, branch.id, action === "append" ? text : [branch.revision, branch.body.deliveryVersion ?? 0]]);
    if (intent.current?.key !== key) intent.current = { key, body: action === "append" ?
      { requestId: createBrowserRequestId(), expectedRevision: branch.revision, text } :
      { action: "fork", requestId: createBrowserRequestId(), parentBranchId: branch.id, expectedRevision: branch.revision, expectedDeliveryVersion: branch.body.deliveryVersion ?? 0 } };
    try {
      const value = await jsonRequest<PrivateBranchView>(action === "append" ? `/api/private-branches/${branch.id}/messages` : "/api/private-branches", post(intent.current.body));
      if (!alive.current) return;
      intent.current = null;
      if (action === "append") { setText(""); drafts.current.delete(branch.id); }
      else {
        drafts.current.set(branch.id, text);
        setOutputCaps((previous) => ({ ...previous, [value.id]: readPrivateOutputDefault() }));
      }
      setBranch(value); setSelectedId(value.id); reload();
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof Error && "status" in cause && cause.status === 409) intent.current = null;
      setError(cause instanceof Error ? cause.message : "Dal kaydedilemedi.");
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function download() {
    if (!branch || working.current) return;
    working.current = true; setBusy(true); setError(null);
    try { await downloadBranch(branch.id); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Dal indirilemedi."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="settings-card" aria-label="Özel dal taslakları">
    <div className="config-heading"><strong>Özel dal taslakları</strong>
      <button type="button" className="secondary-button" disabled={busy || loading || Boolean(deletionId)} onClick={reload}>Dalları yenile</button>
      <button type="button" className="secondary-button" disabled={busy || Boolean(deletionId)} onClick={onClose}>Özel dalları kapat</button>
    </div>
    <p className="section-hint">Burada seçilen üyenin ilk yanıtı ve sizin mesaj taslaklarınız saklanır. Taslaklar modele gönderilmez; göndermek için ayrıca önizlemeyi inceleyip onaylayın. Konsey sorusu ve raporu değişmez.</p>
    <ConversationPrivateUsagePanel key={conversationId} conversationId={conversationId} />
    {error && <p role="alert" className="error">{error}</p>}
    {preservedDraft && <label>Silinen dalın kaydedilmemiş taslağı<textarea readOnly value={preservedDraft} /></label>}
    {loading ? <p>Dallar yükleniyor…</p> : <div className="run-history-list">
      {items.length === 0 && <p>Henüz özel dal yok. Kaydedilmiş bir raporun model ayrıntılarından dal açabilirsiniz.</p>}
      {items.map((item) => <article key={item.id} data-private-branch-id={item.id}>
        <small>{item.sourceMemberId} · {item.messageCount} taslak · {new Date(item.createdAt).toLocaleString("tr-TR")}{item.parentBranchId ? " · çatallanmış dal" : ""}</small>
        <button type="button" className="secondary-button" disabled={busy || detailLoading || Boolean(deletionId)} onClick={() => select(item.id)}>{selectedId === item.id ? "Açık özel dal" : "Özel dalı aç"}</button>
      </article>)}
    </div>}
    {detailLoading && <p>Dal yükleniyor…</p>}
    {branch && !detailLoading && <div aria-label="Açık özel dal">
      <strong>{branch.body.seed.member.label} · {branch.body.seed.member.model}</strong>
      <small>Dal: {branch.id} · Kaynak çalışma: {branch.sourceRunId}</small>
      {branch.body.forkedFrom && <p className="section-hint">Önceki dalın {branch.body.forkedFrom.messageCount} taslağı kopyalandı. Sonraki kayıtlar ayrı tutulur.</p>}
      <details><summary>Kopyalanan kaynak soru ve ilk yanıt</summary><p>{branch.body.seed.question}</p><pre>{branch.body.seed.rawText}</pre>
        {branch.body.seed.reusedFromRunId && <small>İlk yanıtın önceki kaynağı: {branch.body.seed.reusedFromRunId}</small>}
      </details>
      {branch.body.messages.map((message) => <article key={message.id}><strong>Sizin taslağınız{message.originBranchId !== branch.id ? " · önceki daldan kopya" : ""}</strong><pre>{message.text}</pre></article>)}
      <label>Özel mesaj taslağı<textarea value={text} maxLength={8_000} disabled={busy || Boolean(deletionId)} onChange={(event) => setText(event.target.value)} /></label>
      <div className="config-heading">
        <button type="button" className="secondary-button" disabled={busy || Boolean(deletionId) || loading || !text.trim() || branch.messageCount >= 64 || branch.body.deliveries?.some((item) => ["prepared", "submitted", "outcome_unknown"].includes(item.status))} onClick={() => void mutate("append")}>Taslağı dala kaydet</button>
        <button type="button" className="secondary-button" disabled={busy || Boolean(deletionId) || loading || branch.body.deliveries?.some((item) => ["prepared", "submitted", "outcome_unknown"].includes(item.status))} onClick={() => void mutate("fork")}>Bu noktadan yeni özel dal aç</button>
        <button type="button" className="secondary-button" disabled={busy || Boolean(deletionId)} onClick={() => void download()}>Özel dalı indir (JSON)</button>
        <button type="button" disabled={busy || loading || Boolean(deletionId)} onClick={() => setDeletionId(branch.id)}>Dal içeriğini silmeyi incele</button>
      </div>
      <PrivateDeliveryPanel key={`${branch.id}:${branch.revision}:${branch.body.deliveryVersion ?? 0}`} branch={branch} disabled={busy || Boolean(deletionId) || loading || detailLoading}
        maxOutputTokens={outputCaps[branch.id] ?? 1_024}
        onOutputCapChanged={(value) => setOutputCaps((previous) => ({ ...previous, [branch.id]: value }))}
        onChanged={reload} onBusy={(value) => { working.current = value; setBusy(value); }} />
      {deletionId && <PrivateBranchDeletionPanel key={deletionId} branchId={deletionId} onCancel={() => setDeletionId(null)}
        onBusy={(value) => { working.current = value; setBusy(value); }} onDeleted={() => {
          setPreservedDraft((previous) => [previous, text].filter(Boolean).join("\n\n")); drafts.current.delete(deletionId);
          setOutputCaps((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== deletionId)));
          intent.current = null; ++readGeneration.current; setDeletionId(null); setSelectedId(null); setBranch(null); setText("");
          setLoading(true); setDetailLoading(false); setRefresh((value) => value + 1);
        }} />}
      <p className="section-hint">İndirme ve konuşma dışa aktarımı özel taslakları okunabilir metin olarak içerir. Dal içeriği ayrı onayla silinebilir; kullanım kayıtları, kaynak rapor ve dış kopyalar korunur.</p>
    </div>}
  </section>;
}

export function PrivateBranchSeedButton({ runId, memberId }: { runId: string; memberId: string }) {
  const [preview, setPreview] = useState<{ conversationId: string; seed: PrivateBranchSeed; sha256: string } | null>(null);
  const [created, setCreated] = useState<PrivateBranchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false); const alive = useRef(true);
  const requestId = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function inspect() {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null); setPreview(null);
    try {
      const value = await jsonRequest<NonNullable<typeof preview>>(`/api/runs/${runId}/private-branch-seed?member=${encodeURIComponent(memberId)}`);
      if (alive.current) { setPreview(value); requestId.current = createBrowserRequestId(); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Kaynak yüklenemedi."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function create() {
    if (!preview || !requestId.current || working.current) return;
    working.current = true; setBusy(true); setError(null);
    try {
      const value = await jsonRequest<PrivateBranchView>("/api/private-branches", post({ action: "create", sourceRunId: runId, memberId,
        expectedSeedSha256: preview.sha256, requestId: requestId.current }));
      if (alive.current) { setCreated(value); setPreview(null); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Dal kaydedilemedi."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  return <div>
    <button type="button" className="secondary-button" disabled={busy || Boolean(created)} onClick={() => void inspect()}>Bu yanıtla özel dal taslağı aç</button>
    {error && <p role="alert" className="error">{error}</p>}
    {preview && <section aria-label="Özel dal kaynak önizlemesi">
      <p>Yalnız kaynak soru ve {preview.seed.member.label} üyesinin ilk ham yanıtı kopyalanacak. Önceki konuşma bağlamı, diğer üyeler, incelemeler ve ekler dahil edilmez. Kaynak içerik saklanır; yeni modele gönderim yapılmaz.</p>
      <details><summary>Kopyalanacak içeriği incele</summary><p>{preview.seed.question}</p><pre>{preview.seed.rawText}</pre></details>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void create()}>Özel dalı kaydet</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { setPreview(null); setError(null); }}>Vazgeç</button>
    </section>}
    {created && <PrivateBranchesPanel key={created.id} conversationId={created.conversationId} initialBranch={created} onClose={() => setCreated(null)} />}
  </div>;
}
