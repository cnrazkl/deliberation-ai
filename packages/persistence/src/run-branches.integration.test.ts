import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { freezeContinuation } from "@deliberation-ai/application";
import { closeDatabase, getDatabase } from "./database";
import { encryptJson, encryptText } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { closeBoss, RUN_COUNCIL_QUEUE } from "./queue";
import { runs } from "./schema";
import { enqueueDurableRun, executeDurableRun, loadRunContinuation } from "./run-repository";
import { indexExistingRunBranches, loadRunBranches, RunBranchIndexPendingError, RunBranchIntegrityError } from "./run-branches";

const ids: string[] = [];
beforeAll(async () => { await indexExistingRunBranches(); });
afterAll(async () => {
  await closeBoss();
  if (ids.length) {
    await getDatabase().execute(sql`DELETE FROM pgboss.job WHERE name = ${RUN_COUNCIL_QUEUE}
      AND data->>'runId' IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    await getDatabase().delete(runs).where(inArray(runs.id, ids));
  }
  await closeDatabase();
});

function fixture(sourceRunId: string | null = null, kind: "continuation-full" | "member-rerun" = "continuation-full", ownerId = LOCAL_OWNER_ID, createdAt = new Date()) {
  const id = randomUUID(); ids.push(id);
  const context = sourceRunId ? freezeContinuation({ sourceRunId, sourceRiskProfile: "standard", content: "{}" }) : null;
  return {
    id, ownerId, idempotencyKey: randomUUID(), requestHash: "fixture", snapshotId: randomUUID(),
    question: "[encrypted]", questionCiphertext: encryptText(`Dal sorusu ${id}`, `run:${id}:question`),
    status: "completed" as const, createdAt, branchSourceRunId: sourceRunId,
    branchKind: sourceRunId ? kind : "independent", branchIndexVersion: 1,
    continuationContextCiphertext: context ? encryptJson(context, `run:${id}:continuation-context`) : null,
    followUpCiphertext: sourceRunId && kind === "member-rerun" ? encryptJson({ version: "member-rerun-v1", sourceRunId }, `run:${id}:follow-up`) : null,
  };
}
async function insert(value = fixture()) { await getDatabase().insert(runs).values(value); return value; }

test("indexes new full and compacted siblings atomically with intent replay and preserves navigation after source deletion", async () => {
  const input = { question: "Kaynak alternatifleri nasıl karşılaştırabiliriz?", idempotencyKey: randomUUID(), scenario: "success" as const, providerMode: "fake" as const, reviewRounds: 0 as const, memoryEntryIds: [] };
  const source = await enqueueDurableRun(input); ids.push(source.runId);
  await executeDurableRun(source.runId);
  const context = await loadRunContinuation(source.runId);
  const request = { ...input, idempotencyKey: randomUUID(), continuationSource: { runId: source.runId, expectedSha256: context.sha256 } };
  const full = await enqueueDurableRun(request); ids.push(full.runId);
  expect((await enqueueDurableRun(request)).runId).toBe(full.runId);
  const compacted = await enqueueDurableRun({ ...request, idempotencyKey: randomUUID(), continuationSource: {
    ...request.continuationSource, compaction: { version: "manual-continuation-compaction-v1", summary: "Bu özet alternatifleri ve belirsizlikleri içerir.", reviewed: true },
  } }); ids.push(compacted.runId);
  const graph = await loadRunBranches(full.runId);
  expect(graph?.current.kind).toBe("continuation-full");
  expect(graph?.ancestors.map((item) => item.runId)).toEqual([source.runId]);
  expect(graph?.siblings.runs.map((item) => [item.runId, item.kind])).toEqual([[compacted.runId, "continuation-compacted"]]);
  expect((await loadRunBranches(source.runId))?.children.runs).toHaveLength(2);
  await getDatabase().delete(runs).where(eq(runs.id, source.runId));
  expect(await loadRunBranches(full.runId)).toMatchObject({ unavailableSourceRunId: source.runId, ancestors: [], ancestorsTruncated: false });
  expect((await loadRunBranches(full.runId))?.siblings.runs[0]?.runId).toBe(compacted.runId);
});

test("uses the immediate rerun parent instead of its inherited older continuation", async () => {
  const root = await insert();
  const child = await insert(fixture(root.id));
  const rerun = fixture(child.id, "member-rerun");
  rerun.continuationContextCiphertext = encryptJson(freezeContinuation({ sourceRunId: root.id, sourceRiskProfile: "standard", content: "{}" }), `run:${rerun.id}:continuation-context`);
  await insert(rerun);
  const graph = await loadRunBranches(rerun.id);
  expect(graph?.current.kind).toBe("member-rerun");
  expect(graph?.ancestors.map((item) => item.runId)).toEqual([child.id, root.id]);
  expect((await loadRunBranches(root.id))?.children.runs.map((item) => item.runId)).toEqual([child.id]);
});

test("paginates tied timestamps without duplication and scopes rows and cursors to the owner and branch", async () => {
  const root = await insert();
  const date = new Date("2020-01-01T00:00:00Z");
  const children = Array.from({ length: 43 }, () => fixture(root.id, "continuation-full", LOCAL_OWNER_ID, date));
  await getDatabase().insert(runs).values(children);
  const foreign = await insert(fixture(root.id, "continuation-full", "foreign-owner", date));
  const unrelated = await insert();
  const first = await loadRunBranches(root.id);
  const second = await loadRunBranches(root.id, { childrenBefore: first!.children.nextCursor! });
  const third = await loadRunBranches(root.id, { childrenBefore: second!.children.nextCursor! });
  const seen = [first, second, third].flatMap((page) => page!.children.runs.map((item) => item.runId));
  expect(new Set(seen).size).toBe(43);
  expect(seen).toEqual(children.map((item) => item.id).sort().reverse());
  expect(third!.children.nextCursor).toBeNull();
  expect(await loadRunBranches(root.id, { childrenBefore: foreign.id })).toBeUndefined();
  expect(await loadRunBranches(root.id, { childrenBefore: unrelated.id })).toBeUndefined();
  expect(await loadRunBranches(foreign.id)).toBeUndefined();
  expect((await loadRunBranches(unrelated.id))!.siblings.runs).toEqual([]);
  const sameSource = await loadRunBranches(children[0]!.id);
  expect(sameSource?.siblings.runs).toHaveLength(20);
  expect(sameSource?.siblings.runs.some((item) => item.runId === children[0]!.id)).toBe(false);
  expect(await loadRunBranches(children[0]!.id, { siblingsBefore: children[0]!.id })).toBeUndefined();
});

test("pages children and siblings without losing PostgreSQL sub-millisecond timestamp ties", async () => {
  const root = await insert();
  const children = Array.from({ length: 43 }, () => fixture(root.id));
  await getDatabase().insert(runs).values(children.map((child, i) => ({ ...child,
    createdAt: sql`${i < 2 ? "2020-01-01 00:00:00.123999+00" : "2020-01-01 00:00:00.123456+00"}::timestamptz`,
  })));
  const first = (await loadRunBranches(root.id))!;
  const second = (await loadRunBranches(root.id, { childrenBefore: first.children.nextCursor! }))!;
  const third = (await loadRunBranches(root.id, { childrenBefore: second.children.nextCursor! }))!;
  const observed = [first, second, third].flatMap((value) => value.children.runs.map((item) => item.runId));
  expect(observed.sort()).toEqual(children.map((child) => child.id).sort());
  expect(new Set(observed).size).toBe(43);
  const sibling1 = (await loadRunBranches(children[0]!.id))!;
  const sibling2 = (await loadRunBranches(children[0]!.id, { siblingsBefore: sibling1.siblings.nextCursor! }))!;
  const sibling3 = (await loadRunBranches(children[0]!.id, { siblingsBefore: sibling2.siblings.nextCursor! }))!;
  const siblings = [sibling1, sibling2, sibling3].flatMap((value) => value.siblings.runs.map((item) => item.runId));
  expect(siblings.sort()).toEqual(children.slice(1).map((child) => child.id).sort());
});

test("authenticates legacy backfill, reports pending work and never silently rewrites an existing index", async () => {
  const root = await insert();
  const child = await insert(fixture(root.id));
  await getDatabase().update(runs).set({ branchSourceRunId: null, branchKind: null, branchIndexVersion: 0 }).where(eq(runs.id, child.id));
  await expect(loadRunBranches(root.id)).rejects.toBeInstanceOf(RunBranchIndexPendingError);
  expect(await indexExistingRunBranches()).toBe(1);
  expect(await indexExistingRunBranches()).toBe(0);
  expect((await loadRunBranches(root.id))?.children.runs[0]?.runId).toBe(child.id);
  await getDatabase().update(runs).set({ branchSourceRunId: randomUUID() }).where(eq(runs.id, child.id));
  expect(await indexExistingRunBranches()).toBe(0);
  await expect(loadRunBranches(child.id)).rejects.toBeInstanceOf(RunBranchIntegrityError);
  await getDatabase().delete(runs).where(eq(runs.id, child.id));
});

test("rejects corrupted legacy snapshots without publishing a partial batch", async () => {
  const value = fixture(randomUUID());
  await getDatabase().insert(runs).values({ ...value, branchIndexVersion: 0, branchKind: null, branchSourceRunId: null, continuationContextCiphertext: "invalid" });
  await expect(indexExistingRunBranches()).rejects.toThrow();
  const [stored] = await getDatabase().select().from(runs).where(eq(runs.id, value.id));
  expect(stored?.branchIndexVersion).toBe(0);
  await getDatabase().delete(runs).where(eq(runs.id, value.id));
});

test("bounds long ancestor chains and rejects authenticated cycles", async () => {
  let chain = fixture();
  const rows = [chain];
  for (let index = 0; index < 65; index++) { chain = fixture(chain.id); rows.push(chain); }
  await getDatabase().insert(runs).values(rows);
  const graph = await loadRunBranches(chain.id);
  expect(graph?.ancestors).toHaveLength(64);
  expect(graph?.ancestorsTruncated).toBe(true);
  const a = fixture(); const b = fixture(a.id);
  a.branchSourceRunId = b.id; a.branchKind = "continuation-full";
  a.continuationContextCiphertext = encryptJson(freezeContinuation({ sourceRunId: b.id, sourceRiskProfile: "standard", content: "{}" }), `run:${a.id}:continuation-context`);
  await getDatabase().insert(runs).values([a, b]);
  await expect(loadRunBranches(a.id)).rejects.toBeInstanceOf(RunBranchIntegrityError);
});
