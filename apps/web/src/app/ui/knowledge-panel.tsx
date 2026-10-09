"use client";
import { ownerFetch, sessionOwner } from "../../lib/session-fetch";
import { createBrowserRequestId } from "../../lib/browser-request-id";
import { useId, useRef, useState } from "react";
import type { KnowledgePacket, KnowledgeScope, CreateRunRequest } from "@deliberation-ai/contracts";
import { inspectKnowledgeQuery } from "@deliberation-ai/contracts";
import { DisclosureSummary } from "./disclosure-summary";

type Collection = { collectionId: string; title: string; grantId: string; grantRevision: number; grantStatus: string; accountId: string };
type Selection = { revision: string; topic: string; grants: { scope: KnowledgeScope; available: boolean }[] };
type Source = { sourceId: string; versionId: string; name: string; status: string; reason: string | null; originalHash: string };
async function command<T>(value: unknown): Promise<T> {
  const response = await ownerFetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value), cache: "no-store" });
  const body = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Kaynak işlemi tamamlanamadı."); return body;
}
export function KnowledgePanel({ runId, onChange }: { runId: string | undefined;
  onChange: (reference: CreateRunRequest["knowledgePacket"] | null, blocked: boolean) => void }) {
  const [collections, setCollections] = useState<Collection[]>([]), [hasMore, setHasMore] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null), [selection, setSelection] = useState<Selection | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [topic, setTopic] = useState(""), [title, setTitle] = useState("");
  const [sources, setSources] = useState<Source[]>([]), [destination, setDestination] = useState("");
  const [packet, setPacket] = useState<KnowledgePacket | null>(null), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [allowEmpty, setAllowEmpty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fileInputId = useId(), fileInput = useRef<HTMLInputElement>(null);
  const queryInspection = inspectKnowledgeQuery(query);
  function invalidate() { setPacket(null); setReviewed(false); onChange(null, true); }
  async function work(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(null); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "İşlem tamamlanamadı."); } finally { setBusy(false); } }
  async function refresh(id = conversationId) {
    const state = await command<{ collections: { items: Collection[]; hasMore: boolean }; selection: Selection | null }>({ operation: "state", conversationId: id });
    setCollections(state.collections.items); setHasMore(state.collections.hasMore); setSelection(state.selection);
    setSelected(state.selection?.grants.map((item) => item.scope.collectionId) ?? []); setTopic(state.selection?.topic ?? "");
  }
  function scopeFor(id: string): KnowledgeScope {
    const item = collections.find((collection) => collection.collectionId === id)!;
    return { ownerId: sessionOwner(), accountId: "local", collectionId: id, grantId: item.grantId, grantRevision: item.grantRevision };
  }
  return <details className="composer-disclosure knowledge-panel"><DisclosureSummary title="Yerel bilgi kaynakları" description="Kütüphanenizden kaynak ve alıntı seçin" icon="knowledge" />
    <div className="knowledge-body">
      <div className="knowledge-intro">
        <p>Dosyalarınızı koleksiyonlara kaydedin, bu sohbet için kaynak seçin ve gönderilecek alıntıları inceleyin.</p>
        <p className="hint">Yalnız seçtiğiniz alıntılar ilk turdaki bütün üyelere gönderilir; tam dosyalar ve ikinci tur kaynakları gönderilmez. Görsel/OCR doğrulaması ve bağımsız kalite değerlendirmesi henüz yoktur.</p>
      </div>
      <section className="knowledge-step" aria-labelledby="knowledge-collections-heading">
        <div className="knowledge-step-heading"><span aria-hidden="true">1</span><div><h3 id="knowledge-collections-heading">Koleksiyonları düzenleyin</h3><p className="hint">Bir koleksiyon oluşturun veya mevcut koleksiyonlarınızı yükleyin.</p></div></div>
        <div className="knowledge-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void work(async () => { await refresh(); })}>Koleksiyonları göster</button>
        </div>
        <div className="knowledge-field-action">
          <label className="knowledge-field">Koleksiyon adı<input disabled={busy} value={title} placeholder="Örn. Proje belgeleri" maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
          <button className="secondary-button" type="button" disabled={busy || !title.trim()} onClick={() => void work(async () => { await command({ operation: "collection", title }); setTitle(""); await refresh(); })}>Koleksiyon oluştur</button>
        </div>
        {hasMore && <p className="hint">İlk 20 koleksiyon gösteriliyor; diğer koleksiyonlar bu seçimde aranmaz.</p>}
        <div className="knowledge-selection">
          <p className="hint">Okuma izni verin, bir kaynak sohbeti açın ve en fazla 3 koleksiyon seçerek seçimi kaydedin.</p>
          <div className="knowledge-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void work(async () => { invalidate(); const next = await command<{ conversationId: string }>({ operation: "conversation" }); setConversationId(next.conversationId); await refresh(next.conversationId); })}>Yeni kaynak sohbeti</button>
            {runId && <button className="secondary-button" type="button" disabled={busy} onClick={() => void work(async () => { invalidate(); const response = await ownerFetch(`/api/runs/${runId}/conversation`, { cache: "no-store" }); const next = await response.json() as { conversationId: string }; if (!response.ok) throw new Error("Sohbet okunamadı."); setConversationId(next.conversationId); await refresh(next.conversationId); })}>Açık raporun sohbetini seç</button>}
          </div>
          {collections.length > 0 && <div className="knowledge-collection-list">{collections.map((item) => <article className="knowledge-collection" key={item.collectionId}>
            <label className="knowledge-check"><input type="checkbox" disabled={busy || item.grantStatus !== "active" || !conversationId || selected.length >= 3 && !selected.includes(item.collectionId)} checked={selected.includes(item.collectionId)}
              onChange={(event) => { invalidate(); setSelected(event.target.checked ? [...selected, item.collectionId] : selected.filter((id) => id !== item.collectionId)); }} /><span>{item.title} · {item.grantStatus === "active" ? "Okuma izni açık" : "İzin kapalı"}</span></label>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void work(async () => { invalidate(); await command({ operation: "grant", collectionId: item.collectionId, revision: item.grantRevision, status: item.grantStatus === "active" ? "revoked" : "active" }); await refresh(); })}>{item.grantStatus === "active" ? "İzni iptal et" : "Okuma izni ver"}</button>
          </article>)}</div>}
          {conversationId && <div className="knowledge-field-action"><label className="knowledge-field">Sohbet konusu<input disabled={busy} value={topic} placeholder="Örn. Destek koşullarını karşılaştırma" maxLength={4_000} onChange={(event) => { invalidate(); setTopic(event.target.value); }} /></label>
            <button className="secondary-button" type="button" disabled={busy || !selected.length} onClick={() => void work(async () => { invalidate(); await command({ operation: "bind", conversationId, revision: selection?.revision ?? null, selection: { topic, scopes: selected.map(scopeFor) } }); await refresh(); })}>Seçimi kaydet</button></div>}
        </div>
      </section>
      <section className="knowledge-step" aria-labelledby="knowledge-files-heading">
        <div className="knowledge-step-heading"><span aria-hidden="true">2</span><div><h3 id="knowledge-files-heading">Dosyalarınızı ekleyin</h3><p className="hint">Dosyalar seçtiğiniz koleksiyona kaydedilir.</p></div></div>
        <label className="knowledge-field">Dosyaların kaydedileceği koleksiyon<select disabled={busy} value={destination} onChange={(event) => { setDestination(event.target.value); setSources([]); }}><option value="">Koleksiyon seçin</option>{collections.filter((item) => item.grantStatus === "active").map((item) => <option key={item.collectionId} value={item.collectionId}>{item.title}</option>)}</select></label>
        <div className="knowledge-upload">
          <label htmlFor={fileInputId}>Yerel kütüphaneye dosya seç</label>
          <p className="hint" id={`${fileInputId}-help`}>TXT, Markdown, PDF, PNG veya JPEG · En fazla 6 dosya, toplam 12 MiB.</p>
          <button className="secondary-button knowledge-file-button" type="button" disabled={busy || !destination} onClick={() => fileInput.current?.click()}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5" /></svg>Dosya seç</button>
          {!destination && <p className="hint">Dosya seçmek için önce okuma izni açık bir koleksiyon seçin.</p>}
          <input className="knowledge-file-input" ref={fileInput} id={fileInputId} aria-describedby={`${fileInputId}-help`} tabIndex={-1} type="file" multiple accept=".txt,.md,.markdown,.pdf,.png,.jpg,.jpeg" disabled={busy || !destination} onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = "";
      void work(async () => {
        invalidate(); if (!files.length || files.length > 6 || files.reduce((sum, file) => sum + file.size, 0) > 12 * 1_048_576) throw new Error("En fazla 6 dosya ve 12 MiB seçin.");
        const data = [];
        for (const file of files) {
          const extension = file.name.split(".").at(-1)?.toLowerCase();
          const mediaType = extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : ["jpg", "jpeg"].includes(extension ?? "") ? "image/jpeg" : extension === "txt" ? "text/plain" : ["md", "markdown"].includes(extension ?? "") ? "text/markdown" : null;
          if (!mediaType || file.size > (mediaType === "application/pdf" ? 5 : mediaType.startsWith("image/") ? 2 : 1) * 1_048_576) throw new Error("Dosya türü veya boyutu desteklenmiyor.");
          const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
          data.push({ sourceId: createBrowserRequestId(), expectedVersionId: null, name: file.name, mediaType, dataBase64: btoa(binary) });
        }
        await command({ operation: "import", scope: scopeFor(destination), files: data });
        const page = await command<{ items: Source[]; nextCursor: string | null }>({ operation: "sources", scope: scopeFor(destination), cursor: null });
        setSources(page.items); setNotice(page.nextCursor ? "İlk 20 dosya gösteriliyor; arama tüm seçili kaynaklara limit uygular." : "Dosyalar yerel kütüphaneye kaydedildi.");
      });
          }} />
        </div>
        {notice && <p className="knowledge-notice" role="status">{notice}</p>}
        {sources.length > 0 && <ul className="knowledge-source-list" aria-label="Eklenen dosyalar">{sources.map((item) => <li key={item.sourceId}>{item.name} · {item.status === "complete" ? "Metin çıkarıldı; içerik doğrulanmadı" : `Alıntı için kullanılamıyor: ${item.reason ?? item.status}`}</li>)}</ul>}
      </section>
      <section className="knowledge-step" aria-labelledby="knowledge-search-heading">
        <div className="knowledge-step-heading"><span aria-hidden="true">3</span><div><h3 id="knowledge-search-heading">Alıntıları hazırlayın ve inceleyin</h3><p className="hint">Kaynak paketi kullanmak için önce gönderilecek alıntıları inceleyin.</p></div></div>
        <label className="knowledge-field">Arama sözcükleri<input disabled={busy} value={query} placeholder="Örn. kritik destek" maxLength={4_000}
      aria-describedby="knowledge-query-help knowledge-query-feedback" aria-invalid={Boolean(query && !queryInspection.valid)}
      onChange={(event) => { invalidate(); setQuery(event.target.value); }} /></label>
        <p className="hint" id="knowledge-query-help">Kaynakta geçen kısa sözcükleri açıkça girin. En fazla 12 farklı sözcük kullanın; arama bütün sözcükleri aynı kaynakta birlikte arar. Sorunuz otomatik aktarılmaz.</p>
        <p className="knowledge-query-feedback" id="knowledge-query-feedback" role="status">{queryInspection.termCount}/12 farklı arama sözcüğü{!queryInspection.valid ? " · " + queryInspection.message : ""}</p>
        <label className="knowledge-check knowledge-option"><input type="checkbox" disabled={busy} checked={allowEmpty} onChange={(event) => { invalidate(); setAllowEmpty(event.target.checked); }} /><span>Arama sonuçsuz kalırsa kanıtsız paketi ayrıca inceleyerek devam edebilirim</span></label>
        {!selection && <p className="hint">Paketi hazırlamak için 1. adımda sohbetin koleksiyon seçimini kaydedin.</p>}
        <div className="knowledge-actions"><button type="button" disabled={busy || !selection || !queryInspection.valid} onClick={() => void work(async () => { invalidate(); const value = await command<KnowledgePacket>({ operation: "prepare", id: createBrowserRequestId(), conversationId, selectionRevision: selection!.revision, query: query.trim(), allowWithoutEvidence: allowEmpty }); setPacket(value); })}>Kanıt paketini hazırla</button></div>
        {packet && <section className="knowledge-packet" aria-label="Hazırlanan kaynak paketi"><h4>Gönderilecek kaynak paketi</h4><p>Arama: {packet.query} · Konu: {packet.topic || "Belirtilmedi"}</p><p className="hint">{packet.excerpts.length} alıntı · {packet.excerpts.reduce((sum, item) => sum + item.text.length, 0)} karakter · {packet.createdAt}. İçerik ve güncellik incelenmedi. Hazırlama sonrası sürüm değişirse yeniden hazırlayın.</p>
          <div className="knowledge-coverage">{packet.coverage.map((item) => <p key={item.collectionId}>{collections.find((collection) => collection.collectionId === item.collectionId)?.title ?? item.collectionId}: {item.inspected} dosya, {item.matches} eşleşme, {item.selected} alıntı, {item.omitted} dışarıda, {item.unavailable} kullanılamıyor.</p>)}</div>
          {packet.excerpts.map((item) => <article className="knowledge-excerpt" key={item.excerptId}><strong>{item.source.title} · sayfa {item.page ?? "metin"}</strong><p className="hint">Sürüm {item.source.versionId} · konum {item.start}–{item.end}</p><pre>{item.text}</pre></article>)}
          {packet.omissions.map((item) => <p className="knowledge-notice" key={item.sourceId}>Dışarıda: {item.title} · {item.reason === "duplicate" ? "Aynı içerik; bağımsız doğrulama sayılmaz" : "Alıntı bütçesi"} · sürüm {item.versionId}</p>)}
          {packet.withoutEvidence && <p className="knowledge-notice">Bu paket kaynak kanıtı içermiyor.</p>}
          <label className="knowledge-check knowledge-review"><input type="checkbox" disabled={busy} checked={reviewed} onChange={(event) => { setReviewed(event.target.checked); onChange(event.target.checked ? { id: packet.id, fingerprint: packet.fingerprint, reviewed: true } : null, !event.target.checked); }} /><span>Alıntıları, eksikleri ve bütün ilk tur üyelerine gönderimi inceledim</span></label>
        </section>}
      </section>
      <div className="knowledge-footer">
        <p className="hint">Bu sohbet için kaynak kullanmak isteğe bağlıdır.</p>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => { setPacket(null); setReviewed(false); onChange(null, false); }}>Kaynak paketi olmadan devam et</button>
      </div>
      {error && <p className="knowledge-error" role="alert">{error}</p>}
    </div>
  </details>;
}
