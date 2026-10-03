import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { createRunRequestSchema, defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { IdempotencyConflictError } from "@deliberation-ai/application";
import { getDatabase, closeDatabase } from "./database";
import { closeBoss } from "./queue";
import { preflightDrafts, runs, conversationRuns, conversations } from "./schema";
import { createAwaitingPreflightDraft, preparePreflightDraft, startPreflightDraft, findPreflightDraft } from "./preflight-drafts";
import { deletePreflightDraftContent, previewPreflightDraftDeletion, PreflightDraftDeletionBlockedError, PreflightDraftDeletionStaleError, readPreflightDraftDeletion } from "./preflight-draft-deletion";
import { enqueueDurableRun, findDurableRunById } from "./run-repository";
import { auditRestoredEncryption } from "../scripts/backup-encryption-audit";
import { cancelPreflightDraft } from "./preflight-drafts";

const drafts: string[] = []; const runIds: string[] = [];
afterEach(async () => {
  if (drafts.length) await getDatabase().delete(preflightDrafts).where(inArray(preflightDrafts.id, drafts));
  if (runIds.length) {
    const memberships = await getDatabase().select().from(conversationRuns).where(inArray(conversationRuns.runId, runIds));
    await getDatabase().execute(sql`delete from pgboss.job where name='run-fake-council' and data->>'runId' in (${sql.join(runIds.map((id) => sql`${id}`), sql`,`)})`);
    await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.runId, runIds));
    if (memberships.length) await getDatabase().delete(conversations).where(inArray(conversations.id, memberships.map((row) => row.conversationId)));
    await getDatabase().delete(runs).where(inArray(runs.id, runIds));
  }
  drafts.length = 0; runIds.length = 0;
});
afterAll(async () => { await closeBoss(); await closeDatabase(); });
async function fixture() {
  const input = createRunRequestSchema.parse({ idempotencyKey: randomUUID(), question: "Bu sözleşmeyi feshetmeli miyim?",
    providerMode: "fake", scenario: "success", riskProfile: "high", reviewRounds: 1,
    members: [defaultFakeCouncilMembers[0]!, { ...defaultFakeCouncilMembers[1]!, councilRole: "red-team" }] });
  const draft = await createAwaitingPreflightDraft(input); drafts.push(draft.id);
  return { input, draft };
}

test("review is read-only; deletion scrubs content and preserves an idempotent, content-free tombstone", async () => {
  const { input, draft } = await fixture();
  const before = await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, draft.id));
  const preview = (await previewPreflightDraftDeletion(draft.id))!;
  expect(preview).toMatchObject({ eligible: true, hasQuestion: true, hasRequest: true, retainedRunId: null });
  expect(await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, draft.id))).toEqual(before);
  const receipt = await deletePreflightDraftContent(draft.id, preview.fingerprint!);
  expect(await deletePreflightDraftContent(draft.id, preview.fingerprint!)).toEqual(receipt);
  await expect(deletePreflightDraftContent(draft.id, "a".repeat(64))).rejects.toBeInstanceOf(PreflightDraftDeletionStaleError);
  const [row] = await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, draft.id));
  expect(row).toMatchObject({ status: "cancelled", questionCiphertext: null, requestCiphertext: null, idempotencyKey: input.idempotencyKey });
  expect(readPreflightDraftDeletion(row!)).toEqual(receipt);
  expect(JSON.stringify(row!.questions)).not.toContain(input.question);
  expect(await findPreflightDraft(draft.id)).toBeUndefined();
  await expect(createAwaitingPreflightDraft(input)).rejects.toBeInstanceOf(IdempotencyConflictError);
  await expect(preparePreflightDraft(draft.id, "original")).rejects.toThrow();
  // A changed question cannot bypass the tombstone through the ordinary run path.
  await expect(enqueueDurableRun({ ...input, question: "Generated general comparison question" })).rejects.toBeInstanceOf(IdempotencyConflictError);
  expect(await getDatabase().select().from(runs).where(eq(runs.idempotencyKey, input.idempotencyKey))).toHaveLength(0);
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { expect((await auditRestoredEncryption(client)).rows).toBeGreaterThan(0); } finally { await client.end(); }
});

test("stale exact-timestamp snapshots and ownership mismatches cannot remove payload", async () => {
  const { draft } = await fixture(); const preview = (await previewPreflightDraftDeletion(draft.id))!;
  await getDatabase().execute(sql`update preflight_drafts set updated_at=updated_at+interval '1 microsecond' where id=${draft.id}::uuid`);
  await expect(deletePreflightDraftContent(draft.id, preview.fingerprint!)).rejects.toBeInstanceOf(PreflightDraftDeletionStaleError);
  const [row] = await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, draft.id));
  expect(row!.requestCiphertext).not.toBeNull();
  await getDatabase().update(preflightDrafts).set({ ownerId: "generated-foreign-owner" }).where(eq(preflightDrafts.id, draft.id));
  expect(await previewPreflightDraftDeletion(draft.id)).toBeUndefined();
  expect(await deletePreflightDraftContent(draft.id, preview.fingerprint!)).toBeUndefined();
  expect((await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, draft.id)))[0]!.requestCiphertext).toBe(row!.requestCiphertext);
});

test("column, trigger and foreign-key drift fail closed", async () => {
  const { draft } = await fixture();
  await getDatabase().execute(sql`alter table preflight_drafts add column generated_unknown text`);
  try { expect((await previewPreflightDraftDeletion(draft.id))!.blockedReasons).toContain("schema_changed"); }
  finally { await getDatabase().execute(sql`alter table preflight_drafts drop column generated_unknown`); }
  await getDatabase().execute(sql`create function generated_preflight_trigger() returns trigger language plpgsql as 'begin return NEW; end;'`);
  await getDatabase().execute(sql`create trigger generated_preflight_trigger before update on preflight_drafts for each row execute function generated_preflight_trigger()`);
  try { expect((await previewPreflightDraftDeletion(draft.id))!.blockedReasons).toContain("schema_changed"); }
  finally { await getDatabase().execute(sql`drop trigger generated_preflight_trigger on preflight_drafts`); await getDatabase().execute(sql`drop function generated_preflight_trigger()`); }
  await getDatabase().execute(sql`create table generated_preflight_reference(id uuid references preflight_drafts(id))`);
  try {
    expect((await previewPreflightDraftDeletion(draft.id))!.blockedReasons).toContain("schema_changed");
    await expect(deletePreflightDraftContent(draft.id, "a".repeat(64))).rejects.toBeInstanceOf(PreflightDraftDeletionBlockedError);
  } finally { await getDatabase().execute(sql`drop table generated_preflight_reference`); }
});

test("a start racing deletion either wins with a stale review or is prevented without enqueue", async () => {
  const { input, draft } = await fixture();
  const prepared = await preparePreflightDraft(draft.id, "original");
  const review = (await previewPreflightDraftDeletion(draft.id))!;
  const [start, deletion] = await Promise.allSettled([
    startPreflightDraft({ id: draft.id, choice: "original", expectedPromptFingerprint: prepared.promptPlan.fingerprint, expectedRiskFingerprint: prepared.riskPreflight.fingerprint }),
    deletePreflightDraftContent(draft.id, review.fingerprint!),
  ]);
  expect([start.status, deletion.status].filter((value) => value === "fulfilled")).toHaveLength(1);
  if (start.status === "fulfilled") {
    runIds.push(start.value.runId);
    expect(deletion.status === "rejected" && deletion.reason).toBeInstanceOf(PreflightDraftDeletionStaleError);
    const newReview = (await previewPreflightDraftDeletion(draft.id))!;
    expect(newReview.retainedRunId).toBe(start.value.runId);
    const receipt = await deletePreflightDraftContent(draft.id, newReview.fingerprint!);
    expect(receipt?.previousStatus).toBe("started");
    expect(await findDurableRunById(start.value.runId)).toBeDefined();
    await expect(startPreflightDraft({ id: draft.id, choice: "original", expectedPromptFingerprint: prepared.promptPlan.fingerprint, expectedRiskFingerprint: prepared.riskPreflight.fingerprint })).rejects.toThrow();
  } else {
    expect(await getDatabase().select().from(runs).where(eq(runs.idempotencyKey, input.idempotencyKey))).toHaveLength(0);
  }
});

test("parallel delete confirmations converge and concurrent create retries cannot restore payload", async () => {
  const { input, draft } = await fixture(); const review = (await previewPreflightDraftDeletion(draft.id))!;
  const results = await Promise.allSettled([deletePreflightDraftContent(draft.id, review.fingerprint!), deletePreflightDraftContent(draft.id, review.fingerprint!), createAwaitingPreflightDraft(input)]);
  expect(results[0].status).toBe("fulfilled"); expect(results[1].status).toBe("fulfilled");
  if (results[0].status === "fulfilled" && results[1].status === "fulfilled") expect(results[0].value).toEqual(results[1].value);
  expect((await getDatabase().select().from(preflightDrafts).where(eq(preflightDrafts.id, draft.id)))[0]!.requestCiphertext).toBeNull();
});

test("started and legacy-cancelled draft stubs can be reviewed without deleting a linked run", async () => {
  const { draft } = await fixture(); const prepared = await preparePreflightDraft(draft.id, "original");
  const run = await startPreflightDraft({ id: draft.id, choice: "original", expectedPromptFingerprint: prepared.promptPlan.fingerprint,
    expectedRiskFingerprint: prepared.riskPreflight.fingerprint }); runIds.push(run.runId);
  const before = await findDurableRunById(run.runId);
  const review = (await previewPreflightDraftDeletion(draft.id))!;
  expect(review).toMatchObject({ status: "started", hasRequest: false, hasQuestion: false, retainedRunId: run.runId, eligible: true });
  await deletePreflightDraftContent(draft.id, review.fingerprint!);
  expect(await findDurableRunById(run.runId)).toEqual(before);
  expect((await previewPreflightDraftDeletion(draft.id))!.alreadyDeleted).toBe(true);
  const other = await fixture(); expect(await cancelPreflightDraft(other.draft.id)).toBe(true);
  const cancelledReview = (await previewPreflightDraftDeletion(other.draft.id))!;
  expect(cancelledReview.hasRequest).toBe(false);
  expect((await deletePreflightDraftContent(other.draft.id, cancelledReview.fingerprint!))!.previousStatus).toBe("cancelled");
});

test("oversize records are not read for confirmation and malformed receipts fail restored metadata validation", async () => {
  const { draft } = await fixture();
  await getDatabase().update(preflightDrafts).set({ requestCiphertext: "x".repeat(24 * 1024 * 1024) }).where(eq(preflightDrafts.id, draft.id));
  await expect(previewPreflightDraftDeletion(draft.id)).rejects.toBeInstanceOf(PreflightDraftDeletionBlockedError);
  const other = await fixture(); const review = (await previewPreflightDraftDeletion(other.draft.id))!;
  const receipt = (await deletePreflightDraftContent(other.draft.id, review.fingerprint!))!;
  await getDatabase().update(preflightDrafts).set({ questions: { ...receipt, question: "Unregistered private text must not enter a receipt" } }).where(eq(preflightDrafts.id, other.draft.id));
  await expect(previewPreflightDraftDeletion(other.draft.id)).rejects.toThrow();
  await getDatabase().delete(preflightDrafts).where(eq(preflightDrafts.id, draft.id));
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { await expect(auditRestoredEncryption(client)).rejects.toThrow("Restored preflight deletion metadata is invalid"); }
  finally { await client.end(); }
});

 test("a deleted started draft blocks the existing-run retry fast path", async () => {
  const { input, draft } = await fixture();
  const prepared = await preparePreflightDraft(draft.id, "original");
  const revised = createRunRequestSchema.parse({ ...input, question: prepared.question,
    expectedPreflightFingerprint: prepared.promptPlan.fingerprint, expectedRiskFingerprint: prepared.riskPreflight.fingerprint,
    preflightDecision: { draftId: draft.id, choice: "original" }, promptRevision: prepared.promptRevision });
  const run = await enqueueDurableRun(revised); runIds.push(run.runId);
  expect((await enqueueDurableRun(revised)).runId).toBe(run.runId);
  const preview = (await previewPreflightDraftDeletion(draft.id))!;
  await deletePreflightDraftContent(draft.id, preview.fingerprint!);
  await expect(enqueueDurableRun(revised)).rejects.toBeInstanceOf(IdempotencyConflictError);
  expect(await findDurableRunById(run.runId)).toBeDefined();
});
