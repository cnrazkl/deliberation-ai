import { randomUUID } from "node:crypto";
import { buildRoundZeroPromptPlan, buildRiskPreflight, hashRunRequest, IdempotencyConflictError, resolveRunMembers, type RunRecord } from "@deliberation-ai/application";
import { createRunRequestSchema, type CreateRunRequest, type PromptRevisionRequest } from "@deliberation-ai/contracts";
import { auditPromptRevision, composeClarifiedQuestion, findCriticalMissingContext, PROMPT_REVISION_VERSION, PREFLIGHT_CONTEXT_POLICY_VERSION, preflightQuestionsSchema, type PreflightChoice } from "@deliberation-ai/domain";
import { and, desc, eq } from "drizzle-orm";
import { decryptJson, decryptText, encryptJson, encryptText } from "./crypto";
import { getDatabase } from "./database";
import { loadFrozenMemoryEntries } from "./memory-entries";
import { loadFrozenToolContexts, loadRelevantToolContexts } from "./mcp-connections";
import { LOCAL_OWNER_ID } from "./owner";
import { validateRunAttachments } from "./run-attachments";
import { enqueueDurableRun, findDurableRunById, loadRunContinuation, PreflightMismatchError } from "./run-repository";
import { preflightDrafts } from "./schema";
import { readPreflightDraftDeletion } from "./preflight-draft-deletion";
import { lockConversationMembership } from "./conversation-membership";

export class PreflightDraftError extends Error {
  constructor(message = "Bekleyen ön değerlendirme bulunamadı veya artık kullanılamıyor.") {
    super(message);
    this.name = "PreflightDraftError";
  }
}

type DraftRow = typeof preflightDrafts.$inferSelect;
export type PreflightDraftSummary = {
  id: string;
  question: string;
  questions: ReturnType<typeof findCriticalMissingContext>;
  policyVersion: typeof PREFLIGHT_CONTEXT_POLICY_VERSION;
  status: "awaiting_input" | "started" | "cancelled";
  runId: string | null;
  createdAt: string;
};

function summary(row: DraftRow): PreflightDraftSummary {
  const frozen = preflightQuestionsSchema.parse(row.questions);
  return {
    id: row.id,
    question: row.questionCiphertext ? decryptText(row.questionCiphertext, `preflight-draft:${row.id}:question`) : "",
    questions: frozen.questions,
    policyVersion: frozen.policyVersion,
    status: row.status === "started" ? "started" : row.status === "cancelled" ? "cancelled" : "awaiting_input",
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function awaitingRow(id: string): Promise<{ row: DraftRow; request: CreateRunRequest }> {
  const [row] = await getDatabase().select().from(preflightDrafts)
    .where(and(eq(preflightDrafts.id, id), eq(preflightDrafts.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!row || readPreflightDraftDeletion(row) || row.status !== "awaiting_input" || !row.requestCiphertext) throw new PreflightDraftError();
  const frozen = preflightQuestionsSchema.parse(row.questions);
  const request = createRunRequestSchema.parse(decryptJson<unknown>(row.requestCiphertext, `preflight-draft:${id}:request`));
  if (frozen.policyVersion !== PREFLIGHT_CONTEXT_POLICY_VERSION ||
      JSON.stringify(frozen.questions) !== JSON.stringify(findCriticalMissingContext(request.promptRevision?.originalQuestion ?? request.question)) ||
      row.requestHash !== hashRunRequest(request)) throw new PreflightMismatchError();
  return { row, request };
}

export async function createAwaitingPreflightDraft(request: CreateRunRequest): Promise<PreflightDraftSummary> {
  const questions = findCriticalMissingContext(request.promptRevision?.originalQuestion ?? request.question);
  if (questions.length === 0 || request.preflightDecision) throw new PreflightDraftError("Bu istek için bekleyen bir açıklama sorusu yok.");
  return getDatabase().transaction(async (db) => {
    await lockConversationMembership(db);
    const id = randomUUID();
    const [created] = await db.insert(preflightDrafts).values({
      id, ownerId: LOCAL_OWNER_ID, idempotencyKey: request.idempotencyKey,
      requestHash: hashRunRequest(request),
      questionCiphertext: encryptText(request.promptRevision?.originalQuestion ?? request.question, `preflight-draft:${id}:question`),
      requestCiphertext: encryptJson(request, `preflight-draft:${id}:request`),
      questions: { policyVersion: PREFLIGHT_CONTEXT_POLICY_VERSION, questions },
    }).onConflictDoNothing().returning();
    if (created) return summary(created);
    const [existing] = await db.select().from(preflightDrafts).where(and(
      eq(preflightDrafts.ownerId, LOCAL_OWNER_ID), eq(preflightDrafts.idempotencyKey, request.idempotencyKey),
    )).limit(1);
    if (!existing || existing.status !== "awaiting_input" || existing.requestHash !== hashRunRequest(request)) throw new IdempotencyConflictError();
    return summary(existing);
  });
}

export async function listAwaitingPreflightDrafts(): Promise<PreflightDraftSummary[]> {
  const rows = await getDatabase().select().from(preflightDrafts).where(and(
    eq(preflightDrafts.ownerId, LOCAL_OWNER_ID), eq(preflightDrafts.status, "awaiting_input"),
  )).orderBy(desc(preflightDrafts.createdAt));
  return rows.map(summary);
}

export async function findPreflightDraft(id: string): Promise<PreflightDraftSummary | undefined> {
  const [row] = await getDatabase().select().from(preflightDrafts).where(and(
    eq(preflightDrafts.id, id), eq(preflightDrafts.ownerId, LOCAL_OWNER_ID),
  )).limit(1);
  return row && !readPreflightDraftDeletion(row) ? summary(row) : undefined;
}

export async function cancelPreflightDraft(id: string): Promise<boolean> {
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const rows = await tx.update(preflightDrafts).set({
      status: "cancelled", questionCiphertext: null, requestCiphertext: null, updatedAt: new Date(),
    }).where(and(eq(preflightDrafts.id, id), eq(preflightDrafts.ownerId, LOCAL_OWNER_ID),
      eq(preflightDrafts.status, "awaiting_input"))).returning({ id: preflightDrafts.id });
    return rows.length > 0;
  });
}

function applyDraftRevision(baseQuestion: string, supplied?: PromptRevisionRequest) {
  const revision = supplied ?? { version: PROMPT_REVISION_VERSION, originalQuestion: baseQuestion,
    candidateQuestion: baseQuestion, choice: "original" as const };
  const audit = auditPromptRevision(revision);
  if (revision.originalQuestion !== baseQuestion || audit.selectedQuestion.length > 4_000 ||
      (revision.choice === "candidate" && !audit.canSelectCandidate)) throw new PreflightMismatchError();
  return { revision, audit };
}

export async function preparePreflightDraft(id: string, choice: PreflightChoice, answer?: string, suppliedRevision?: PromptRevisionRequest) {
  const { row, request } = await awaitingRow(id);
  const baseQuestion = composeClarifiedQuestion(request.promptRevision?.originalQuestion ?? request.question, choice, answer);
  const { revision, audit } = applyDraftRevision(baseQuestion, suppliedRevision);
  const question = audit.selectedQuestion;
  const members = resolveRunMembers(request);
  const memoryContext = await loadFrozenMemoryEntries(request.memoryEntryIds);
  const continuationContext = request.continuationSource ? await loadRunContinuation(request.continuationSource.runId, request.continuationSource.expectedSha256, request.continuationSource.compaction) : null;
  const selected = await loadFrozenToolContexts(request.toolResultIds ?? []);
  const retrieved = request.retrieveToolContext ? await loadRelevantToolContexts(question, 3) : [];
  const toolContext = [...new Map([...selected, ...retrieved].map((item) => [item.id, item])).values()].slice(0, 3);
  const attachments = request.attachments ?? [];
  await validateRunAttachments(attachments);
  const receivesAttachments = members.some((member) => member.receiveAttachments);
  const documents = receivesAttachments ? attachments.filter((item) => item.mimeType === "application/pdf")
    .map((item) => ({ name: item.name, sha256: item.sha256, content: item.extractedText })) : [];
  const actualImages = receivesAttachments ? attachments.filter((item) => item.mimeType !== "application/pdf") : [];
  const images = actualImages.map(({ mimeType, sha256 }) => ({ mimeType, sha256 }));
  const imageDimensionsEstimated = images.some((image) => !request.previewImages?.some((item) => item.sha256 === image.sha256 && item.mimeType === image.mimeType));
  const previewImages = images.map((image) => request.previewImages?.find((item) => item.sha256 === image.sha256 && item.mimeType === image.mimeType)
    ?? { ...image, width: 1024, height: 1024 });
  const promptPlan = buildRoundZeroPromptPlan({ question, members, memoryContext, toolContext, documents, images, continuationContext });
  const riskPreflight = buildRiskPreflight({ question, requestedProfile: request.riskProfile,
    continuationContext,
    documents: documents.map(({ content }) => ({ content })), imageCount: images.length,
    memoryContext, toolContext, promptFingerprint: promptPlan.fingerprint, reviewRounds: request.reviewRounds });
  return { draft: summary(row), baseQuestion, question, promptRevision: revision, revisionAudit: audit,
    members, memoryContext, toolContext, documents, previewImages, imageDimensionsEstimated, continuationContext,
    promptPlan, riskPreflight, riskProfile: request.riskProfile ?? "standard", reviewRounds: request.reviewRounds };
}

export async function startPreflightDraft(input: { id: string; choice: PreflightChoice; answer?: string | undefined; promptRevision?: PromptRevisionRequest | undefined; expectedPromptFingerprint: string; expectedRiskFingerprint: string }): Promise<RunRecord> {
  const existing = await findPreflightDraft(input.id);
  if (existing?.status === "started" && existing.runId) {
    const run = await findDurableRunById(existing.runId);
    if (run) {
      if (run.preflightDecision?.choice !== input.choice ||
          (run.preflightDecision?.answer ?? "") !== (input.answer ?? "") ||
          run.promptFingerprint !== input.expectedPromptFingerprint ||
          (!input.promptRevision && run.promptRevision?.revision.choice === "candidate") ||
          (input.promptRevision && JSON.stringify(run.promptRevision?.revision) !== JSON.stringify(input.promptRevision))) {
        throw new PreflightMismatchError();
      }
      return run;
    }
  }
  const { request } = await awaitingRow(input.id);
  const baseQuestion = composeClarifiedQuestion(request.promptRevision?.originalQuestion ?? request.question, input.choice, input.answer);
  const { revision, audit } = applyDraftRevision(baseQuestion, input.promptRevision);
  const question = audit.selectedQuestion;
  const revised = createRunRequestSchema.parse({
    ...request, question,
    expectedPreflightFingerprint: input.expectedPromptFingerprint,
    expectedRiskFingerprint: input.expectedRiskFingerprint,
    preflightDecision: { draftId: input.id, choice: input.choice, ...(input.choice === "answer" ? { answer: input.answer } : {}) },
    promptRevision: revision,
  });
  return enqueueDurableRun(revised);
}
