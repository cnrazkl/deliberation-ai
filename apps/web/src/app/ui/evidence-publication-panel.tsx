"use client";
import { ownerFetch, sessionOwner } from "../../lib/session-fetch";
import { createBrowserRequestId } from "../../lib/browser-request-id";
import { useEffect, useState } from "react";
import type { EvidencePublicationBody, EvidencePublicationPreviewRequest, KnowledgeScope } from "@deliberation-ai/contracts";

type Collection = { collectionId: string; title: string; grantId: string; grantRevision: number; grantStatus: string };
type Receipt = EvidencePublicationBody & { status: string };
type Preview = { candidate: EvidencePublicationBody["candidate"]; destinationTitle: string; fingerprint: string; sharing: string };
export function EvidencePublicationPanel({ runId, candidateId, eligible }: { runId: string; candidateId: string; eligible: boolean }) {
  const [collections, setCollections] = useState<Collection[]>([]), [receipts, setReceipts] = useState<Receipt[]>([]);
  const [collectionId, setCollectionId] = useState(""), [kind, setKind] = useState<"local" | "manual">("local");
  const [name, setName] = useState(""), [account, setAccount] = useState(""), [url, setUrl] = useState("");
  const [review, setReview] = useState<{ preview: Preview; request: EvidencePublicationPreviewRequest; requestId: string }>();
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([ownerFetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "state", conversationId: null }), cache: "no-store", signal: controller.signal }),
      ownerFetch(`/api/evidence-publications?runId=${runId}`, { cache: "no-store", signal: controller.signal })]).then(async ([a, b]) => {
      if (!a.ok || !b.ok) throw new Error();
      const listed = await a.json() as { collections: { items: Collection[] } }, saved = await b.json() as { publications: Receipt[] };
      if (!controller.signal.aborted) { setCollections(listed.collections.items.filter((value) => value?.grantStatus === "active")); setReceipts(saved.publications); }
    }).catch(() => { if (!controller.signal.aborted) setError("Kaydetme hedefleri yüklenemedi."); });
    return () => controller.abort();
  }, [runId]);
  function invalidate() { setReview(undefined); setConsent(false); }
  async function send(body: object) {
    const response = await ownerFetch("/api/evidence-publications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json() as Receipt & Preview & { error?: string };
    if (!response.ok) throw new Error(value.error ?? "Kaydetme başarısız."); return value;
  }
  async function inspect() {
    setBusy(true); setError(undefined);
    try {
      const collection = collections.find((value) => value.collectionId === collectionId);
      if (kind === "local" && !collection) throw new Error("İzin verilmiş bir koleksiyon seçin.");
      const scope: KnowledgeScope | undefined = collection ? { ownerId: sessionOwner(), accountId: "local", collectionId: collection.collectionId, grantId: collection.grantId, grantRevision: collection.grantRevision } : undefined;
      const request: EvidencePublicationPreviewRequest = { candidateId, destination: kind === "local" ? { kind: "local", scope: scope! } : { kind: "manual", name, account, url } };
      setReview({ preview: await send({ action: "preview", ...request }), request, requestId: createBrowserRequestId() }); setConsent(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "İnceleme açılamadı."); } finally { setBusy(false); }
  }
  async function commit() {
    if (!review || !consent || !eligible) return;
    setBusy(true); setError(undefined);
    try { const saved = await send({ action: "commit", ...review.request, requestId: review.requestId, fingerprint: review.preview.fingerprint, consent: true });
      setReceipts((values) => [...values.filter((value) => value.id !== saved.id), saved]); setReview(undefined); setConsent(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Kaydetme başarısız."); } finally { setBusy(false); }
  }
  async function acknowledge(id: string) {
    setBusy(true); setError(undefined);
    try { const saved = await send({ action: "acknowledge", id, consent: true }); setReceipts((values) => values.map((value) => value.id === id ? saved : value)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Onay kaydedilemedi."); } finally { setBusy(false); }
  }
  return <details className="candidate-publication"><summary>Yeniden kullanılabilir kanıt kaydı</summary>
    <fieldset disabled={busy}>
      <p>İncelenmiş ve güncel özgün pasaj gerekir. Kaydetmek iddianın doğruluğunu onaylamaz.</p>
      <label>Kaydetme yöntemi<select aria-label="Kaydetme yöntemi" value={kind} onChange={(event) => { invalidate(); setKind(event.target.value as "local" | "manual"); }}><option value="local">Yerel koleksiyon</option><option value="manual">Manuel aktarım paketi</option></select></label>
      {kind === "local" ? <label>Kanıtın hedef koleksiyonu<select aria-label="Kanıtın hedef koleksiyonu" value={collectionId} onChange={(event) => { invalidate(); setCollectionId(event.target.value); }}><option value="">Hedef seçin</option>{collections.map((value) => <option key={value.collectionId} value={value.collectionId}>{value.title}</option>)}</select></label> : <>
        <label>Manuel hedef adı<input maxLength={160} value={name} onChange={(event) => { invalidate(); setName(event.target.value); }} /></label>
        <label>Manuel hedef hesabı<input maxLength={160} value={account} onChange={(event) => { invalidate(); setAccount(event.target.value); }} /></label>
        <label>Manuel hedef bağlantısı<input type="url" maxLength={2048} value={url} onChange={(event) => { invalidate(); setUrl(event.target.value); }} /></label>
      </>}
      <button type="button" className="secondary-button" disabled={!eligible} onClick={() => void inspect()}>Kanıt kaydını incele</button>
      {review ? <div role="region" aria-label="Kanıt kaydı incelemesi"><strong>Hedef: {review.preview.destinationTitle}</strong><p>{review.preview.sharing}</p>
        <pre>{JSON.stringify(review.request.destination, null, 2)}</pre><p>{review.preview.candidate.title} · {review.preview.candidate.url}</p><blockquote>{review.preview.candidate.excerpt}</blockquote>
        <p>İddia: {review.preview.candidate.provenance.statement} · İlişki: {review.preview.candidate.relation}</p>
        <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Bu içeriği ve tam hedefi onaylıyorum</label>
        <button type="button" disabled={!consent} onClick={() => void commit()}>{kind === "local" ? "Onaylanan kanıtı kaydet" : "Onaylanan aktarım paketini hazırla"}</button>
        <button type="button" className="secondary-button" onClick={() => { setReview(undefined); setConsent(false); }}>İncelemeyi iptal et</button>
      </div> : null}
      {receipts.filter((value) => value.candidate.id === candidateId).map((value) => <div key={value.id}><p>{value.destinationTitle} · {value.status === "local_saved" ? "Yerel kayıt tamamlandı; kayıt sırasında aramaya hazırdı" : value.status === "manual_acknowledged" ? "Elle aktarıldığı beyan edildi; uzaktan doğrulanmadı" : "Elle eklemeniz bekleniyor; dışarı gönderilmedi"}</p>
        <a href={`/api/evidence-publications?runId=${runId}&download=${value.id}`} download>Kanıt ve hedef paketini indir (JSON)</a>
        {value.destination.kind === "manual" && value.status === "awaiting_manual_addition" ? <button type="button" className="secondary-button" onClick={() => void acknowledge(value.id)}>Adlandırılan hedefe elle ekledim</button> : null}
      </div>)}
    </fieldset>{error ? <p className="error" role="alert">{error}</p> : null}
  </details>;
}
