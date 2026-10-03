import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { createRunRequestSchema, defaultFakeCouncilMembers, type CreateRunRequest } from "@deliberation-ai/contracts";
import { IdempotencyConflictError } from "@deliberation-ai/application";
import { getDatabase, closeDatabase } from "./database";
import { encryptJson, encryptText } from "./crypto";
import { closeBoss } from "./queue";
import * as s from "./schema";
import { LOCAL_OWNER_ID } from "./owner";
import { enqueueDurableRun, executeDurableRun, findDurableRunById, loadRunContinuation } from "./run-repository";
import { deleteRunBody, loadRunDeletion, previewRunDeletion, RunDeletionBlockedError, RunDeletionStaleError } from "./run-deletion";
import { exportConversation } from "./conversations";
import { previewConversationDeletion, deleteEmptyConversation } from "./conversation-deletion";
import { previewPrivateBranchSeed, createPrivateBranch } from "./private-branches";
import { deletePrivateBranch, previewPrivateBranchDeletion } from "./private-branch-deletion";

const ids: string[] = []; const conversations: string[] = []; const retained: string[] = [];
afterEach(async () => {
  if (ids.length) {
    await getDatabase().execute(sql`delete from pgboss.job where name='run-fake-council' and data->>'runId' in (${sql.join(ids.map((id) => sql`${id}`), sql`,`)})`);
    await getDatabase().delete(s.conversationPrivateBranches).where(inArray(s.conversationPrivateBranches.sourceRunId, ids));
  }
  if (conversations.length) {
    await getDatabase().delete(s.privateBranchDeletions).where(inArray(s.privateBranchDeletions.conversationId, conversations));
    await getDatabase().delete(s.runDeletions).where(inArray(s.runDeletions.conversationId, conversations));
    await getDatabase().delete(s.conversationRuns).where(inArray(s.conversationRuns.conversationId, conversations));
    await getDatabase().delete(s.conversations).where(inArray(s.conversations.id, conversations));
  }
  if (retained.length) {
    await getDatabase().delete(s.providerBillingRecords).where(inArray(s.providerBillingRecords.id, retained));
    await getDatabase().delete(s.preflightDrafts).where(inArray(s.preflightDrafts.id, retained));
    await getDatabase().delete(s.localSchedules).where(inArray(s.localSchedules.id, retained));
  }
  if (ids.length) await getDatabase().delete(s.runs).where(inArray(s.runs.id, ids));
  if (retained.length) await getDatabase().delete(s.decisionConnections).where(inArray(s.decisionConnections.id, retained));
  ids.length = 0; conversations.length = 0; retained.length = 0;
});
afterAll(async () => { await closeBoss(); await closeDatabase(); });
async function fixture(extra: Partial<CreateRunRequest> = {}) {
  const input = createRunRequestSchema.parse({ idempotencyKey: randomUUID(), question: "Generated deletion fixture question", scenario: "success",
    providerMode: "fake", members: defaultFakeCouncilMembers, ...extra });
  const run = await enqueueDurableRun(input); ids.push(run.runId);
  await executeDurableRun(run.runId);
  const [member] = await getDatabase().select().from(s.conversationRuns).where(eq(s.conversationRuns.runId, run.runId));
  if (!conversations.includes(member!.conversationId)) conversations.push(member!.conversationId);
  return { id: run.runId, conversationId: member!.conversationId, input };
}
async function receipt(id: string) {
  const op = randomUUID();
  await getDatabase().insert(s.providerOperations).values({ id: op, runId: id, memberId: defaultFakeCouncilMembers[0]!.id,
    provider: "fake", model: "offline-model", status: "succeeded", requestFingerprint: "fixture-request",
    inputTokens: 20, outputTokens: 0, rawTextCiphertext: encryptText("Deleted provider reply text", `provider-operation:${op}:raw`),
    resultMetadataCiphertext: encryptJson({ tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "inclusive", cachedInputTokens: 4 } }, `provider-operation:${op}:metadata`), finishedAt: new Date() });
  return op;
}
test("reviewed run deletion removes the known content closure, preserves usage/membership/billing and replays one tombstone", async () => {
  const f = await fixture(); const op = await receipt(f.id);
  const bill = randomUUID(); const preflight = randomUUID(); const schedule = randomUUID(); retained.push(bill, preflight, schedule);
  const [claim] = await getDatabase().select().from(s.claims).where(eq(s.claims.runId, f.id));
  const memory = randomUUID(); const evidence = randomUUID(); const capture = randomUUID();
  await getDatabase().insert(s.memoryEntries).values({ id: memory, ownerId: LOCAL_OWNER_ID, sourceRunId: f.id,
    sourceClaimId: claim!.reportClaimId!, sourceType: "analyst-claim", evidenceState: "unsupported", contentCiphertext: encryptText("Generated source memory", `memory-entry:${memory}:content`) });
  await getDatabase().insert(s.evidenceSources).values({ id: evidence, ownerId: LOCAL_OWNER_ID, runId: f.id, claimId: claim!.id,
    reportClaimId: claim!.reportClaimId!, relation: "context", titleCiphertext: encryptText("Generated evidence", `evidence-source:${evidence}:title`),
    urlCiphertext: encryptText("https://example.invalid/fixture", `evidence-source:${evidence}:url`), noteCiphertext: encryptText("", `evidence-source:${evidence}:note`) });
  await getDatabase().insert(s.researchCaptures).values({ id: capture, ownerId: LOCAL_OWNER_ID, runId: f.id, claimId: claim!.id,
    reportClaimId: claim!.reportClaimId!, evidenceSourceId: evidence, requestedUrlCiphertext: encryptText("https://example.invalid/fixture", `research-capture:${capture}:requested-url`),
    finalUrlCiphertext: encryptText("https://example.invalid/fixture", `research-capture:${capture}:final-url`), titleCiphertext: encryptText("Generated capture", `research-capture:${capture}:title`),
    contentCiphertext: encryptText("Generated capture content", `research-capture:${capture}:content`), contentType: "text/plain", byteLength: 25, contentSha256: "a".repeat(64) });
  await getDatabase().insert(s.localSchedules).values({ id: schedule, ownerId: LOCAL_OWNER_ID,
    nameCiphertext: encryptText("Retained paused fixture schedule", `local-schedule:${schedule}:name`),
    questionCiphertext: encryptText("Retained schedule question", `local-schedule:${schedule}:question`),
    membersCiphertext: encryptJson(defaultFakeCouncilMembers, `local-schedule:${schedule}:members`), providerMode: "fake", cadence: "daily", nextRunAt: new Date("2400-01-01"), lastRunId: f.id });
  await getDatabase().insert(s.providerBillingRecords).values({ id: bill, ownerId: LOCAL_OWNER_ID, runId: f.id, operationId: op,
    sourceLineFingerprint: "fixture-line", remoteIdentityFingerprint: "fixture-identity", fingerprint: randomUUID(), payloadCiphertext: encryptJson({ note: "Separate retained billing evidence" }, `provider-billing:${bill}:payload`) });
  await getDatabase().insert(s.preflightDrafts).values({ id: preflight, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "fixture-preflight",
    questions: [], status: "started", runId: f.id, questionCiphertext: encryptText("Separate retained preflight question", `preflight-draft:${preflight}:question`) });
  const first = (await previewRunDeletion(f.id))!;
  expect(first).toMatchObject({ eligible: true, receiptCount: 1, retainedBillingCount: 1, retainedPreflightCount: 1, retainedScheduleCount: 1 });
  expect(first.contentCounts.claims).toBeGreaterThan(0); expect(first.contentCounts.model_runs).toBe(4);
  expect(await loadRunDeletion(f.id)).toBeUndefined(); expect(await findDurableRunById(f.id)).toBeDefined();
  const [model] = await getDatabase().select().from(s.modelRuns).where(eq(s.modelRuns.runId, f.id));
  await getDatabase().update(s.modelRuns).set({ rawTextCiphertext: encryptText("Changed child body", `model-run:${model!.id}:raw`) }).where(eq(s.modelRuns.id, model!.id));
  await expect(deleteRunBody(f.id, first.fingerprint!)).rejects.toBeInstanceOf(RunDeletionStaleError);
  expect(await loadRunDeletion(f.id)).toBeUndefined();
  const preview = (await previewRunDeletion(f.id))!;
  const [a, b] = await Promise.all([deleteRunBody(f.id, preview.fingerprint!), deleteRunBody(f.id, preview.fingerprint!)]);
  expect(a).toEqual(b); expect(await findDurableRunById(f.id)).toBeUndefined();
  expect(a!.receipts[0]).toMatchObject({ inputTokens: 20, outputTokens: 0, tokenDetails: { cachedInputTokens: 4 } });
  expect(JSON.stringify(a)).not.toMatch(/Generated deletion fixture|Deleted provider reply|Changed child body|Separate retained/);
  expect((await getDatabase().select().from(s.providerOperations).where(eq(s.providerOperations.runId, f.id)))).toHaveLength(0);
  expect((await getDatabase().select().from(s.claims).where(eq(s.claims.runId, f.id)))).toHaveLength(0);
  expect((await getDatabase().select().from(s.modelRuns).where(eq(s.modelRuns.runId, f.id)))).toHaveLength(0);
  expect((await getDatabase().select().from(s.memoryEntries).where(eq(s.memoryEntries.id, memory)))).toHaveLength(0);
  expect((await getDatabase().select().from(s.evidenceSources).where(eq(s.evidenceSources.id, evidence)))).toHaveLength(0);
  expect((await getDatabase().select().from(s.researchCaptures).where(eq(s.researchCaptures.id, capture)))).toHaveLength(0);
  expect((await getDatabase().select().from(s.preflightDrafts).where(eq(s.preflightDrafts.id, preflight)))[0]!.runId).toBeNull();
  expect((await getDatabase().select().from(s.localSchedules).where(eq(s.localSchedules.id, schedule)))[0]!.lastRunId).toBeNull();
  expect((await getDatabase().select().from(s.providerBillingRecords).where(eq(s.providerBillingRecords.id, bill)))).toHaveLength(1);
  const exported = (await exportConversation(f.conversationId))!;
  expect(exported.runs[0]).toMatchObject({ availability: "unavailable", payload: null }); expect(exported.runDeletions).toEqual([a]);
  await expect(enqueueDurableRun(f.input)).rejects.toBeInstanceOf(IdempotencyConflictError);
  await expect(deleteRunBody(f.id, "a".repeat(64))).rejects.toBeInstanceOf(RunDeletionStaleError);
  let calls = 0; expect(await executeDurableRun(f.id, async () => { calls++; throw new Error("Must not execute"); })).toBeUndefined(); expect(calls).toBe(0);
  const metadata = (await previewConversationDeletion(f.conversationId))!; expect(metadata.eligible).toBe(true);
  await deleteEmptyConversation(f.conversationId, metadata.fingerprint!); expect(await loadRunDeletion(f.id)).toEqual(a);
});
test("run deletion blocks active and unresolved work and the live execution fence", async () => {
  const f = await fixture(); const op = await receipt(f.id);
  for (const status of ["prepared", "submitted", "outcome_unknown", "retry_authorized"]) {
    await getDatabase().update(s.providerOperations).set({ status }).where(eq(s.providerOperations.id, op));
    expect((await previewRunDeletion(f.id))!.blockedReasons).toContain("pending_operations");
    await expect(deleteRunBody(f.id, "a".repeat(64))).rejects.toBeInstanceOf(RunDeletionBlockedError);
  }
  await getDatabase().update(s.providerOperations).set({ status: "discarded" }).where(eq(s.providerOperations.id, op));
  for (const status of ["queued", "running"] as const) {
    await getDatabase().update(s.runs).set({ status }).where(eq(s.runs.id, f.id));
    expect((await previewRunDeletion(f.id))!.blockedReasons).toContain("active_run");
  }
  await getDatabase().update(s.runs).set({ status: "completed" }).where(eq(s.runs.id, f.id));
  const preview = (await previewRunDeletion(f.id))!;
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    const key = createHash("sha256").update(`deliberation-ai-run:${f.id}`).digest().readBigInt64BE(0).toString();
    await client.query("select pg_advisory_lock($1::bigint)", [key]);
    await expect(deleteRunBody(f.id, preview.fingerprint!)).rejects.toBeInstanceOf(RunDeletionBlockedError);
  } finally { await client.end(); }
  expect((await deleteRunBody(f.id, preview.fingerprint!))!.receipts[0]!.status).toBe("discarded");
});
test("run deletion requires leaf-first removal of continuation/private copies and detects detached memory provenance", async () => {
  const f = await fixture(); const context = await loadRunContinuation(f.id);
  const child = await fixture({ continuationSource: { runId: f.id, expectedSha256: context.sha256 } });
  const seed = (await previewPrivateBranchSeed(f.id, defaultFakeCouncilMembers[0]!.id))!;
  const branch = (await createPrivateBranch({ action: "create", requestId: randomUUID(), sourceRunId: f.id,
    memberId: defaultFakeCouncilMembers[0]!.id, expectedSeedSha256: seed.sha256 }))!;
  const preview = (await previewRunDeletion(f.id))!;
  expect(preview).toMatchObject({ eligible: false, copiedRunIds: [child.id], privateBranchIds: [branch.id] });
  await expect(deleteRunBody(f.id, "a".repeat(64))).rejects.toBeInstanceOf(RunDeletionBlockedError);
  await deleteRunBody(child.id, (await previewRunDeletion(child.id))!.fingerprint!);
  await deletePrivateBranch(branch.id, (await previewPrivateBranchDeletion(branch.id))!.fingerprint!);
  const peer = await fixture();
  await getDatabase().update(s.runs).set({ memoryContextCiphertext: encryptJson([{ sourceRunId: f.id, content: "Detached copied memory" }], `run:${peer.id}:memory-context`) }).where(eq(s.runs.id, peer.id));
  expect((await previewRunDeletion(f.id))!.copiedRunIds).toEqual([peer.id]);
  await deleteRunBody(peer.id, (await previewRunDeletion(peer.id))!.fingerprint!);
  expect((await deleteRunBody(f.id, (await previewRunDeletion(f.id))!.fingerprint!))!.runId).toBe(f.id);
});
test("run deletion refuses foreign targets and inconsistent cross-run content graphs", async () => {
  const f = await fixture(); const other = await fixture();
  const [claim] = await getDatabase().select().from(s.claims).where(eq(s.claims.runId, f.id));
  const [model] = await getDatabase().select().from(s.modelRuns).where(eq(s.modelRuns.runId, other.id));
  await getDatabase().insert(s.claimOccurrences).values({ claimId: claim!.id, modelRunId: model!.id, quote: "cross-run-fixture", kind: "support" });
  expect((await previewRunDeletion(f.id))!.blockedReasons).toContain("owner_mismatch");
  await getDatabase().delete(s.claimOccurrences).where(sql`${s.claimOccurrences.claimId}=${claim!.id}::uuid and ${s.claimOccurrences.modelRunId}=${model!.id}::uuid and ${s.claimOccurrences.quote}='cross-run-fixture'`);
  await getDatabase().update(s.runs).set({ ownerId: "foreign-fixture" }).where(eq(s.runs.id, other.id));
  expect(await previewRunDeletion(other.id)).toBeUndefined(); expect(await deleteRunBody(other.id, "a".repeat(64))).toBeUndefined();
  expect((await previewRunDeletion(f.id))!.eligible).toBe(true);
  await getDatabase().update(s.runs).set({ branchSourceRunId: f.id, branchKind: "continuation-full" }).where(eq(s.runs.id, other.id));
  const preview = (await previewRunDeletion(f.id))!; expect(preview.blockedReasons).toContain("owner_mismatch"); expect(preview.copiedRunIds).not.toContain(other.id);
  await expect(deleteRunBody(f.id, "a".repeat(64))).rejects.toBeInstanceOf(RunDeletionBlockedError);
});
test("run deletion fails closed on schema, unexpected cascades, deletion triggers and unreadable copied context", async () => {
  const f = await fixture();
  const blocked = async () => { expect((await previewRunDeletion(f.id))!.blockedReasons).toContain("schema_changed");
    await expect(deleteRunBody(f.id, "a".repeat(64))).rejects.toBeInstanceOf(RunDeletionBlockedError); expect(await loadRunDeletion(f.id)).toBeUndefined(); };
  await getDatabase().execute(sql`alter table model_runs add column fixture_unreviewed text`);
  try { await blocked(); } finally { await getDatabase().execute(sql`alter table model_runs drop column fixture_unreviewed`); }
  await getDatabase().execute(sql`create table fixture_run_dependency (run_id uuid references runs(id) on delete cascade)`);
  try { await blocked(); } finally { await getDatabase().execute(sql`drop table fixture_run_dependency`); }
  await getDatabase().execute(sql`create function fixture_run_trigger() returns trigger language plpgsql as $$ begin return old; end $$`);
  await getDatabase().execute(sql`create trigger fixture_delete before delete on claims for each row execute function fixture_run_trigger()`);
  try { await blocked(); } finally { await getDatabase().execute(sql`drop trigger fixture_delete on claims`); await getDatabase().execute(sql`drop function fixture_run_trigger()`); }
  const peer = await fixture(); await getDatabase().update(s.runs).set({ memoryContextCiphertext: "unreadable-envelope" }).where(eq(s.runs.id, peer.id));
  await expect(previewRunDeletion(f.id)).rejects.toThrow(); expect(await findDurableRunById(f.id)).toBeDefined();
});
test("run deletion refuses incomplete indexing and bounded inspection overflow", async () => {
  const f = await fixture();
  await getDatabase().update(s.runs).set({ branchIndexVersion: 0, branchKind: null }).where(eq(s.runs.id, f.id));
  expect((await previewRunDeletion(f.id))!.blockedReasons).toContain("pending_index");
  await getDatabase().update(s.runs).set({ branchIndexVersion: 1, branchKind: "independent" }).where(eq(s.runs.id, f.id));
  const rows = Array.from({ length: 1_000 }, () => {
    const id = randomUUID(); ids.push(id); return { id, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "bounded-fixture",
      snapshotId: randomUUID(), question: "Generated bounded fixture", branchIndexVersion: 1, branchKind: "independent", status: "completed" as const };
  });
  await getDatabase().insert(s.runs).values(rows);
  expect((await previewRunDeletion(f.id))!.blockedReasons).toContain("inspection_limit");
  await expect(deleteRunBody(f.id, "a".repeat(64))).rejects.toBeInstanceOf(RunDeletionBlockedError);
});
test("run deletion preserves decision aggregates until their execution boundary has a reviewed fence", async () => {
  const f = await fixture(); const connection = randomUUID(); const source = randomUUID(); const assessment = randomUUID(); retained.push(connection);
  const [claim] = await getDatabase().select().from(s.claims).where(eq(s.claims.runId, f.id));
  await getDatabase().insert(s.decisionConnections).values({ id: connection, ownerId: LOCAL_OWNER_ID, label: `Generated decision ${connection}`,
    secretCiphertext: encryptText("", `decision-connection:${connection}:secret`) });
  await getDatabase().insert(s.evidenceSources).values({ id: source, ownerId: LOCAL_OWNER_ID, runId: f.id, claimId: claim!.id, reportClaimId: claim!.reportClaimId!,
    relation: "context", titleCiphertext: encryptText("Generated", `evidence-source:${source}:title`),
    urlCiphertext: encryptText("https://example.invalid/fixture", `evidence-source:${source}:url`), noteCiphertext: encryptText("", `evidence-source:${source}:note`) });
  await getDatabase().insert(s.decisionAssessments).values({ id: assessment, ownerId: LOCAL_OWNER_ID, runId: f.id, claimId: claim!.id,
    reportClaimId: claim!.reportClaimId!, sourceId: source, connectionId: connection, rubricVersion: "fixture", requestedModel: "fixture",
    runStateVersion: 1, requestFingerprint: "fixture", inputCiphertext: encryptJson({ generated: true }, `decision-assessment:${assessment}:input`), status: "completed" });
  for (const status of ["queued", "running", "outcome_unknown", "completed", "failed", "cancelled"]) {
    await getDatabase().update(s.decisionAssessments).set({ status }).where(eq(s.decisionAssessments.id, assessment));
    expect((await previewRunDeletion(f.id))!.blockedReasons).toContain("decision_boundary");
    await expect(deleteRunBody(f.id, "a".repeat(64))).rejects.toBeInstanceOf(RunDeletionBlockedError);
  }
  expect(await loadRunDeletion(f.id)).toBeUndefined(); expect(await findDurableRunById(f.id)).toBeDefined();
});
test("run deletion finds earlier source copies inside nested frozen JSON after intermediate source retention", async () => {
  const root = await fixture(); const first = await loadRunContinuation(root.id);
  const child = await fixture({ continuationSource: { runId: root.id, expectedSha256: first.sha256 } });
  const second = await loadRunContinuation(child.id);
  const grandchild = await fixture({ continuationSource: { runId: child.id, expectedSha256: second.sha256 } });
  await getDatabase().delete(s.runs).where(eq(s.runs.id, child.id)); // Generated age-retention fixture, with grouping retained.
  const preview = (await previewRunDeletion(root.id))!;
  expect(preview.copiedRunIds).toEqual([grandchild.id]); expect(preview.eligible).toBe(false);
  await expect(deleteRunBody(root.id, "a".repeat(64))).rejects.toBeInstanceOf(RunDeletionBlockedError);
  await deleteRunBody(grandchild.id, (await previewRunDeletion(grandchild.id))!.fingerprint!);
  expect((await deleteRunBody(root.id, (await previewRunDeletion(root.id))!.fingerprint!))!.runId).toBe(root.id);
});
