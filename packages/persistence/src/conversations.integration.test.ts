import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { freezeContinuation } from "@deliberation-ai/application";
import { closeDatabase, getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { encryptJson, encryptText } from "./crypto";
import { conversations, conversationRuns, runs } from "./schema";
import { closeBoss, RUN_COUNCIL_QUEUE } from "./queue";
import { enqueueDurableRun, executeDurableRun, loadRunContinuation, loadRunContinuationCompaction } from "./run-repository";
import { indexExistingRunBranches } from "./run-branches";
import { indexExistingConversations, ConversationIntegrityError, ConversationSizeError, ConversationPendingError } from "./conversation-membership";
import { exportConversation, loadRunConversation, MAX_CONVERSATION_EXPORT_BYTES } from "./conversations";
import { pruneExpiredRuns } from "./run-retention";

const ids: string[] = [];
const conversationIds: string[] = [];
beforeAll(async () => { await indexExistingRunBranches(); await indexExistingConversations(); });
afterAll(async () => {
  await closeBoss();
  if (ids.length) {
    await getDatabase().execute(sql`delete from pgboss.job where name = ${RUN_COUNCIL_QUEUE} and data->>'runId' in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    await getDatabase().delete(runs).where(inArray(runs.id, ids));
    await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.runId, ids));
  }
  if (conversationIds.length) await getDatabase().delete(conversations).where(inArray(conversations.id, conversationIds));
  await closeDatabase();
});
const request = () => ({ question: "Bağımsız alternatifler hangi koşullarda karşılaştırılır?", idempotencyKey: randomUUID(), providerMode: "fake" as const, scenario: "success" as const, reviewRounds: 0 as const, memoryEntryIds: [] });
async function root() {
  const value = await enqueueDurableRun(request()); ids.push(value.runId);
  const view = await loadRunConversation(value.runId); conversationIds.push(view!.conversationId);
  return value;
}
function legacy(sourceRunId: string | null = null) {
  const id = randomUUID(); ids.push(id);
  return { id, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "fixture", snapshotId: randomUUID(),
    question: "[encrypted]", questionCiphertext: encryptText("Eski konuşma sorusu", `run:${id}:question`),
    branchIndexVersion: 1, branchKind: sourceRunId ? "continuation-full" : "independent", branchSourceRunId: sourceRunId,
    continuationContextCiphertext: sourceRunId ? encryptJson(freezeContinuation({ sourceRunId, sourceRiskProfile: "standard", content: "{}" }), `run:${id}:continuation-context`) : null };
}

test("atomically groups concurrent siblings, replays an intent and exports compacted originals and queued state", async () => {
  const source = await root(); await executeDurableRun(source.runId);
  const context = await loadRunContinuation(source.runId);
  const fullRequest = { ...request(), continuationSource: { runId: source.runId, expectedSha256: context.sha256 } };
  const [a, b] = await Promise.all([enqueueDurableRun(fullRequest), enqueueDurableRun(fullRequest)]);
  ids.push(a.runId); expect(a.runId).toBe(b.runId);
  const packet = await loadRunContinuationCompaction(source.runId);
  const compacted = await enqueueDurableRun({ ...request(), continuationSource: { runId: source.runId, expectedSha256: packet.sourceSha256,
    compaction: { version: "manual-continuation-compaction-v1", summary: "Alternatifler ve belirsizlikler ayrı değerlendirilmelidir.", reviewed: true } } });
  ids.push(compacted.runId);
  const view = await loadRunConversation(a.runId);
  expect(view?.origin).toBe("native"); expect(view?.runs).toHaveLength(3);
  expect((await loadRunConversation(compacted.runId))?.conversationId).toBe(view?.conversationId);
  const exported = await exportConversation(view!.conversationId);
  expect(exported?.runs.map((item) => item.runId).sort()).toEqual([source.runId, a.runId, compacted.runId].sort());
  expect(exported?.runs.find((item) => item.runId === compacted.runId)?.payload?.continuationArchive).toEqual(compacted.continuationArchive);
  expect(exported?.runs.find((item) => item.runId === a.runId)?.payload).toMatchObject({ status: "queued", report: null, continuationContext: context });
  expect(JSON.stringify(exported)).not.toMatch(/idempotencyKey|requestHash|Ciphertext|apiKey/);
});

test("preserves conversation identity and missing membership after actual source retention, including later descendants", async () => {
  const source = await root(); await executeDurableRun(source.runId);
  const context = await loadRunContinuation(source.runId);
  const child = await enqueueDurableRun({ ...request(), continuationSource: { runId: source.runId, expectedSha256: context.sha256 } }); ids.push(child.runId);
  const original = await loadRunConversation(child.runId);
  await getDatabase().update(runs).set({ finishedAt: new Date("2020-01-01") }).where(eq(runs.id, source.runId));
  expect((await pruneExpiredRuns({ retentionDays: 1, apply: true, onlyRunIds: [source.runId] })).count).toBe(1);
  expect((await loadRunConversation(source.runId))?.conversationId).toBe(original?.conversationId);
  await executeDurableRun(child.runId);
  const nextContext = await loadRunContinuation(child.runId);
  const grandchild = await enqueueDurableRun({ ...request(), continuationSource: { runId: child.runId, expectedSha256: nextContext.sha256 } }); ids.push(grandchild.runId);
  expect((await loadRunConversation(grandchild.runId))?.conversationId).toBe(original?.conversationId);
  const exported = await exportConversation(original!.conversationId);
  expect(exported?.runs).toHaveLength(3);
  expect(exported?.runs.find((item) => item.runId === source.runId)).toEqual({ runId: source.runId, availability: "unavailable", payload: null });
  expect(exported?.runs.find((item) => item.runId === child.runId)?.payload?.continuationContext).toEqual(context);
});

test("authenticates legacy grouping across missing anchors and is idempotent without guessing lost bridges", async () => {
  const missing = randomUUID(); const a = legacy(missing); const b = legacy(missing); const other = legacy();
  await getDatabase().insert(runs).values([{ ...a, createdAt: sql`TIMESTAMPTZ '2020-01-01 00:00:00.123456+00'` }, b, other]);
  await expect(loadRunConversation(a.id)).rejects.toBeInstanceOf(ConversationPendingError);
  expect(await indexExistingConversations()).toBe(3);
  expect(await indexExistingConversations()).toBe(0);
  const precision = await getDatabase().execute(sql`select r.created_at = cr.created_at as exact
    from runs r join conversation_runs cr on cr.run_id = r.id and cr.owner_id = r.owner_id where r.id = ${a.id}`);
  expect(precision.rows[0]?.exact).toBe(true);
  const av = await loadRunConversation(a.id); const ov = await loadRunConversation(other.id);
  conversationIds.push(av!.conversationId, ov!.conversationId);
  expect(av).toMatchObject({ anchorRunId: missing, origin: "legacy-reconstructed", unavailableSourceRunIds: [missing] });
  expect(av?.runs.map((item) => item.runId).sort()).toEqual([a.id, b.id].sort());
  expect(ov?.conversationId).not.toBe(av?.conversationId);
});

test("rejects foreign conversation access and drift instead of exporting unrelated owned roots", async () => {
  const a = await root(); const b = await root();
  const av = await loadRunConversation(a.runId); const bv = await loadRunConversation(b.runId);
  await getDatabase().update(conversationRuns).set({ conversationId: av!.conversationId }).where(eq(conversationRuns.runId, b.runId));
  await expect(exportConversation(av!.conversationId)).rejects.toBeInstanceOf(ConversationIntegrityError);
  await getDatabase().update(conversationRuns).set({ conversationId: bv!.conversationId }).where(eq(conversationRuns.runId, b.runId));
  const foreign = randomUUID(); conversationIds.push(foreign);
  await getDatabase().insert(conversations).values({ id: foreign, ownerId: "another-owner", anchorRunId: randomUUID(), origin: "native" });
  expect(await exportConversation(foreign)).toBeUndefined();
  expect(await loadRunConversation(randomUUID())).toBeUndefined();
});

test("rolls back legacy cycles without leaving partial membership", async () => {
  const a = legacy(); const b = legacy(a.id);
  a.branchSourceRunId = b.id; a.branchKind = "continuation-full";
  a.continuationContextCiphertext = encryptJson(freezeContinuation({ sourceRunId: b.id, sourceRiskProfile: "standard", content: "{}" }), `run:${a.id}:continuation-context`);
  await getDatabase().insert(runs).values([a, b]);
  await expect(indexExistingConversations()).rejects.toBeInstanceOf(ConversationIntegrityError);
  expect(await getDatabase().select().from(conversationRuns).where(inArray(conversationRuns.runId, [a.id, b.id]))).toEqual([]);
  await getDatabase().delete(runs).where(inArray(runs.id, [a.id, b.id]));
});

test("refuses oversized conversation membership or bodies without returning a partial export", async () => {
  const source = await root(); const view = await loadRunConversation(source.runId);
  const extraIds = Array.from({ length: 200 }, () => randomUUID()); ids.push(...extraIds);
  await getDatabase().insert(conversationRuns).values(extraIds.map((id) => ({ ownerId: LOCAL_OWNER_ID, runId: id,
    conversationId: view!.conversationId, sourceRunId: source.runId, kind: "continuation-full", createdAt: new Date() })));
  await expect(exportConversation(view!.conversationId)).rejects.toBeInstanceOf(ConversationSizeError);
  await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.runId, extraIds));
  await getDatabase().update(runs).set({ reportCiphertext: "x".repeat(MAX_CONVERSATION_EXPORT_BYTES + 1) }).where(eq(runs.id, source.runId));
  await expect(exportConversation(view!.conversationId)).rejects.toBeInstanceOf(ConversationSizeError);
  await getDatabase().update(runs).set({ reportCiphertext: null }).where(eq(runs.id, source.runId));
});
