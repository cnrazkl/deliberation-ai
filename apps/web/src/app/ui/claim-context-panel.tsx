"use client";

import { useState, type FormEvent } from "react";
import type { RunRecord } from "@deliberation-ai/application";
import type { ClaimRelationKind } from "@deliberation-ai/contracts";

const relationLabels: Record<ClaimRelationKind, string> = {
  supports: "Destekliyor",
  contradicts: "Çelişiyor",
  qualifies: "Koşula bağlıyor",
  "different-scope": "Kapsamları farklı",
};

export function ClaimContextPanel({ run, onRunUpdated }: {
  run: RunRecord;
  onRunUpdated: (run: RunRecord) => void;
}) {
  const report = run.report;
  const claims = report
    ? [...report.sharedClaims, ...report.distinctClaims, ...report.redTeamChallenges]
    : [];
  const [selectedClaimId, setSelectedClaimId] = useState("");
  const [scopeDraft, setScopeDraft] = useState<{ claimId: string; value: string }>();
  const [fromClaimId, setFromClaimId] = useState("");
  const [toClaimId, setToClaimId] = useState("");
  const [relationKind, setRelationKind] = useState<ClaimRelationKind>("qualifies");
  const [relationNote, setRelationNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!report) return null;

  const selected = claims.find((claim) => claim.claimId === selectedClaimId) ?? claims[0];
  const currentScope = scopeDraft?.claimId === selected?.claimId
    ? scopeDraft?.value ?? ""
    : selected?.scopeNote ?? "";
  const from = claims.find((claim) => claim.claimId === fromClaimId) ?? claims[0];
  const to = claims.find((claim) => claim.claimId === toClaimId && claim.claimId !== from?.claimId)
    ?? claims.find((claim) => claim.claimId !== from?.claimId);
  const coverage = report.claimCoverage;

  async function requestUpdate(path: string, method: "PATCH" | "POST" | "DELETE", body: unknown): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as RunRecord & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "İddia kaydı güncellenemedi.");
      onRunUpdated(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "İddia kaydı güncellenemedi.");
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function saveScope(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    try {
      await requestUpdate(
        `/api/runs/${run.runId}/claims/${selected.claimId}/scope`,
        "PATCH",
        { scopeNote: currentScope },
      );
      setScopeDraft(undefined);
    } catch { /* The error is displayed in this panel. */ }
  }

  async function saveRelation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!from || !to || !relationNote.trim()) return;
    try {
      await requestUpdate(`/api/runs/${run.runId}/claim-relations`, "POST", {
        fromClaimId: from.claimId,
        toClaimId: to.claimId,
        kind: relationKind,
        note: relationNote,
      });
      setRelationNote("");
    } catch { /* The error is displayed in this panel. */ }
  }

  async function removeRelation(fromId: string, toId: string): Promise<void> {
    try {
      await requestUpdate(`/api/runs/${run.runId}/claim-relations`, "DELETE", {
        fromClaimId: fromId,
        toClaimId: toId,
      });
    } catch { /* The error is displayed in this panel. */ }
  }

  const labelFor = (claimId: string): string => {
    const claim = claims.find((item) => item.claimId === claimId);
    return claim ? `${claim.claimId} · ${claim.statement}` : claimId;
  };

  return (
    <section className="claim-context-section" aria-label="İddia kapsamı ve ilişkileri">
      <div className="claim-context-heading">
        <div><span>İDDİA İZİ VE İLİŞKİLERİ</span><strong>{claims.length} iddia grubu</strong></div>
        <small>Bu kayıtlar sizin yorumunuzdur; kanıt durumunu veya model çıktısını değiştirmez.</small>
      </div>
      {coverage ? (
        <div className={coverage.complete ? "claim-coverage complete" : "claim-coverage incomplete"}>
          <strong>Model iddiaları: {coverage.representedOccurrenceCount}/{coverage.sourceClaimCount} raporda izleniyor</strong>
          {coverage.complete ? (
            <small>Her yapılandırılmış model iddiası, üyesi ve alıntısıyla raporda bir kez temsil ediliyor.</small>
          ) : (
            <small>Eksik {coverage.missingOccurrenceIds.length}, yinelenen {coverage.duplicateOccurrenceIds.length}, beklenmeyen {coverage.unexpectedOccurrenceIds.length}, değişmiş {coverage.alteredOccurrenceIds.length} kayıt var. Ham model yanıtlarını inceleyin.</small>
          )}
          <small>Bu kontrol, modelin sorudaki bütün önemli iddiaları bulduğunu kanıtlamaz.</small>
        </div>
      ) : null}
      {claims.length > 0 ? (
        <form className="claim-context-form" onSubmit={(event) => void saveScope(event)}>
          <label>İddia
            <select value={selected?.claimId ?? ""} onChange={(event) => { setSelectedClaimId(event.target.value); setScopeDraft(undefined); }}>
              {claims.map((claim) => <option key={claim.claimId} value={claim.claimId}>{labelFor(claim.claimId)}</option>)}
            </select>
          </label>
          <label>Bu iddianın geçerli olduğu koşullar veya sınırlar
            <textarea value={currentScope} maxLength={500} rows={3} onChange={(event) => selected && setScopeDraft({ claimId: selected.claimId, value: event.target.value })} placeholder="Örn. Yalnızca sözleşmede bu koşul varsa; aksi halde belirsiz." />
          </label>
          <button type="submit" disabled={busy || !selected || currentScope === (selected.scopeNote ?? "")}>Kapsamı kaydet</button>
        </form>
      ) : null}
      {claims.length >= 2 ? (
        <form className="claim-relation-form" onSubmit={(event) => void saveRelation(event)}>
          <strong>İki iddia arasındaki ilişkiyi kaydet</strong>
          <div className="claim-relation-grid">
            <label>Birinci iddia<select value={from?.claimId ?? ""} onChange={(event) => setFromClaimId(event.target.value)}>{claims.map((claim) => <option key={claim.claimId} value={claim.claimId}>{labelFor(claim.claimId)}</option>)}</select></label>
            <label>İlişki<select value={relationKind} onChange={(event) => setRelationKind(event.target.value as ClaimRelationKind)}>{Object.entries(relationLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
            <label>İkinci iddia<select value={to?.claimId ?? ""} onChange={(event) => setToClaimId(event.target.value)}>{claims.filter((claim) => claim.claimId !== from?.claimId).map((claim) => <option key={claim.claimId} value={claim.claimId}>{labelFor(claim.claimId)}</option>)}</select></label>
          </div>
          <label>Gerekçeniz<textarea value={relationNote} maxLength={500} rows={2} onChange={(event) => setRelationNote(event.target.value)} placeholder="Bu ilişkiyi hangi koşulda gördüğünüzü yazın." required /></label>
          <button type="submit" disabled={busy || !from || !to || !relationNote.trim()}>İlişkiyi kaydet</button>
        </form>
      ) : null}
      {(report.claimRelations ?? []).length > 0 ? (
        <div className="claim-relation-list">
          {(report.claimRelations ?? []).map((relation) => (
            <article key={`${relation.fromClaimId}:${relation.toClaimId}`}>
              <div><strong>{labelFor(relation.fromClaimId)} → {relationLabels[relation.kind]} → {labelFor(relation.toClaimId)}</strong><p>{relation.note}</p><small>Sizin işaretiniz · {new Date(relation.updatedAt).toLocaleString("tr-TR")}</small></div>
              <button type="button" className="secondary-button danger-button" disabled={busy} onClick={() => void removeRelation(relation.fromClaimId, relation.toClaimId)}>İlişkiyi kaldır</button>
            </article>
          ))}
        </div>
      ) : null}
      {error ? <p className="inline-warning" role="alert">{error}</p> : null}
    </section>
  );
}
