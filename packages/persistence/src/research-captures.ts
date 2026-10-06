import { randomUUID } from "node:crypto";
import type { PromoteResearchCaptureRequest } from "@deliberation-ai/contracts";
import type { RetrievedDocument } from "@deliberation-ai/retrieval";
import { and, asc, count, eq } from "drizzle-orm";
import { decryptText, encryptText } from "./crypto";
import { getDatabase } from "./database";
import { MAX_EVIDENCE_SOURCES_PER_CLAIM } from "./evidence-sources";
import { LOCAL_OWNER_ID } from "./owner";
import { claims, evidenceSources, researchCaptures, runs } from "./schema";
import { lockConversationMembership } from "./conversation-membership";

export const MAX_RESEARCH_CAPTURES_PER_CLAIM = 5;

export type ResearchCapture = {
  id: string;
  runId: string;
  claimId: string;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  content: string;
  contentType: string;
  byteLength: number;
  contentSha256: string;
  redirectCount: number;
  reviewStatus: "unreviewed" | "accepted" | "rejected";
  evidenceSourceId: string | null;
  capturedAt: string;
  reviewedAt: string | null;
};

export class ResearchCaptureLimitError extends Error {
  constructor() {
    super(`Bir iddia için en fazla ${MAX_RESEARCH_CAPTURES_PER_CLAIM} araştırma yakalaması saklanabilir.`);
    this.name = "ResearchCaptureLimitError";
  }
}

export class ResearchCaptureStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchCaptureStateError";
  }
}

function mapCapture(row: typeof researchCaptures.$inferSelect): ResearchCapture {
  return {
    id: row.id,
    runId: row.runId,
    claimId: row.reportClaimId,
    requestedUrl: decryptText(row.requestedUrlCiphertext, `research-capture:${row.id}:requested-url`),
    finalUrl: decryptText(row.finalUrlCiphertext, `research-capture:${row.id}:final-url`),
    title: decryptText(row.titleCiphertext, `research-capture:${row.id}:title`),
    content: decryptText(row.contentCiphertext, `research-capture:${row.id}:content`),
    contentType: row.contentType,
    byteLength: row.byteLength,
    contentSha256: row.contentSha256,
    redirectCount: row.redirectCount,
    reviewStatus: row.reviewStatus as ResearchCapture["reviewStatus"],
    evidenceSourceId: row.evidenceSourceId,
    capturedAt: row.capturedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

async function findOwnedClaim(runId: string, reportClaimId: string) {
  const [claim] = await getDatabase()
    .select({ id: claims.id })
    .from(claims)
    .innerJoin(runs, eq(claims.runId, runs.id))
    .where(and(
      eq(runs.ownerId, LOCAL_OWNER_ID),
      eq(claims.runId, runId),
      eq(claims.reportClaimId, reportClaimId),
    ))
    .limit(1);
  return claim;
}

export async function authorizeResearchCapture(runId: string, reportClaimId: string): Promise<boolean> {
  const claim = await findOwnedClaim(runId, reportClaimId);
  if (!claim) return false;
  const [total] = await getDatabase()
    .select({ value: count() })
    .from(researchCaptures)
    .where(eq(researchCaptures.claimId, claim.id));
  if ((total?.value ?? 0) >= MAX_RESEARCH_CAPTURES_PER_CLAIM) throw new ResearchCaptureLimitError();
  return true;
}

export async function saveResearchCapture(
  runId: string,
  reportClaimId: string,
  document: RetrievedDocument,
): Promise<ResearchCapture | undefined> {
  return getDatabase().transaction(async (tx) => {
    const [claim] = await tx
      .select({ id: claims.id })
      .from(claims)
      .innerJoin(runs, eq(claims.runId, runs.id))
      .where(and(
        eq(runs.ownerId, LOCAL_OWNER_ID),
        eq(claims.runId, runId),
        eq(claims.reportClaimId, reportClaimId),
      ))
      .limit(1);
    if (!claim) return undefined;
    const [total] = await tx
      .select({ value: count() })
      .from(researchCaptures)
      .where(eq(researchCaptures.claimId, claim.id));
    if ((total?.value ?? 0) >= MAX_RESEARCH_CAPTURES_PER_CLAIM) throw new ResearchCaptureLimitError();
    const id = randomUUID();
    const [saved] = await tx.insert(researchCaptures).values({
      id,
      ownerId: LOCAL_OWNER_ID,
      runId,
      claimId: claim.id,
      reportClaimId,
      requestedUrlCiphertext: encryptText(document.requestedUrl, `research-capture:${id}:requested-url`),
      finalUrlCiphertext: encryptText(document.finalUrl, `research-capture:${id}:final-url`),
      titleCiphertext: encryptText(document.title, `research-capture:${id}:title`),
      contentCiphertext: encryptText(document.content, `research-capture:${id}:content`),
      contentType: document.contentType,
      byteLength: document.byteLength,
      contentSha256: document.contentSha256,
      redirectCount: document.redirectCount,
      reviewStatus: "unreviewed",
    }).returning();
    return saved ? mapCapture(saved) : undefined;
  });
}

export async function listResearchCaptures(runId: string): Promise<ResearchCapture[] | undefined> {
  const [ownedRun] = await getDatabase().select({ id: runs.id }).from(runs)
    .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!ownedRun) return undefined;
  const rows = await getDatabase().select().from(researchCaptures)
    .where(and(eq(researchCaptures.ownerId, LOCAL_OWNER_ID), eq(researchCaptures.runId, runId)))
    .orderBy(asc(researchCaptures.capturedAt));
  return rows.map(mapCapture);
}

export async function rejectResearchCapture(id: string): Promise<ResearchCapture | undefined> {
  const [capture] = await getDatabase().select().from(researchCaptures)
    .where(and(eq(researchCaptures.id, id), eq(researchCaptures.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!capture) return undefined;
  if (capture.evidenceSourceId) {
    throw new ResearchCaptureStateError("Kanıt kaydına dönüştürülmüş yakalama reddedilemez.");
  }
  const [updated] = await getDatabase().update(researchCaptures).set({
    reviewStatus: "rejected",
    reviewedAt: new Date(),
  }).where(and(eq(researchCaptures.id, id), eq(researchCaptures.ownerId, LOCAL_OWNER_ID))).returning();
  return updated ? mapCapture(updated) : undefined;
}

export async function promoteResearchCapture(
  id: string,
  request: PromoteResearchCaptureRequest,
): Promise<{ capture: ResearchCapture; evidenceSourceId: string } | undefined> {
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const [capture] = await tx.select().from(researchCaptures)
      .where(and(eq(researchCaptures.id, id), eq(researchCaptures.ownerId, LOCAL_OWNER_ID)))
      .for("update").limit(1);
    if (!capture) return undefined;
    if (capture.reviewStatus === "rejected") {
      throw new ResearchCaptureStateError("Reddedilmiş yakalama kanıt kaydına dönüştürülemez.");
    }
    if (capture.evidenceSourceId) {
      throw new ResearchCaptureStateError("Bu yakalama zaten kanıt kaydına dönüştürülmüş.");
    }
    const content = decryptText(capture.contentCiphertext, `research-capture:${id}:content`);
    if (!content.includes(request.excerpt)) {
      throw new ResearchCaptureStateError("Kanıt alıntısı, yakalanan metinde birebir bulunmalıdır.");
    }
    const [total] = await tx.select({ value: count() }).from(evidenceSources)
      .where(eq(evidenceSources.claimId, capture.claimId));
    if ((total?.value ?? 0) >= MAX_EVIDENCE_SOURCES_PER_CLAIM) {
      throw new ResearchCaptureStateError(`Bu iddia için ${MAX_EVIDENCE_SOURCES_PER_CLAIM} kanıt kaydı sınırına ulaşıldı.`);
    }
    const evidenceSourceId = randomUUID();
    const capturedAt = new Date();
    await tx.insert(evidenceSources).values({
      id: evidenceSourceId,
      ownerId: LOCAL_OWNER_ID,
      runId: capture.runId,
      claimId: capture.claimId,
      reportClaimId: capture.reportClaimId,
      relation: request.relation,
      reviewStatus: "unreviewed",
      freshnessStatus: "unreviewed",
      titleCiphertext: encryptText(
        decryptText(capture.titleCiphertext, `research-capture:${id}:title`),
        `evidence-source:${evidenceSourceId}:title`,
      ),
      urlCiphertext: encryptText(
        decryptText(capture.finalUrlCiphertext, `research-capture:${id}:final-url`),
        `evidence-source:${evidenceSourceId}:url`,
      ),
      excerptCiphertext: encryptText(request.excerpt, `evidence-source:${evidenceSourceId}:excerpt`),
      noteCiphertext: encryptText(request.note, `evidence-source:${evidenceSourceId}:note`),
      publishedAt: request.publishedAt,
      capturedAt,
    });
    const [updated] = await tx.update(researchCaptures).set({
      reviewStatus: "accepted",
      evidenceSourceId,
      reviewedAt: new Date(),
    }).where(eq(researchCaptures.id, id)).returning();
    return updated ? { capture: mapCapture(updated), evidenceSourceId } : undefined;
  });
}
