import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { appendPrivateDraftSchema, councilMembersSchema, createPrivateBranchSchema, privateBranchBodySchema,
  privateBranchSeedSchema, providerOutputSchema, type AppendPrivateDraft, type CreatePrivateBranch,
  type PrivateBranchBody } from "@deliberation-ai/contracts";
import type { CouncilReport } from "@deliberation-ai/domain";
import { getDatabase } from "./database";
import { decryptJson, decryptText, encryptJson } from "./crypto";
import { getOwnerId } from "./owner";
import { conversationPrivateBranches as branches, conversations, conversationRuns, runs, privateBranchDeletions } from "./schema";
import { ConversationIntegrityError, ConversationPendingError, ConversationSizeError,
  lockConversationMembership, type ConversationTransaction } from "./conversation-membership";

export const MAX_PRIVATE_BRANCHES = 100;
export const MAX_PRIVATE_BRANCH_BYTES = 512 * 1024;
export class PrivateBranchConflictError extends Error {}
export class PrivateBranchSourceError extends Error {}
type BranchRow = typeof branches.$inferSelect;
export type PrivateBranchSummary = Pick<BranchRow, "id" | "conversationId" | "sourceRunId" | "sourceMemberId" | "parentBranchId" | "revision" | "messageCount"> & { createdAt: string; updatedAt: string };
export type PrivateBranchView = PrivateBranchSummary & { body: PrivateBranchBody };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const owned = (id: string) => and(eq(branches.id, id), eq(branches.ownerId, getOwnerId()));
function summary(row: Omit<BranchRow, "bodyCiphertext" | "requestHash" | "requestId" | "ownerId">): PrivateBranchSummary {
  return { id: row.id, conversationId: row.conversationId, sourceRunId: row.sourceRunId, sourceMemberId: row.sourceMemberId,
    parentBranchId: row.parentBranchId, revision: row.revision, messageCount: row.messageCount,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export function boundedPrivateBody(body: PrivateBranchBody) {
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_PRIVATE_BRANCH_BYTES) throw new ConversationSizeError();
  return privateBranchBodySchema.parse(body);
}
export function decodePrivateBranchBody(row: Pick<BranchRow, "id" | "conversationId" | "sourceRunId" | "sourceMemberId" | "parentBranchId" | "revision" | "messageCount" | "bodyCiphertext">): PrivateBranchBody {
  if (Buffer.byteLength(row.bodyCiphertext, "utf8") > Math.ceil(MAX_PRIVATE_BRANCH_BYTES * 4 / 3) + 128) throw new ConversationSizeError();
  const body = boundedPrivateBody(privateBranchBodySchema.parse(decryptJson(row.bodyCiphertext, `private-branch:${row.id}:body`)));
  const deliveries = body.deliveries ?? [];
  if (new Set(deliveries.map((item) => item.id)).size !== deliveries.length || new Set(deliveries.map((item) => item.messageId)).size !== deliveries.length ||
    deliveries.some((item) => !body.messages.some((message) => message.id === item.messageId) ||
      (item.status === "succeeded") !== Boolean(item.result) || (item.status === "outcome_unknown" && !item.submittedAt))) throw new ConversationIntegrityError();
  const ownMessages = body.messages.filter((message) => message.originBranchId === row.id);
  if (body.seed.conversationId !== row.conversationId || body.seed.sourceRunId !== row.sourceRunId || body.seed.member.id !== row.sourceMemberId ||
    (body.forkedFrom?.branchId ?? null) !== row.parentBranchId || body.messages.length !== row.messageCount ||
    ownMessages.length + 1 !== row.revision || new Set(body.messages.map((message) => message.id)).size !== body.messages.length ||
    ownMessages.some((message, index) => message.acceptedRevision !== index + 2) ||
    (body.forkedFrom ? body.forkedFrom.messageCount !== body.messages.length - ownMessages.length : ownMessages.length !== body.messages.length)) {
    throw new ConversationIntegrityError();
  }
  return body;
}
function view(row: BranchRow): PrivateBranchView {
  return { ...summary(row), body: decodePrivateBranchBody(row) };
}
async function assertConversation(tx: ConversationTransaction, conversationId: string) {
  const [conversation] = await tx.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, getOwnerId()))).limit(1);
  if (!conversation) throw new ConversationIntegrityError();
}
export async function readPrivateBranch(tx: ConversationTransaction, id: string, forUpdate = false) {
  const sizeQuery = tx.select({ bytes: sql<number>`octet_length(${branches.bodyCiphertext})` }).from(branches).where(owned(id)).limit(1);
  const [size] = await (forUpdate ? sizeQuery.for("update") : sizeQuery);
  if (!size) return undefined;
  if (size.bytes > Math.ceil(MAX_PRIVATE_BRANCH_BYTES * 4 / 3) + 128) throw new ConversationSizeError();
  const [row] = await tx.select().from(branches).where(owned(id)).limit(1);
  if (!row) return undefined;
  await assertConversation(tx, row.conversationId);
  return { row, value: view(row) };
}
async function seedSnapshot(tx: ConversationTransaction, runId: string, memberId: string, lock = false) {
  // Bound the stored source before reading its authenticated report. No other
  // member, continuation archive, attachments or receipts enter the new seed.
  const sizeQuery = tx.select({ bytes: sql<number>`octet_length(row_to_json(${runs})::text)` }).from(runs)
    .where(and(eq(runs.id, runId), eq(runs.ownerId, getOwnerId()))).limit(1);
  const [size] = await (lock ? sizeQuery.for("share") : sizeQuery);
  if (!size) return undefined;
  if (size.bytes > 32 * 1024 * 1024) throw new ConversationSizeError();
  const query = tx.select({ id: runs.id, status: runs.status, stateVersion: runs.stateVersion, question: runs.question,
    questionCiphertext: runs.questionCiphertext, membersCiphertext: runs.membersCiphertext, reportCiphertext: runs.reportCiphertext,
    riskProfile: runs.riskProfile, promptVersion: runs.promptVersion, promptFingerprint: runs.promptFingerprint }).from(runs)
    .where(and(eq(runs.id, runId), eq(runs.ownerId, getOwnerId()))).limit(1);
  const [row] = await (lock ? query.for("share") : query);
  if (!row) return undefined;
  const [membership] = await tx.select({ conversationId: conversationRuns.conversationId }).from(conversationRuns)
    .where(and(eq(conversationRuns.runId, runId), eq(conversationRuns.ownerId, getOwnerId()))).limit(1);
  if (!membership) throw new ConversationPendingError();
  await assertConversation(tx, membership.conversationId);
  if (!["completed", "partially_completed"].includes(row.status) || !row.membersCiphertext || !row.reportCiphertext) throw new PrivateBranchSourceError();
  const members = councilMembersSchema.parse(decryptJson(row.membersCiphertext, `run:${row.id}:members`));
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) return undefined;
  const report = decryptJson<CouncilReport>(row.reportCiphertext, `run:${row.id}:report`);
  if (!report || typeof report !== "object" || !Array.isArray(report.memberResults)) throw new PrivateBranchSourceError();
  const results = report.memberResults?.filter((result) => result.memberId === memberId);
  if (!Array.isArray(results) || results.length !== 1) throw new PrivateBranchSourceError();
  const result = results[0]!;
  if (result.label !== member.label || result.councilRole !== member.councilRole || !providerOutputSchema.safeParse(result.parsed).success) throw new PrivateBranchSourceError();
  if (typeof result.rawText === "string" && result.rawText.length > 262_144) throw new ConversationSizeError();
  const seed = privateBranchSeedSchema.parse({ version: "selected-member-private-seed-v1", conversationId: membership.conversationId, sourceRunId: row.id,
    sourceStateVersion: row.stateVersion, sourceRiskProfile: row.riskProfile, sourcePromptVersion: row.promptVersion,
    sourcePromptFingerprint: row.promptFingerprint, member, question: row.questionCiphertext ? decryptText(row.questionCiphertext, `run:${row.id}:question`) : row.question,
    rawText: result.rawText, reusedFromRunId: result.reusedFromRunId ?? null });
  boundedPrivateBody({ version: "private-branch-drafts-v1", seed, forkedFrom: null, messages: [] });
  return { conversationId: membership.conversationId, seed, sha256: hash(seed) };
}
export async function previewPrivateBranchSeed(runId: string, memberId: string) {
  return getDatabase().transaction((tx) => seedSnapshot(tx, runId, memberId), { isolationLevel: "repeatable read", accessMode: "read only" });
}
// All branch writers acquire the conversation lock before source/branch row
// locks, matching membership creation and metadata deletion.
export async function createPrivateBranch(input: CreatePrivateBranch): Promise<PrivateBranchView | undefined> {
  const request = createPrivateBranchSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await lockConversationMembership(tx);
    const [existing] = await tx.select({ id: branches.id, requestHash: branches.requestHash }).from(branches)
      .where(and(eq(branches.ownerId, getOwnerId()), eq(branches.requestId, request.requestId))).limit(1);
    if (existing) {
      if (existing.requestHash !== hash(request)) throw new PrivateBranchConflictError();
      return (await readPrivateBranch(tx, existing.id, true))?.value;
    }
    const [deleted] = await tx.select({ id: privateBranchDeletions.id }).from(privateBranchDeletions)
      .where(and(eq(privateBranchDeletions.ownerId, getOwnerId()), eq(privateBranchDeletions.requestId, request.requestId))).limit(1);
    if (deleted) throw new PrivateBranchConflictError();
    let conversationId: string; let body: PrivateBranchBody; let parentBranchId: string | null = null;
    if (request.action === "create") {
      const preview = await seedSnapshot(tx, request.sourceRunId, request.memberId, true);
      if (!preview) return undefined;
      if (preview.sha256 !== request.expectedSeedSha256) throw new PrivateBranchConflictError();
      conversationId = preview.conversationId;
      body = { version: "private-branch-drafts-v1", seed: preview.seed, forkedFrom: null, messages: [] };
    } else {
      const parent = await readPrivateBranch(tx, request.parentBranchId, true);
      if (!parent) return undefined;
      if (parent.row.revision !== request.expectedRevision) throw new PrivateBranchConflictError();
      if ((parent.value.body.deliveryVersion ?? 0) !== request.expectedDeliveryVersion || privateDeliveryPending(parent.value.body)) throw new PrivateBranchConflictError();
      conversationId = parent.row.conversationId; parentBranchId = parent.row.id;
      body = { ...parent.value.body, deliveryVersion: 0, forkedFrom: { branchId: parent.row.id, revision: parent.row.revision, messageCount: parent.row.messageCount } };
    }
    const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(branches)
      .where(and(eq(branches.ownerId, getOwnerId()), eq(branches.conversationId, conversationId)));
    if (count!.value >= MAX_PRIVATE_BRANCHES) throw new ConversationSizeError();
    const id = randomUUID();
    const [created] = await tx.insert(branches).values({ id, ownerId: getOwnerId(), conversationId,
      sourceRunId: body.seed.sourceRunId, sourceMemberId: body.seed.member.id, parentBranchId,
      requestId: request.requestId, requestHash: hash(request), messageCount: body.messages.length,
      bodyCiphertext: encryptJson(boundedPrivateBody(body), `private-branch:${id}:body`) }).returning();
    return view(created!);
  });
}
export async function appendPrivateDraft(id: string, input: AppendPrivateDraft): Promise<PrivateBranchView | undefined> {
  const request = appendPrivateDraftSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await lockConversationMembership(tx);
    const current = await readPrivateBranch(tx, id, true);
    if (!current) return undefined;
    const existing = current.value.body.messages.find((message) => message.id === request.requestId);
    if (existing) {
      if (existing.originBranchId !== id || existing.text !== request.text || existing.acceptedRevision !== request.expectedRevision + 1) throw new PrivateBranchConflictError();
      return current.value;
    }
    if (current.row.revision !== request.expectedRevision) throw new PrivateBranchConflictError();
    if (privateDeliveryPending(current.value.body)) throw new PrivateBranchConflictError();
    if (current.row.messageCount >= 64) throw new ConversationSizeError();
    const revision = current.row.revision + 1;
    const body = boundedPrivateBody({ ...current.value.body, messages: [...current.value.body.messages, {
      id: request.requestId, kind: "owner-draft", text: request.text, createdAt: new Date().toISOString(), originBranchId: id, acceptedRevision: revision,
    }] });
    const [updated] = await tx.update(branches).set({ bodyCiphertext: encryptJson(body, `private-branch:${id}:body`),
      revision, messageCount: body.messages.length, updatedAt: sql`now()` }).where(owned(id)).returning();
    return view(updated!);
  });
}
export async function loadPrivateBranch(id: string) {
  return getDatabase().transaction(async (tx) => (await readPrivateBranch(tx, id))?.value, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function listPrivateBranchesInSnapshot(tx: ConversationTransaction, conversationId: string) {
  const [conversation] = await tx.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, getOwnerId()))).limit(1);
  if (!conversation) return undefined;
  const [foreign] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.conversationId, conversationId),
    sql`${branches.ownerId} <> ${getOwnerId()}`)).limit(1);
  if (foreign) throw new ConversationIntegrityError();
  const rows = await tx.select({ id: branches.id, conversationId: branches.conversationId, sourceRunId: branches.sourceRunId,
    sourceMemberId: branches.sourceMemberId, parentBranchId: branches.parentBranchId, revision: branches.revision, messageCount: branches.messageCount,
    createdAt: branches.createdAt, updatedAt: branches.updatedAt }).from(branches)
    .where(and(eq(branches.ownerId, getOwnerId()), eq(branches.conversationId, conversationId)))
    .orderBy(asc(branches.createdAt), asc(branches.id)).limit(MAX_PRIVATE_BRANCHES + 1);
  if (rows.length > MAX_PRIVATE_BRANCHES) throw new ConversationSizeError();
  return rows.map(summary);
}
export async function listPrivateBranches(conversationId: string) {
  return getDatabase().transaction((tx) => listPrivateBranchesInSnapshot(tx, conversationId), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function exportPrivateBranchesInSnapshot(tx: ConversationTransaction, conversationId: string) {
  const listed = await listPrivateBranchesInSnapshot(tx, conversationId);
  if (!listed) return undefined;
  const [size] = await tx.select({ bytes: sql<number>`coalesce(sum(octet_length(${branches.bodyCiphertext})), 0)::int` }).from(branches)
    .where(and(eq(branches.ownerId, getOwnerId()), eq(branches.conversationId, conversationId)));
  if (size!.bytes > 32 * 1024 * 1024) throw new ConversationSizeError();
  const rows = await tx.select().from(branches).where(and(eq(branches.ownerId, getOwnerId()), eq(branches.conversationId, conversationId)))
    .orderBy(asc(branches.createdAt), asc(branches.id));
  return rows.map(view);
}
export async function exportPrivateBranch(id: string) {
  const branch = await loadPrivateBranch(id);
  return branch ? { schemaVersion: "deliberationai-private-branch-export-v1", exportedAt: new Date().toISOString(),
    scope: "Frozen selected reply, owner messages and private delivery requests/results. Excludes original omitted context, peer outputs, attachments and credentials. Plaintext export.", branch } : undefined;
}

export function privateDeliveryPending(body: PrivateBranchBody) {
  return (body.deliveries ?? []).some((item) => ["prepared", "submitted", "outcome_unknown"].includes(item.status));
}
export async function writePrivateDeliveryBody(tx: ConversationTransaction, id: string, body: PrivateBranchBody) {
  await tx.update(branches).set({ bodyCiphertext: encryptJson(boundedPrivateBody(body), `private-branch:${id}:body`), updatedAt: sql`now()` }).where(owned(id));
}
