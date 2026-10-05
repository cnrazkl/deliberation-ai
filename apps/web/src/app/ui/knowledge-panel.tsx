"use client";
import { useState } from "react";
import type { KnowledgePacket, KnowledgeScope, CreateRunRequest } from "@deliberation-ai/contracts";

type Collection = { collectionId: string; title: string; grantId: string; grantRevision: number; grantStatus: string; accountId: string };
type Selection = { revision: string; topic: string; grants: { scope: KnowledgeScope; available: boolean }[] };
type Source = { sourceId: string; versionId: string; name: string; status: string; reason: string | null; originalHash: string };
async function command<T>(value: unknown): Promise<T> {
  const response = await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value), cache: "no-store" });
  const body = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Kaynak işlemi tamamlanamadı."); return body;
}
export function KnowledgePanel({ question, runId, onChange }: { question: string; runId: string | undefined;
  onChange: (reference: CreateRunRequest["knowledgePacket"] | null, blocked: boolean) => void }) {
  const [collections, setCollections] = useState<Collection[]>([]), [hasMore, setHasMore] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null), [selection, setSelection] = useState<Selection | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [topic, setTopic] = useState(""), [title, setTitle] = useState("");
  const [sources, setSources] = useState<Source[]>([]), [destination, setDestination] = useState("");
  const [packet, setPacket] = useState<KnowledgePacket | null>(null), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [allowEmpty, setAllowEmpty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  function invalidate() { setPacket(null); setReviewed(false); onChange(null, true); }
  async function work(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(null); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "İşlem tamamlanamadı."); } finally { setBusy(false); } }
  async function refresh(id = conversationId) {
    const state = await command<{ collections: { items: Collection[]; hasMore: boolean }; selection: Selection | null }>({ operation: "state", conversationId: id });
    setCollections(state.collections.items); setHasMore(state.collections.hasMore); setSelection(state.selection);
    setSelected(state.selection?.grants.map((item) => item.scope.collectionId) ?? []); setTopic(state.selection?.topic ?? "");
  }
  function scopeFor(id: string): KnowledgeScope {
    const item = collections.find((collection) => collection.collectionId === id)!;
    return { ownerId: "local-owner", accountId: "local", collectionId: id, grantId: item.grantId, grantRevision: item.grantRevision };
  }
  return <details className="composer-disclosure knowledge-panel"><summary>Yerel bilgi kaynakları</summary>
    <p>Büyük veya tekrar kullanılan dosyaları koleksiyona kaydedin. Yalnız seçtiğiniz alıntılar ilk turdaki bütün üyelere gönderilir; tam dosyalar ve ikinci tur kaynakları gönderilmez. Görsel/OCR doğrulaması ve bağımsız kalite değerlendirmesi henüz yoktur.</p>
    <button type="button" disabled={busy} onClick={() => void work(async () => { await refresh(); })}>Koleksiyonları göster</button>
    <button type="button" disabled={busy} onClick={() => void work(async () => { invalidate(); const next = await command<{ conversationId: string }>({ operation: "conversation" }); setConversationId(next.conversationId); await refresh(next.conversationId); })}>Yeni kaynak sohbeti</button>
    {runId && <button type="button" disabled={busy} onClick={() => void work(async () => { invalidate(); const response = await fetch(`/api/runs/${runId}/conversation`, { cache: "no-store" }); const next = await response.json() as { conversationId: string }; if (!response.ok) throw new Error("Sohbet okunamadı."); setConversationId(next.conversationId); await refresh(next.conversationId); })}>Açık raporun sohbetini seç</button>}
    <label>Koleksiyon adı<input disabled={busy} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
    <button type="button" disabled={busy || !title.trim()} onClick={() => void work(async () => { await command({ operation: "collection", title }); setTitle(""); await refresh(); })}>Koleksiyon oluştur</button>
    {hasMore && <p>İlk 20 koleksiyon gösteriliyor; diğer koleksiyonlar bu seçimde aranmaz.</p>}
    {collections.map((item) => <article key={item.collectionId}><label><input type="checkbox" disabled={busy || item.grantStatus !== "active" || !conversationId || selected.length >= 3 && !selected.includes(item.collectionId)} checked={selected.includes(item.collectionId)}
      onChange={(event) => { invalidate(); setSelected(event.target.checked ? [...selected, item.collectionId] : selected.filter((id) => id !== item.collectionId)); }} />{item.title} · {item.grantStatus === "active" ? "Okuma izni açık" : "İzin kapalı"}</label>
      <button type="button" disabled={busy} onClick={() => void work(async () => { invalidate(); await command({ operation: "grant", collectionId: item.collectionId, revision: item.grantRevision, status: item.grantStatus === "active" ? "revoked" : "active" }); await refresh(); })}>{item.grantStatus === "active" ? "İzni iptal et" : "Okuma izni ver"}</button>
    </article>)}
    {conversationId && <><label>Sohbet konusu<input disabled={busy} value={topic} maxLength={4_000} onChange={(event) => { invalidate(); setTopic(event.target.value); }} /></label>
      <button type="button" disabled={busy || !selected.length} onClick={() => void work(async () => { invalidate(); await command({ operation: "bind", conversationId, revision: selection?.revision ?? null, selection: { topic, scopes: selected.map(scopeFor) } }); await refresh(); })}>Seçimi kaydet</button></>}
    <label>Dosyaların kaydedileceği koleksiyon<select disabled={busy} value={destination} onChange={(event) => { setDestination(event.target.value); setSources([]); }}><option value="">Koleksiyon seçin</option>{collections.filter((item) => item.grantStatus === "active").map((item) => <option key={item.collectionId} value={item.collectionId}>{item.title}</option>)}</select></label>
    <label>Yerel kütüphaneye dosya seç<input type="file" multiple accept=".txt,.md,.markdown,.pdf,.png,.jpg,.jpeg" disabled={busy || !destination} onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = "";
      void work(async () => {
        invalidate(); if (!files.length || files.length > 6 || files.reduce((sum, file) => sum + file.size, 0) > 12 * 1_048_576) throw new Error("En fazla 6 dosya ve 12 MiB seçin.");
        const data = [];
        for (const file of files) {
          const extension = file.name.split(".").at(-1)?.toLowerCase();
          const mediaType = extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : ["jpg", "jpeg"].includes(extension ?? "") ? "image/jpeg" : extension === "txt" ? "text/plain" : ["md", "markdown"].includes(extension ?? "") ? "text/markdown" : null;
          if (!mediaType || file.size > (mediaType === "application/pdf" ? 5 : mediaType.startsWith("image/") ? 2 : 1) * 1_048_576) throw new Error("Dosya türü veya boyutu desteklenmiyor.");
          const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
          data.push({ sourceId: crypto.randomUUID(), expectedVersionId: null, name: file.name, mediaType, dataBase64: btoa(binary) });
        }
        await command({ operation: "import", scope: scopeFor(destination), files: data });
        const page = await command<{ items: Source[]; nextCursor: string | null }>({ operation: "sources", scope: scopeFor(destination), cursor: null });
        setSources(page.items); setNotice(page.nextCursor ? "İlk 20 dosya gösteriliyor; arama tüm seçili kaynaklara limit uygular." : "Dosyalar yerel kütüphaneye kaydedildi.");
      });
    }} /></label>
    {notice && <p>{notice}</p>}{sources.map((item) => <p key={item.sourceId}>{item.name} · {item.status === "complete" ? "Metin çıkarıldı; içerik doğrulanmadı" : `Alıntı için kullanılamıyor: ${item.reason ?? item.status}`}</p>)}
    <label>Arama sözcükleri<input disabled={busy} value={query} placeholder={question} maxLength={4_000} onChange={(event) => { invalidate(); setQuery(event.target.value); }} /></label>
    <label><input type="checkbox" disabled={busy} checked={allowEmpty} onChange={(event) => { invalidate(); setAllowEmpty(event.target.checked); }} />Arama sonuçsuz kalırsa kanıtsız paketi ayrıca inceleyerek devam edebilirim</label>
    <button type="button" disabled={busy || !selection || !(query.trim() || question.trim())} onClick={() => void work(async () => { invalidate(); const value = await command<KnowledgePacket>({ operation: "prepare", id: crypto.randomUUID(), conversationId, selectionRevision: selection!.revision, query: query.trim() || question, allowWithoutEvidence: allowEmpty }); setPacket(value); })}>Kanıt paketini hazırla</button>
    {packet && <section><p>Arama: {packet.query} · Konu: {packet.topic || "Belirtilmedi"}</p><p>{packet.excerpts.length} alıntı · {packet.excerpts.reduce((sum, item) => sum + item.text.length, 0)} karakter · {packet.createdAt}. İçerik ve güncellik incelenmedi. Hazırlama sonrası sürüm değişirse yeniden hazırlayın.</p>
      {packet.coverage.map((item) => <p key={item.collectionId}>{collections.find((collection) => collection.collectionId === item.collectionId)?.title ?? item.collectionId}: {item.inspected} dosya, {item.matches} eşleşme, {item.selected} alıntı, {item.omitted} dışarıda, {item.unavailable} kullanılamıyor.</p>)}
      {packet.excerpts.map((item) => <article key={item.excerptId}><strong>{item.source.title} · sayfa {item.page ?? "metin"}</strong><p>Sürüm {item.source.versionId} · konum {item.start}–{item.end}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.text}</pre></article>)}
      {packet.omissions.map((item) => <p key={item.sourceId}>Dışarıda: {item.title} · {item.reason === "duplicate" ? "Aynı içerik; bağımsız doğrulama sayılmaz" : "Alıntı bütçesi"} · sürüm {item.versionId}</p>)}
      {packet.withoutEvidence && <p>Bu paket kaynak kanıtı içermiyor.</p>}
      <label><input type="checkbox" disabled={busy} checked={reviewed} onChange={(event) => { setReviewed(event.target.checked); onChange(event.target.checked ? { id: packet.id, fingerprint: packet.fingerprint, reviewed: true } : null, !event.target.checked); }} />Alıntıları, eksikleri ve bütün ilk tur üyelerine gönderimi inceledim</label>
    </section>}
    <button type="button" disabled={busy} onClick={() => { setPacket(null); setReviewed(false); onChange(null, false); }}>Kaynak paketi olmadan devam et</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}
