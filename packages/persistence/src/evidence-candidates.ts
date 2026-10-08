import { createHash } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { createEvidenceCandidateSchema, evidenceCandidateProvenanceSchema,
  type CreateEvidenceCandidate, type EvidenceCandidateProvenance } from "@deliberation-ai/contracts";
import { KnowledgeAccessError } from "@deliberation-ai/application";
import { getDatabase } from "./database";
import { encryptJson, encryptText } from "./crypto";
import { getOwnerId } from "./owner";
import { claims, evidenceSources, knowledgeSources, runs } from "./schema";
import { EvidenceSourceLimitError, listEvidenceSources, mapEvidenceSource } from "./evidence-sources";
import { mapStoredRun } from "./run-repository";
import { authorizeKnowledgeScopeInSnapshot } from "./knowledge-scope";
import { lockConversationMembership } from "./conversation-membership";

export class EvidenceCandidateConflictError extends Error {
  constructor() { super("Aday isteği veya kaynak bağlantısı değişmiş; kaydı yeniden inceleyin."); }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createEvidenceCandidate(input: CreateEvidenceCandidate) {
  const request = createEvidenceCandidateSchema.parse(input);
  const requestHash = hash(JSON.stringify(request));
  return getDatabase().transaction(async (tx) => {
    // Serializes quota, source intake, grant revocation and reviewed run deletion.
    await lockConversationMembership(tx);
    const [runRow] = await tx.select().from(runs)
      .where(and(eq(runs.id, request.runId), eq(runs.ownerId, getOwnerId()))).limit(1).for("update");
    if (!runRow) return undefined;
    const [claimRow] = await tx.select().from(claims)
      .where(and(eq(claims.runId, request.runId), eq(claims.reportClaimId, request.claimId))).limit(1).for("update");
    if (!claimRow) return undefined;
    const [existing] = await tx.select().from(evidenceSources).where(eq(evidenceSources.id, request.requestId)).limit(1);
    if (existing) {
      if (existing.ownerId !== getOwnerId() || existing.runId !== request.runId || existing.claimId !== claimRow.id) throw new EvidenceCandidateConflictError();
      const mapped = mapEvidenceSource(existing);
      if (mapped.candidateProvenance?.requestHash !== requestHash) throw new EvidenceCandidateConflictError();
      return mapped; // An acknowledgement replay creates no new capture or access.
    }
    const [total] = await tx.select({ value: count() }).from(evidenceSources).where(eq(evidenceSources.claimId, claimRow.id));
    if ((total?.value ?? 0) >= 10) throw new EvidenceSourceLimitError();
    if (request.relatedSourceId) {
      const [related] = await tx.select({ id: evidenceSources.id }).from(evidenceSources)
        .where(and(eq(evidenceSources.id, request.relatedSourceId), eq(evidenceSources.ownerId, getOwnerId()), eq(evidenceSources.claimId, claimRow.id))).limit(1);
      if (!related) throw new EvidenceCandidateConflictError();
    }
    const run = mapStoredRun(runRow);
    const claim = [...(run.report?.sharedClaims ?? []), ...(run.report?.distinctClaims ?? []), ...(run.report?.redTeamChallenges ?? [])]
      .find((item) => item.claimId === request.claimId);
    if (!claim) return undefined;
    const provenance: EvidenceCandidateProvenance = { version: "evidence-candidate-v1", requestHash,
      origin: request.origin, relatedSourceId: request.relatedSourceId ?? null, statement: claim.statement, model: null, localExcerpt: null };
    let title: string; let url: string; let excerpt: string | null; let note = ""; let publishedAt: string | undefined;
    if (request.origin === "owner") {
      ({ title, url, excerpt, note, publishedAt } = request);
    } else if (request.origin === "model-citation") {
      const member = run.report?.memberResults.find((item) => item.memberId === request.memberId);
      const occurrence = claim.occurrences.find((item) => item.memberId === request.memberId);
      const citation = member?.citations[request.citationIndex];
      if (!member || !occurrence || !citation || !/^https?:\/\//i.test(citation.url)) throw new EvidenceCandidateConflictError();
      title = (citation.title ?? member.label).slice(0, 160); url = citation.url; excerpt = null;
      provenance.model = { memberId: member.memberId, label: member.label, citationIndex: request.citationIndex,
        passage: occurrence.quote, rawSha256: hash(member.rawText) };
      note = "Model atfı; kaynak metni getirilmedi. Model pasajı özgün kaynak alıntısı değildir.";
    } else {
      const quote = run.knowledgePacket?.excerpts.find((item) => item.excerptId === request.excerptId);
      if (!quote) throw new EvidenceCandidateConflictError();
      if (!await authorizeKnowledgeScopeInSnapshot(tx, quote.source.scope)) throw new KnowledgeAccessError();
      provenance.localExcerpt = quote;
      title = quote.source.title.slice(0, 160); url = `urn:knowledge-excerpt:${quote.excerptId}`; excerpt = quote.text;
      note = "Çalışmanın donmuş paketinden birebir alıntı; güncellik ayrıca incelenmelidir.";
    }
    const id = request.requestId;
    const [saved] = await tx.insert(evidenceSources).values({ id, ownerId: getOwnerId(), runId: request.runId,
      claimId: claimRow.id, reportClaimId: request.claimId, relation: request.relation,
      titleCiphertext: encryptText(title, `evidence-source:${id}:title`), urlCiphertext: encryptText(url, `evidence-source:${id}:url`),
      excerptCiphertext: excerpt === null ? null : encryptText(excerpt, `evidence-source:${id}:excerpt`),
      noteCiphertext: encryptText(note, `evidence-source:${id}:note`), publishedAt,
      candidateProvenanceCiphertext: encryptJson(evidenceCandidateProvenanceSchema.parse(provenance), `evidence-source:${id}:candidate-provenance`),
    }).returning();
    return mapEvidenceSource(saved!);
  });
}

export async function listEvidenceCandidates(runId: string) {
  const sources = await listEvidenceSources(runId);
  if (!sources) return undefined;
  const candidates = sources.filter((source) => source.candidateProvenance !== null);
  return getDatabase().transaction(async (tx) => {
    const result = [];
    for (const candidate of candidates) {
      const quote = candidate.candidateProvenance!.localExcerpt;
      let availability: "not-checked" | "same-version" | "changed" | "inaccessible" = "not-checked";
      if (quote) {
        if (!await authorizeKnowledgeScopeInSnapshot(tx, quote.source.scope)) availability = "inaccessible";
        else {
          const [source] = await tx.select({ version: knowledgeSources.activeVersionId }).from(knowledgeSources)
            .where(and(eq(knowledgeSources.id, quote.source.sourceId), eq(knowledgeSources.ownerId, getOwnerId()))).limit(1);
          availability = !source ? "inaccessible" : source.version === quote.source.versionId ? "same-version" : "changed";
        }
      }
      result.push({ ...candidate, availability });
    }
    return result;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
