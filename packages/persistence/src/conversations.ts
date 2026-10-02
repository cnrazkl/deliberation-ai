import { and, asc, eq, sql } from "drizzle-orm";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { conversations, conversationRuns, runs } from "./schema";
import { projectRunBranch, type RunBranchItem } from "./run-branches";
import { mapStoredRun } from "./run-repository";
import { exportPrivateBranchesInSnapshot } from "./private-branches";
import { exportPrivateBranchDeletions } from "./private-branch-deletion";
import { ConversationIntegrityError, ConversationPendingError, ConversationSizeError, type ConversationTransaction } from "./conversation-membership";

export const MAX_CONVERSATION_RUNS = 200;
export const MAX_CONVERSATION_EXPORT_BYTES = 32 * 1024 * 1024;
export type ConversationView = {
  conversationId: string; anchorRunId: string; createdAt: string;
  origin: "native" | "legacy-reconstructed";
  runs: Array<{ runId: string; sourceRunId: string | null; kind: string; createdAt: string; detail: RunBranchItem | null }>;
  unavailableSourceRunIds: string[];
};

async function snapshot(tx: ConversationTransaction, conversationId: string) {
  const [conversation] = await tx.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, LOCAL_OWNER_ID))).limit(1);
  if (!conversation) return undefined;
  const pending = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.ownerId, LOCAL_OWNER_ID),
    sql`not exists (select 1 from conversation_runs cr where cr.owner_id = ${LOCAL_OWNER_ID} and cr.run_id = ${runs.id})`,
  )).limit(1);
  if (pending.length) throw new ConversationPendingError();
  const predicate = and(eq(conversationRuns.ownerId, LOCAL_OWNER_ID), eq(conversationRuns.conversationId, conversation.id));
  const members = await tx.select().from(conversationRuns).where(predicate)
    .orderBy(asc(conversationRuns.createdAt), asc(conversationRuns.runId)).limit(MAX_CONVERSATION_RUNS + 1);
  if (members.length > MAX_CONVERSATION_RUNS) throw new ConversationSizeError();
  // Refuse before loading/decrypting potentially large report and archive bodies.
  const [size] = await tx.select({ bytes: sql<string>`coalesce(sum(octet_length(row_to_json(${runs})::text)), 0)::text` }).from(conversationRuns)
    .innerJoin(runs, and(eq(runs.id, conversationRuns.runId), eq(runs.ownerId, LOCAL_OWNER_ID))).where(predicate);
  if (Number(size?.bytes ?? 0) > MAX_CONVERSATION_EXPORT_BYTES) throw new ConversationSizeError();
  const rows = await tx.select({ member: conversationRuns, run: runs }).from(conversationRuns)
    .leftJoin(runs, and(eq(runs.id, conversationRuns.runId), eq(runs.ownerId, LOCAL_OWNER_ID)))
    .where(predicate).orderBy(asc(conversationRuns.createdAt), asc(conversationRuns.runId));
  const byId = new Map(members.map((member) => [member.runId, member]));
  for (const member of members) {
    const visited = new Set([member.runId]);
    let terminal = member.runId;
    let source = member.sourceRunId;
    while (source && byId.has(source)) {
      if (visited.has(source)) throw new ConversationIntegrityError();
      terminal = source;
      visited.add(source); source = byId.get(source)!.sourceRunId;
    }
    if (source) {
      const [other] = await tx.select({ id: conversationRuns.conversationId }).from(conversationRuns)
        .where(and(eq(conversationRuns.ownerId, LOCAL_OWNER_ID), eq(conversationRuns.runId, source))).limit(1);
      if (other) throw new ConversationIntegrityError();
    }
    if ((source ?? terminal) !== conversation.anchorRunId) throw new ConversationIntegrityError();
  }
  const view: ConversationView = {
    conversationId: conversation.id, anchorRunId: conversation.anchorRunId, createdAt: conversation.createdAt.toISOString(),
    origin: conversation.origin === "native" ? "native" : "legacy-reconstructed",
    runs: rows.map(({ member, run }) => {
      const detail = run ? projectRunBranch(run) : null;
      if (run && (run.branchSourceRunId !== member.sourceRunId || detail!.kind !== member.kind || run.createdAt.getTime() !== member.createdAt.getTime())) throw new ConversationIntegrityError();
      return { runId: member.runId, sourceRunId: member.sourceRunId, kind: member.kind, createdAt: member.createdAt.toISOString(), detail };
    }),
    unavailableSourceRunIds: [...new Set(members.flatMap((member) => member.sourceRunId && !byId.has(member.sourceRunId) ? [member.sourceRunId] : []))].sort(),
  };
  return { view, rows };
}

export async function loadRunConversation(runId: string): Promise<ConversationView | undefined> {
  return getDatabase().transaction(async (tx) => {
    const [member] = await tx.select().from(conversationRuns).where(and(eq(conversationRuns.ownerId, LOCAL_OWNER_ID), eq(conversationRuns.runId, runId))).limit(1);
    if (!member) {
      const [existing] = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.id, runId))).limit(1);
      if (existing) throw new ConversationPendingError();
      return undefined;
    }
    return (await snapshot(tx, member.conversationId))?.view;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function exportConversation(conversationId: string) {
  return getDatabase().transaction(async (tx) => {
    const value = await snapshot(tx, conversationId);
    if (!value) return undefined;
    const exported = {
      schemaVersion: "deliberationai-conversation-export-v1" as const,
      exportedAt: new Date().toISOString(),
      conversation: value.view,
      privateBranches: await exportPrivateBranchesInSnapshot(tx, conversationId),
      privateBranchDeletions: await exportPrivateBranchDeletions(tx, conversationId),
      scope: "All retained runs, private branches and content-free private deletion audits in this database snapshot; unavailable runs have metadata only. Private branches contain selected reply copies, saved owner text and retained private delivery replies/receipts. Deletion audits retain usage/provenance identifiers without removed branch text; copied receipts are not fresh calls. Legacy grouping uses surviving source links. Separate attachments, memory/tool/evidence records and decision assessments are outside this export.",
      runs: value.rows.map(({ member, run: row }) => {
        if (!row) return { runId: member.runId, availability: "unavailable" as const, payload: null };
        const run = mapStoredRun(row);
        return { runId: run.runId, availability: "available" as const, payload: {
          runId: run.runId, createdAt: run.createdAt, status: run.status, question: run.question,
          providerMode: run.providerMode, reviewRounds: run.reviewRounds,
          riskProfile: run.riskProfile, riskAssessment: run.riskAssessment ?? null,
          preflightDecision: run.preflightDecision ?? null, promptRevision: run.promptRevision ?? null,
          promptVersion: run.promptVersion, promptFingerprint: run.promptFingerprint,
          executionLimits: run.executionLimits ?? null, followUp: run.followUp ?? null,
          continuationContext: run.continuationContext ?? null, continuationArchive: run.continuationArchive ?? null,
          memberCount: run.memberCount, memoryEntryCount: run.memoryEntryCount,
          attachmentCount: run.attachmentCount, toolResultCount: run.toolResultCount, report: run.report,
        } };
      }),
    };
    // Never silently truncate; includes JSON expansion and decrypted originals.
    if (Buffer.byteLength(JSON.stringify(exported), "utf8") > MAX_CONVERSATION_EXPORT_BYTES) throw new ConversationSizeError();
    return exported;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
