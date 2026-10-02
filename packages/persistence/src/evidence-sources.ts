import { randomUUID } from "node:crypto";
import type {
  EvidenceFreshnessStatus,
  EvidenceRelation,
  EvidenceReviewStatus,
  SaveEvidenceSourceRequest,
  UpdateEvidenceSourceRequest,
} from "@deliberation-ai/contracts";
import { and, asc, count, eq } from "drizzle-orm";
import { decryptText, encryptText } from "./crypto";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { claims, evidenceSources, runs } from "./schema";

export const MAX_EVIDENCE_SOURCES_PER_CLAIM = 10;

export type EvidenceSource = {
  id: string;
  runId: string;
  claimId: string;
  title: string;
  url: string;
  excerpt: string | null;
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
  constructor() {
    super("Bu kaynak iddianın mevcut kanıt durumunu destekliyor; önce iddianın kanıt durumunu değiştirin.");
    this.name = "EvidenceSourceInUseError";
  }
}

function mapEvidenceSource(row: typeof evidenceSources.$inferSelect): EvidenceSource {
  return {
    id: row.id,
    runId: row.runId,
    claimId: row.reportClaimId,
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
    .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID)))
    .limit(1);
  if (!ownedRun) return undefined;
  const rows = await getDatabase()
    .select()
    .from(evidenceSources)
    .where(and(eq(evidenceSources.ownerId, LOCAL_OWNER_ID), eq(evidenceSources.runId, runId)))
    .orderBy(asc(evidenceSources.createdAt));
  return rows.map(mapEvidenceSource);
}

export async function saveEvidenceSource(
  request: SaveEvidenceSourceRequest,
): Promise<EvidenceSource | undefined> {
  return getDatabase().transaction(async (tx) => {
    const [claim] = await tx
      .select({ id: claims.id })
      .from(claims)
      .innerJoin(runs, eq(claims.runId, runs.id))
      .where(
        and(
          eq(runs.ownerId, LOCAL_OWNER_ID),
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
        ownerId: LOCAL_OWNER_ID,
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
    const [source] = await tx
      .select({
        relation: evidenceSources.relation,
        reviewStatus: evidenceSources.reviewStatus,
        freshnessStatus: evidenceSources.freshnessStatus,
        freshnessReviewedAt: evidenceSources.freshnessReviewedAt,
        evidenceState: claims.evidenceState,
      })
      .from(evidenceSources)
      .innerJoin(claims, eq(evidenceSources.claimId, claims.id))
      .where(and(eq(evidenceSources.ownerId, LOCAL_OWNER_ID), eq(evidenceSources.id, id)))
      .limit(1)
      .for("update");
    if (!source) return undefined;

    const reviewStatus = update.reviewStatus ?? (source.reviewStatus as EvidenceReviewStatus);
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
      .where(and(eq(evidenceSources.ownerId, LOCAL_OWNER_ID), eq(evidenceSources.id, id)))
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
    const [source] = await tx
      .select({
        relation: evidenceSources.relation,
        reviewStatus: evidenceSources.reviewStatus,
        evidenceState: claims.evidenceState,
      })
      .from(evidenceSources)
      .innerJoin(claims, eq(evidenceSources.claimId, claims.id))
      .where(and(eq(evidenceSources.ownerId, LOCAL_OWNER_ID), eq(evidenceSources.id, id)))
      .limit(1);
    if (!source) return false;
    const requiredByClaim = sourceSupportsClaimState(source.relation, source.evidenceState);
    if (requiredByClaim) throw new EvidenceSourceInUseError();
    const deleted = await tx
      .delete(evidenceSources)
      .where(and(eq(evidenceSources.ownerId, LOCAL_OWNER_ID), eq(evidenceSources.id, id)))
      .returning({ id: evidenceSources.id });
    return deleted.length > 0;
  });
}
