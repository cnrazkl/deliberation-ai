import { randomUUID } from "node:crypto";
import type {
  EvidenceCandidateProvenance,
  EvidenceFreshnessStatus,
  EvidenceRelation,
  EvidenceReviewStatus,
  SaveEvidenceSourceRequest,
  UpdateEvidenceSourceRequest,
} from "@deliberation-ai/contracts";
import { evidenceCandidateProvenanceSchema } from "@deliberation-ai/contracts";
import { and, asc, count, eq } from "drizzle-orm";
import { decryptJson, decryptText, encryptText } from "./crypto";
import { getDatabase } from "./database";
import { getOwnerId } from "./owner";
import { claims, evidenceSources, knowledgeSources, runs } from "./schema";
import { authorizeKnowledgeScopeInSnapshot } from "./knowledge-scope";
import { lockConversationMembership, type ConversationTransaction } from "./conversation-membership";

export async function candidateSourceAvailable(tx: ConversationTransaction, row: {
  id: string; candidateProvenanceCiphertext: string | null; excerptCiphertext: string | null;
}) {
  if (!row.candidateProvenanceCiphertext) return true; // Historical evidence contract.
  const provenance = evidenceCandidateProvenanceSchema.parse(decryptJson(row.candidateProvenanceCiphertext, `evidence-source:${row.id}:candidate-provenance`));
  if (!row.excerptCiphertext) return false;
  const quote = provenance.localExcerpt;
  if (!quote) return true; // Remote content/freshness is an explicit human assessment.
  if (!await authorizeKnowledgeScopeInSnapshot(tx, quote.source.scope)) return false;
  const [head] = await tx.select({ version: knowledgeSources.activeVersionId }).from(knowledgeSources)
    .where(and(eq(knowledgeSources.id, quote.source.sourceId), eq(knowledgeSources.ownerId, getOwnerId()))).limit(1);
  return head?.version === quote.source.versionId;
}

export const MAX_EVIDENCE_SOURCES_PER_CLAIM = 10;

export type EvidenceSource = {
  id: string;
  runId: string;
  claimId: string;
  title: string;
  url: string;
  excerpt: string | null;
  candidateProvenance: EvidenceCandidateProvenance | null;
  relation: EvidenceRelation;
  reviewStatus: EvidenceReviewStatus;
  freshnessStatus: EvidenceFreshnessStatus;
  note: string;
  publishedAt: string | null;
  capturedAt: string;
  freshnessReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export class EvidenceSourceLimitError extends Error {
  constructor() {
    super(`Bir iddiaya en fazla ${MAX_EVIDENCE_SOURCES_PER_CLAIM} kaynak eklenebilir.`);
    this.name = "EvidenceSourceLimitError";
  }
}

export class EvidenceSourceInUseError extends Error {
  constructor(message = "Bu kaynak iddianın mevcut kanıt durumunu destekliyor; önce iddianın kanıt durumunu değiştirin.") {
    super(message);
    this.name = "EvidenceSourceInUseError";
  }
}

export function mapEvidenceSource(row: typeof evidenceSources.$inferSelect): EvidenceSource {
  return {
    id: row.id,
    runId: row.runId,
    claimId: row.reportClaimId,
    candidateProvenance: row.candidateProvenanceCiphertext
      ? evidenceCandidateProvenanceSchema.parse(decryptJson(row.candidateProvenanceCiphertext, `evidence-source:${row.id}:candidate-provenance`)) : null,
    title: decryptText(row.titleCiphertext, `evidence-source:${row.id}:title`),
    url: decryptText(row.urlCiphertext, `evidence-source:${row.id}:url`),
    excerpt: row.excerptCiphertext
      ? decryptText(row.excerptCiphertext, `evidence-source:${row.id}:excerpt`)
      : null,
    relation: row.relation as EvidenceRelation,
    reviewStatus: row.reviewStatus as EvidenceReviewStatus,
    freshnessStatus: row.freshnessStatus as EvidenceFreshnessStatus,
    note: decryptText(row.noteCiphertext, `evidence-source:${row.id}:note`),
    publishedAt: row.publishedAt,
    capturedAt: row.capturedAt.toISOString(),
    freshnessReviewedAt: row.freshnessReviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listEvidenceSources(runId: string): Promise<EvidenceSource[] | undefined> {
  const [ownedRun] = await getDatabase()
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.ownerId, getOwnerId())))
    .limit(1);
  if (!ownedRun) return undefined;
  const rows = await getDatabase()
    .select()
    .from(evidenceSources)
    .where(and(eq(evidenceSources.ownerId, getOwnerId()), eq(evidenceSources.runId, runId)))
    .orderBy(asc(evidenceSources.createdAt));
  return rows.map(mapEvidenceSource);
}

export async function saveEvidenceSource(
  request: SaveEvidenceSourceRequest,
): Promise<EvidenceSource | undefined> {
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const [claim] = await tx
      .select({ id: claims.id })
      .from(claims)
      .innerJoin(runs, eq(claims.runId, runs.id))
      .where(
        and(
          eq(runs.ownerId, getOwnerId()),
          eq(claims.runId, request.runId),
          eq(claims.reportClaimId, request.claimId),
        ),
      )
      .limit(1);
    if (!claim) return undefined;
    const [total] = await tx
      .select({ value: count() })
      .from(evidenceSources)
      .where(eq(evidenceSources.claimId, claim.id));
    if ((total?.value ?? 0) >= MAX_EVIDENCE_SOURCES_PER_CLAIM) {
      throw new EvidenceSourceLimitError();
    }
    const id = randomUUID();
    const capturedAt = new Date();
    const [saved] = await tx
      .insert(evidenceSources)
      .values({
        id,
        ownerId: getOwnerId(),
        runId: request.runId,
        claimId: claim.id,
        reportClaimId: request.claimId,
        relation: request.relation,
        reviewStatus: "unreviewed",
        freshnessStatus: "unreviewed",
        titleCiphertext: encryptText(request.title, `evidence-source:${id}:title`),
        urlCiphertext: encryptText(request.url, `evidence-source:${id}:url`),
        excerptCiphertext: encryptText(request.excerpt, `evidence-source:${id}:excerpt`),
        noteCiphertext: encryptText(request.note, `evidence-source:${id}:note`),
        publishedAt: request.publishedAt,
        capturedAt,
      })
      .returning();
    return saved ? mapEvidenceSource(saved) : undefined;
  });
}

export async function updateEvidenceSourceReview(
  id: string,
  update: UpdateEvidenceSourceRequest,
): Promise<EvidenceSource | undefined> {
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const [source] = await tx
      .select({
        id: evidenceSources.id,
        relation: evidenceSources.relation,
        reviewStatus: evidenceSources.reviewStatus,
        freshnessStatus: evidenceSources.freshnessStatus,
        freshnessReviewedAt: evidenceSources.freshnessReviewedAt,
        excerptCiphertext: evidenceSources.excerptCiphertext,
        candidateProvenanceCiphertext: evidenceSources.candidateProvenanceCiphertext,
        evidenceState: claims.evidenceState,
      })
      .from(evidenceSources)
      .innerJoin(claims, eq(evidenceSources.claimId, claims.id))
      .where(and(eq(evidenceSources.ownerId, getOwnerId()), eq(evidenceSources.id, id)))
      .limit(1)
      .for("update");
    if (!source) return undefined;

    const reviewStatus = update.reviewStatus ?? (source.reviewStatus as EvidenceReviewStatus);
    if (source.candidateProvenanceCiphertext && !source.excerptCiphertext &&
        (reviewStatus === "verified" || update.freshnessStatus === "current")) {
      throw new EvidenceSourceInUseError("Model atfında özgün kaynak pasajı yok; içerik veya güncellik doğrulanamaz.");
    }
    if (update.freshnessStatus === "current" && !await candidateSourceAvailable(tx, source)) throw new EvidenceSourceInUseError("Yerel kaynak değişmiş veya erişimi iptal edilmiş; yeni bir aday gönderin.");
    const freshnessStatus =
      update.freshnessStatus ?? (source.freshnessStatus as EvidenceFreshnessStatus);
    if (
      sourceSupportsClaimState(source.relation, source.evidenceState) &&
      (reviewStatus !== "verified" || freshnessStatus !== "current")
    ) {
      throw new EvidenceSourceInUseError();
    }

    const freshnessReviewedAt =
      update.freshnessStatus === undefined
        ? source.freshnessReviewedAt
        : update.freshnessStatus === "unreviewed"
          ? null
          : new Date();
    const [updated] = await tx
      .update(evidenceSources)
      .set({
        reviewStatus,
        freshnessStatus,
        freshnessReviewedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(evidenceSources.ownerId, getOwnerId()), eq(evidenceSources.id, id)))
      .returning();
    return updated ? mapEvidenceSource(updated) : undefined;
  });
}

function sourceSupportsClaimState(relation: string, evidenceState: string): boolean {
  return (
    (relation === "supports" && evidenceState === "externally-verified") ||
    (relation === "contradicts" && evidenceState === "contradicted")
  );
}

export async function deleteEvidenceSource(id: string): Promise<boolean> {
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const [source] = await tx
      .select({
        candidateProvenanceCiphertext: evidenceSources.candidateProvenanceCiphertext,
        claimId: evidenceSources.claimId,
        relation: evidenceSources.relation,
        reviewStatus: evidenceSources.reviewStatus,
        evidenceState: claims.evidenceState,
      })
      .from(evidenceSources)
      .innerJoin(claims, eq(evidenceSources.claimId, claims.id))
      .where(and(eq(evidenceSources.ownerId, getOwnerId()), eq(evidenceSources.id, id)))
      .limit(1);
    if (!source) return false;
    if (source.candidateProvenanceCiphertext) throw new EvidenceSourceInUseError("Adayın özgün kaydı korunur; reddetme kararını kullanın. İçerik, çalışma için incelenmiş silme işlemiyle kaldırılabilir.");
    const linked = await tx.select().from(evidenceSources).where(and(eq(evidenceSources.ownerId, getOwnerId()), eq(evidenceSources.claimId, source.claimId))).limit(MAX_EVIDENCE_SOURCES_PER_CLAIM);
    if (linked.some((row) => mapEvidenceSource(row).candidateProvenance?.relatedSourceId === id)) throw new EvidenceSourceInUseError("Kaynak bir adayın önceki kaydıdır; özgün bağlantı korunur.");
    const requiredByClaim = sourceSupportsClaimState(source.relation, source.evidenceState);
    if (requiredByClaim) throw new EvidenceSourceInUseError();
    const deleted = await tx
      .delete(evidenceSources)
      .where(and(eq(evidenceSources.ownerId, getOwnerId()), eq(evidenceSources.id, id)))
      .returning({ id: evidenceSources.id });
    return deleted.length > 0;
  });
}
