import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { defaultFakeCouncilMembers, type CreateRunRequest } from "@deliberation-ai/contracts";
import { buildCompactedContinuation, buildRoundZeroPromptPlan, executeCouncil, executeFakeCouncil, freezeContinuation, IdempotencyConflictError, RiskConfigurationError } from "@deliberation-ai/application";
import { FakeProvider } from "../../providers/src";
import { getDatabase, closeDatabase } from "./database";
import { encryptJson } from "./crypto";
import { closeBoss, RUN_COUNCIL_QUEUE } from "./queue";
import { runs, conversationRuns } from "./schema";
import { LOCAL_OWNER_ID } from "./owner";
import { createAwaitingPreflightDraft, preparePreflightDraft, startPreflightDraft } from "./preflight-drafts";
import { pruneExpiredRuns } from "./run-retention";
import { ContinuationUnavailableError, enqueueDurableRun, enqueueSelectedMemberRerun, executeDurableRun, findDurableRunById, loadRunContinuation, loadRunContinuationCompaction, PreflightMismatchError, updateDurableClaimSynthesisCoverage } from "./run-repository";
import { deleteProviderConnection, saveProviderConnection } from "./provider-connections";

const ids: string[] = [];
const connections: string[] = [];
const input = (): CreateRunRequest => ({ question: "Hangi varsayımları bağımsız olarak incelemeliyiz?", idempotencyKey: randomUUID(), scenario: "success", providerMode: "fake", reviewRounds: 1, memoryEntryIds: [] });
async function queue(value = input()) {
  const run = await enqueueDurableRun(value);
  ids.push(run.runId);
  return run;
}
async function source() {
  const run = await queue();
  await executeDurableRun(run.runId);
  return { run, context: await loadRunContinuation(run.runId) };
}
const pointer = (context: Awaited<ReturnType<typeof loadRunContinuation>>) => ({ runId: context.sourceRunId, expectedSha256: context.sha256 });
const compactChoice = { version: "manual-continuation-compaction-v1" as const, summary: "İncelenen özet, alternatif görüşü ve açık belirsizlikleri korur.", reviewed: true as const };
async function compactRequest(runId: string) {
  const packet = await loadRunContinuationCompaction(runId);
  return { ...input(), continuationSource: { runId, expectedSha256: packet.sourceSha256, compaction: compactChoice } };
}

afterAll(async () => {
  await closeBoss();
  if (ids.length) {
    // These directly executed fixtures must not leave orphan queue jobs that
    // delay another file's actual worker-recovery assertion.
    await getDatabase().execute(sql`DELETE FROM pgboss.job WHERE name = ${RUN_COUNCIL_QUEUE}
      AND data->>'runId' IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    await getDatabase().delete(runs).where(inArray(runs.id, ids));
  }
  for (const id of connections) await deleteProviderConnection(id);
  await closeDatabase();
});

test("freezes full source without changing it, deduplicates an intent, survives source retention and includes prior continuation", async () => {
  const { run, context } = await source();
  const original = await findDurableRunById(run.runId);
  const request = { ...input(), question: "Bu incelemeye göre alternatifler hangi koşullarda değişir?", continuationSource: pointer(context) };
  const copies = await Promise.all([queue(request), queue(request)]);
  expect(copies[0]!.runId).toBe(copies[1]!.runId);
  const child = copies[0]!;
  expect(child.snapshotId).not.toBe(run.snapshotId);
  expect(child.continuationContext).toEqual(context);
  expect(JSON.parse(context.content).report).toEqual(original!.report);
  expect(await findDurableRunById(run.runId)).toEqual(original);
  const [stored] = await getDatabase().select().from(runs).where(eq(runs.id, child.runId));
  expect(stored!.continuationContextCiphertext).not.toContain(context.content);
  await getDatabase().update(runs).set({ finishedAt: new Date("2020-01-01") }).where(eq(runs.id, run.runId));
  expect((await pruneExpiredRuns({ retentionDays: 1, apply: true, onlyRunIds: [run.runId] })).count).toBe(1);
  let observed = false;
  const result = await executeDurableRun(child.runId, async (work) => {
    observed = true;
    expect(work.continuationContext).toEqual(context);
    expect(work.reusedInitialResults).toEqual([]);
    const plan = buildRoundZeroPromptPlan({ ...work, images: [], documents: [] });
    expect(plan.fingerprint).toBe(child.promptFingerprint);
    return executeFakeCouncil({ snapshotId: work.snapshotId, question: work.question, continuationContext: work.continuationContext }, "success", work.members, work.reviewRounds);
  });
  expect(observed).toBe(true);
  expect(result!.status).toBe("completed");
  const nextContext = await loadRunContinuation(child.runId);
  expect(JSON.parse(nextContext.content).continuationContext).toEqual(context);
  // Successful retry replays the child even after the source has gone.
  expect((await enqueueDurableRun(request)).runId).toBe(child.runId);
  await expect(enqueueDurableRun({ ...request, continuationSource: { ...request.continuationSource, expectedSha256: "a".repeat(64) } })).rejects.toBeInstanceOf(IdempotencyConflictError);
});

test("rejects source report drift before any child is queued", async () => {
  const { run, context } = await source();
  const original = (await findDurableRunById(run.runId))!;
  const claim = original.report!.sharedClaims[0] ?? original.report!.distinctClaims[0]!;
  await updateDurableClaimSynthesisCoverage(run.runId, claim.claimId, "omitted");
  const request = { ...input(), continuationSource: pointer(context) };
  await expect(enqueueDurableRun(request)).rejects.toBeInstanceOf(PreflightMismatchError);
  expect(await getDatabase().select().from(runs).where(eq(runs.idempotencyKey, request.idempotencyKey))).toHaveLength(0);
  expect((await loadRunContinuation(run.runId)).sha256).not.toBe(context.sha256);
});

test("rejects missing, foreign, unfinished and oversized history without truncation", async () => {
  await expect(loadRunContinuation(randomUUID())).rejects.toBeInstanceOf(ContinuationUnavailableError);
  const pending = await queue();
  await expect(loadRunContinuation(pending.runId)).rejects.toBeInstanceOf(ContinuationUnavailableError);
  const { run } = await source();
  await getDatabase().update(runs).set({ ownerId: "another-owner" }).where(eq(runs.id, run.runId));
  await expect(loadRunContinuation(run.runId)).rejects.toBeInstanceOf(ContinuationUnavailableError);
  await getDatabase().update(runs).set({ ownerId: LOCAL_OWNER_ID }).where(eq(runs.id, run.runId));
  const record = (await findDurableRunById(run.runId))!;
  const large = { ...record.report!, qualityNotice: "ç".repeat(150_000) };
  await getDatabase().update(runs).set({ reportCiphertext: encryptJson(large, `run:${run.runId}:report`) }).where(eq(runs.id, run.runId));
  await expect(loadRunContinuation(run.runId)).rejects.toThrow("256 KiB");
});

test("preserves high source risk and historical risk controls through the same preflight", async () => {
  const { run, context } = await source();
  const record = (await findDurableRunById(run.runId))!;
  const risky = { ...record.report!, qualityNotice: "Historical insulin dosage needs review" };
  await getDatabase().update(runs).set({ reportCiphertext: encryptJson(risky, `run:${run.runId}:report`) }).where(eq(runs.id, run.runId));
  const current = await loadRunContinuation(run.runId);
  await expect(enqueueDurableRun({ ...input(), continuationSource: pointer(current) })).rejects.toBeInstanceOf(RiskConfigurationError);
  await getDatabase().update(runs).set({ reportCiphertext: encryptJson(record.report, `run:${run.runId}:report`), riskProfile: "high" }).where(eq(runs.id, run.runId));
  const high = await loadRunContinuation(run.runId);
  expect(high.sha256).not.toBe(context.sha256);
  await expect(enqueueDurableRun({ ...input(), continuationSource: pointer(high) })).rejects.toBeInstanceOf(RiskConfigurationError);
});

test("keeps history in clarification drafts and refuses drift or deletion on resume", async () => {
  const { run, context } = await source();
  const draftInput = { ...input(), question: "İlaç dozunu artırmalı mıyım?", continuationSource: pointer(context), members: defaultFakeCouncilMembers.map((member, index) => ({ ...member, councilRole: index === 1 ? "red-team" as const : "analyst" as const })) };
  const draft = await createAwaitingPreflightDraft(draftInput);
  const prepared = await preparePreflightDraft(draft.id, "original");
  expect(prepared.continuationContext).toEqual(context);
  const child = await startPreflightDraft({ id: draft.id, choice: "original", expectedPromptFingerprint: prepared.promptPlan.fingerprint, expectedRiskFingerprint: prepared.riskPreflight.fingerprint });
  ids.push(child.runId);
  expect(child.continuationContext).toEqual(context);
  const second = await createAwaitingPreflightDraft({ ...draftInput, idempotencyKey: randomUUID() });
  await getDatabase().delete(runs).where(eq(runs.id, run.runId));
  await expect(preparePreflightDraft(second.id, "original")).rejects.toBeInstanceOf(ContinuationUnavailableError);
});

test("fences a changed frozen history before dispatch", async () => {
  const { context } = await source();
  const child = await queue({ ...input(), continuationSource: pointer(context) });
  const changed = freezeContinuation({ sourceRunId: context.sourceRunId, sourceRiskProfile: "standard", content: "changed after preview" });
  await getDatabase().update(runs).set({ continuationContextCiphertext: encryptJson(changed, `run:${child.runId}:continuation-context`) }).where(eq(runs.id, child.runId));
  let dispatches = 0;
  const result = await executeDurableRun(child.runId, async () => { dispatches += 1; throw new Error("Must not dispatch"); });
  expect(dispatches).toBe(0);
  expect(result!.status).toBe("failed");
  expect(result!.report!.failures[0]!.code).toBe("prompt_snapshot_mismatch");
});

test("inherits frozen history when a continuation member is rerun", async () => {
  const { context } = await source();
  const connection = await saveProviderConnection({ provider: "openai-compatible", label: `Offline ${randomUUID()}`, apiKey: "", defaultModel: "offline", baseUrl: "http://127.0.0.1:11434/v1", endpointPreset: "ollama", reasoningProtocol: "none", structuredOutputMode: "json-object" });
  connections.push(connection.id);
  const members = defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible" as const, model: "offline", connectionId: connection.id }));
  const child = await queue({ ...input(), providerMode: "remote", members, reviewRounds: 0, continuationSource: pointer(context) });
  await executeDurableRun(child.runId, async (work) => executeCouncil({ snapshotId: work.snapshotId, question: work.question, continuationContext: work.continuationContext }, work.members.map((member, index) => new FakeProvider({ ...member, perspective: index === 0 ? "procedural" : "risk", delayMs: 1 })), work.reviewRounds, work.members));
  const rerun = await enqueueSelectedMemberRerun({ sourceRunId: child.runId, memberId: members[0]!.id, idempotencyKey: randomUUID() });
  ids.push(rerun.runId);
  expect(rerun.continuationContext).toEqual(context);
  expect(rerun.promptFingerprint).toBe(child.promptFingerprint);
  const links = await getDatabase().select().from(conversationRuns).where(inArray(conversationRuns.runId, [context.sourceRunId, child.runId, rerun.runId]));
  expect(links).toHaveLength(3);
  expect(new Set(links.map((item) => item.conversationId)).size).toBe(1);
  expect(links.find((item) => item.runId === rerun.runId)?.sourceRunId).toBe(child.runId);
});

test("compacts oversized history, preserves encrypted omissions after retention and never sends private archives to descendants", async () => {
  const { run } = await source();
  const original = (await findDurableRunById(run.runId))!;
  const report = { ...original.report!, qualityNotice: "PRIVATE_OMITTED_MINORITY ".repeat(14_000) };
  await getDatabase().update(runs).set({ reportCiphertext: encryptJson(report, `run:${run.runId}:report`) }).where(eq(runs.id, run.runId));
  await expect(loadRunContinuation(run.runId)).rejects.toThrow("256 KiB");
  const request = await compactRequest(run.runId);
  const copies = await Promise.all([queue(request), queue(request)]);
  const child = copies[0]!;
  expect(copies[1]!.runId).toBe(child.runId);
  expect(child.continuationContext!.version).toBe("run-continuation-v2");
  expect(child.continuationArchive!.packet.originalContent).toContain("PRIVATE_OMITTED_MINORITY");
  expect(child.continuationContext!.content).not.toContain("PRIVATE_OMITTED_MINORITY");
  const [stored] = await getDatabase().select().from(runs).where(eq(runs.id, child.runId));
  expect(stored!.continuationArchiveCiphertext).not.toContain("PRIVATE_OMITTED_MINORITY");
  await getDatabase().update(runs).set({ finishedAt: new Date("2020-01-01") }).where(eq(runs.id, run.runId));
  expect((await pruneExpiredRuns({ retentionDays: 1, apply: true, onlyRunIds: [run.runId] })).count).toBe(1);
  const done = await executeDurableRun(child.runId, async (work) => {
    expect(work).not.toHaveProperty("continuationArchive");
    expect(JSON.stringify(work)).not.toContain("PRIVATE_OMITTED_MINORITY");
    return executeFakeCouncil({ snapshotId: work.snapshotId, question: work.question, continuationContext: work.continuationContext }, "success", work.members, work.reviewRounds);
  });
  expect(done!.status).toBe("completed");
  expect(done!.continuationArchive).toEqual(child.continuationArchive);
  expect((await enqueueDurableRun(request)).runId).toBe(child.runId);
  const full = await loadRunContinuation(child.runId);
  expect(full.content).not.toContain("PRIVATE_OMITTED_MINORITY");
  const grandchild = await queue({ ...input(), continuationSource: pointer(full) });
  expect(grandchild.continuationArchive).toEqual(child.continuationArchive);
  expect((await executeDurableRun(grandchild.runId))!.status).toBe("completed");
  const nextPacket = await loadRunContinuationCompaction(child.runId);
  expect(nextPacket.omissions.map((item) => item.section)).toContain("earlier-archive");
  expect(nextPacket.originalContent).toContain("PRIVATE_OMITTED_MINORITY");
  const next = buildCompactedContinuation(nextPacket, compactChoice);
  expect(next.context.content).not.toContain("PRIVATE_OMITTED_MINORITY");
});

test("binds compaction previews, summary edits and source edits before queueing", async () => {
  const { run } = await source();
  const request = await compactRequest(run.runId);
  const context = await loadRunContinuation(run.runId, request.continuationSource.expectedSha256, compactChoice);
  const plan = buildRoundZeroPromptPlan({ question: request.question, members: defaultFakeCouncilMembers, continuationContext: context, memoryContext: [], toolContext: [], images: [], documents: [] });
  await expect(enqueueDurableRun({ ...request, expectedPreflightFingerprint: plan.fingerprint,
    continuationSource: { ...request.continuationSource, compaction: { ...compactChoice, summary: "A newly edited owner summary requires another preview." } } })).rejects.toBeInstanceOf(PreflightMismatchError);
  const original = (await findDurableRunById(run.runId))!;
  const claim = original.report!.sharedClaims[0] ?? original.report!.distinctClaims[0]!;
  await updateDurableClaimSynthesisCoverage(run.runId, claim.claimId, "omitted");
  await expect(enqueueDurableRun(request)).rejects.toBeInstanceOf(PreflightMismatchError);
  expect(await getDatabase().select().from(runs).where(eq(runs.idempotencyKey, request.idempotencyKey))).toHaveLength(0);
});

test("keeps original risk when a manual summary drops risky details and refuses excessive/foreign archival sources", async () => {
  const { run } = await source();
  const original = (await findDurableRunById(run.runId))!;
  await getDatabase().update(runs).set({ reportCiphertext: encryptJson({ ...original.report!, qualityNotice: "Insulin dosage requires context" }, `run:${run.runId}:report`) }).where(eq(runs.id, run.runId));
  const request = await compactRequest(run.runId);
  await expect(enqueueDurableRun(request)).rejects.toBeInstanceOf(RiskConfigurationError);
  await getDatabase().update(runs).set({ ownerId: "another-owner" }).where(eq(runs.id, run.runId));
  await expect(loadRunContinuationCompaction(run.runId)).rejects.toBeInstanceOf(ContinuationUnavailableError);
  await getDatabase().update(runs).set({ ownerId: LOCAL_OWNER_ID, reportCiphertext: encryptJson({ ...original.report!, qualityNotice: "ç".repeat(1_100_000) }, `run:${run.runId}:report`) }).where(eq(runs.id, run.runId));
  await expect(loadRunContinuationCompaction(run.runId)).rejects.toThrow("2 MiB");
});

test("rejects an archival substitution before provider dispatch", async () => {
  const { run } = await source();
  const child = await queue(await compactRequest(run.runId));
  const changed = { ...child.continuationArchive!, selection: { ...compactChoice, summary: "Another summary that was never sent or reviewed." } };
  await getDatabase().update(runs).set({ continuationArchiveCiphertext: encryptJson(changed, `run:${child.runId}:continuation-archive`) }).where(eq(runs.id, child.runId));
  let calls = 0;
  await expect(executeDurableRun(child.runId, async () => { calls += 1; throw new Error("Do not dispatch"); })).rejects.toThrow("eşleşmiyor");
  expect(calls).toBe(0);
});

test("keeps summary and omissions in clarification drafts", async () => {
  const { run } = await source();
  const request = await compactRequest(run.runId);
  const draft = await createAwaitingPreflightDraft({ ...request, question: "İlaç dozunu artırmalı mıyım?",
    members: defaultFakeCouncilMembers.map((member, index) => ({ ...member, councilRole: index === 1 ? "red-team" as const : "analyst" as const })) });
  const prepared = await preparePreflightDraft(draft.id, "original");
  expect(prepared.continuationContext!.version).toBe("run-continuation-v2");
  const child = await startPreflightDraft({ id: draft.id, choice: "original", expectedPromptFingerprint: prepared.promptPlan.fingerprint, expectedRiskFingerprint: prepared.riskPreflight.fingerprint });
  ids.push(child.runId);
  expect(child.continuationArchive!.selection).toEqual(compactChoice);
  expect(child.continuationContext).toEqual(prepared.continuationContext);
});

test("preserves the private archive when a compacted member is rerun", async () => {
  const { run } = await source();
  const connection = await saveProviderConnection({ provider: "openai-compatible", label: `Offline compact ${randomUUID()}`, apiKey: "", defaultModel: "offline", baseUrl: "http://127.0.0.1:11434/v1", endpointPreset: "ollama", reasoningProtocol: "none", structuredOutputMode: "json-object" });
  connections.push(connection.id);
  const members = defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible" as const, model: "offline", connectionId: connection.id }));
  const child = await queue({ ...await compactRequest(run.runId), providerMode: "remote", members, reviewRounds: 0 });
  await executeDurableRun(child.runId, async (work) => executeCouncil({ snapshotId: work.snapshotId, question: work.question, continuationContext: work.continuationContext }, work.members.map((member, index) => new FakeProvider({ ...member, perspective: index === 0 ? "procedural" : "risk", delayMs: 1 })), work.reviewRounds, work.members));
  const rerun = await enqueueSelectedMemberRerun({ sourceRunId: child.runId, memberId: members[0]!.id, idempotencyKey: randomUUID() });
  ids.push(rerun.runId);
  expect(rerun.continuationArchive).toEqual(child.continuationArchive);
  expect(rerun.promptFingerprint).toBe(child.promptFingerprint);
});
