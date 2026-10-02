import { validateContinuation } from "@deliberation-ai/application";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { getDatabase } from "./database";
import { decryptJson, decryptText } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { runs } from "./schema";

export type RunBranchKind = "independent" | "continuation-full" | "continuation-compacted" | "member-rerun";
export type RunBranchItem = {
  runId: string; question: string; status: typeof runs.$inferSelect.status;
  createdAt: string; kind: RunBranchKind;
};
export type RunBranchPage = { runs: RunBranchItem[]; nextCursor: string | null };
export type RunBranches = {
  current: RunBranchItem;
  ancestors: RunBranchItem[];
  unavailableSourceRunId: string | null;
  ancestorsTruncated: boolean;
  siblings: RunBranchPage;
  children: RunBranchPage;
};

export class RunBranchIndexPendingError extends Error {}
export class RunBranchIntegrityError extends Error {}
export const RUN_BRANCH_PAGE_SIZE = 20;
export const RUN_BRANCH_ANCESTOR_LIMIT = 64;
export const runBranchFields = {
  id: runs.id, question: runs.question, questionCiphertext: runs.questionCiphertext,
  status: runs.status, createdAt: runs.createdAt, branchSourceRunId: runs.branchSourceRunId,
  branchKind: runs.branchKind, branchIndexVersion: runs.branchIndexVersion,
  followUpCiphertext: runs.followUpCiphertext, continuationContextCiphertext: runs.continuationContextCiphertext,
};
const fields = runBranchFields;
type BranchRow = Pick<typeof runs.$inferSelect, keyof typeof fields>;
function followUpPointer(value: unknown): { sourceRunId: string } {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== "member-rerun-v1" ||
    !("sourceRunId" in value) || typeof value.sourceRunId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.sourceRunId)) throw new RunBranchIntegrityError();
  return { sourceRunId: value.sourceRunId.toLowerCase() };
}

function sourceLink(row: BranchRow): { sourceRunId: string | null; kind: RunBranchKind } {
  // A rerun's inherited continuation may point further back. Its immediate
  // parent is always the authenticated rerun snapshot, never that older source.
  const context = row.continuationContextCiphertext
    ? validateContinuation(decryptJson(row.continuationContextCiphertext, `run:${row.id}:continuation-context`)) : null;
  const followUp = row.followUpCiphertext
    ? followUpPointer(decryptJson(row.followUpCiphertext, `run:${row.id}:follow-up`)) : null;
  const link = followUp ? { sourceRunId: followUp.sourceRunId, kind: "member-rerun" as const }
    : context ? { sourceRunId: context.sourceRunId.toLowerCase(), kind: context.version === "run-continuation-v2" ? "continuation-compacted" as const : "continuation-full" as const }
      : { sourceRunId: null, kind: "independent" as const };
  if (link.sourceRunId === row.id) throw new RunBranchIntegrityError();
  return link;
}

export function projectRunBranch(row: BranchRow): RunBranchItem {
  const link = sourceLink(row);
  if (row.branchIndexVersion !== 1 || row.branchSourceRunId !== link.sourceRunId || row.branchKind !== link.kind) {
    throw new RunBranchIntegrityError();
  }
  return {
    runId: row.id, question: row.questionCiphertext ? decryptText(row.questionCiphertext, `run:${row.id}:question`) : row.question,
    status: row.status, createdAt: row.createdAt.toISOString(), kind: link.kind,
  };
}

const project = projectRunBranch;

// Reversible metadata migration: authenticate existing pointers in bounded,
// row-locked batches. Never alter snapshots, reports, timestamps or queue work.
// Pending rows keep navigation closed until the owner's migration is complete.
export async function indexExistingRunBranches(): Promise<number> {
  const db = getDatabase();
  let indexed = 0;
  for (;;) {
    const count = await db.transaction(async (tx) => {
      const rows = await tx.select(fields).from(runs).where(and(
        eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.branchIndexVersion, 0),
      )).orderBy(asc(runs.id)).limit(100).for("update");
      for (const row of rows) {
        const link = sourceLink(row);
        await tx.update(runs).set({ branchSourceRunId: link.sourceRunId, branchKind: link.kind, branchIndexVersion: 1 })
          .where(and(eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.id, row.id)));
      }
      return rows.length;
    });
    indexed += count;
    if (count < 100) return indexed;
  }
}

export async function loadRunBranches(runId: string, options: {
  childrenBefore?: string; siblingsBefore?: string;
} = {}): Promise<RunBranches | undefined> {
  return getDatabase().transaction(async (tx) => {
    const ownedRow = async (id: string) => (await tx.select(fields).from(runs)
      .where(and(eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.id, id))).limit(1))[0];
    const current = await ownedRow(runId);
    if (!current) return undefined;
    const pending = await tx.select({ id: runs.id }).from(runs).where(and(
      eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.branchIndexVersion, 0),
    )).limit(1);
    if (pending.length) throw new RunBranchIndexPendingError();
    const currentItem = project(current);
    const ancestors: RunBranchItem[] = [];
    const visited = new Set([current.id]);
    let sourceId = current.branchSourceRunId;
    let unavailableSourceRunId: string | null = null;
    while (sourceId && ancestors.length < RUN_BRANCH_ANCESTOR_LIMIT) {
      if (visited.has(sourceId)) throw new RunBranchIntegrityError();
      visited.add(sourceId);
      const source = await ownedRow(sourceId);
      if (!source) { unavailableSourceRunId = sourceId; sourceId = null; break; }
      ancestors.push(project(source));
      sourceId = source.branchSourceRunId;
    }
    if (sourceId && visited.has(sourceId)) throw new RunBranchIntegrityError();
    const page = async (parentId: string | null, before: string | undefined, siblings: boolean): Promise<RunBranchPage | undefined> => {
      // Independent runs are not siblings simply because they have no parent.
      if (!parentId) return before ? undefined : { runs: [], nextCursor: null };
      const cursor = before ? await ownedRow(before) : undefined;
      if (before && (!cursor || cursor.branchSourceRunId !== parentId || (siblings && cursor.id === current.id))) return undefined;
      if (cursor) project(cursor);
      const rows = await tx.select(fields).from(runs).where(and(
        eq(runs.ownerId, LOCAL_OWNER_ID), eq(runs.branchSourceRunId, parentId),
        siblings ? ne(runs.id, runId) : undefined,
        cursor ? sql`(${runs.createdAt}, ${runs.id}) < (select created_at, id from runs where owner_id = ${LOCAL_OWNER_ID} and id = ${cursor.id}::uuid)` : undefined,
      )).orderBy(desc(runs.createdAt), desc(runs.id)).limit(RUN_BRANCH_PAGE_SIZE + 1);
      const visible = rows.slice(0, RUN_BRANCH_PAGE_SIZE);
      return { runs: visible.map(project), nextCursor: rows.length > RUN_BRANCH_PAGE_SIZE ? visible.at(-1)!.id : null };
    };
    const siblings = await page(current.branchSourceRunId, options.siblingsBefore, true);
    const children = await page(current.id, options.childrenBefore, false);
    if (!siblings || !children) return undefined;
    return { current: currentItem, ancestors, unavailableSourceRunId, ancestorsTruncated: sourceId !== null, siblings, children };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
