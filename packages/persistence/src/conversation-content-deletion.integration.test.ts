import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, expect, test } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createRunRequestSchema, defaultFakeCouncilMembers, type CreateRunRequest } from "@deliberation-ai/contracts";
import { getDatabase, closeDatabase } from "./database";
import { closeBoss } from "./queue";
import { encryptJson } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import * as s from "./schema";
import { enqueueDurableRun, executeDurableRun, findDurableRunById, loadRunContinuation } from "./run-repository";
import { previewPrivateBranchSeed, createPrivateBranch } from "./private-branches";
import { previewConversationContentDeletion, deleteConversationContent } from "./conversation-content-deletion";
import { ConversationDeletionBlockedError, ConversationDeletionStaleError } from "./conversation-deletion";
import { RunDeletionBlockedError, loadRunDeletion } from "./run-deletion";
import { resolveProviderOperation } from "./provider-operations";

const runIds: string[] = [], conversationIds: string[] = [], publications: string[] = [];
afterEach(async () => {
  if (publications.length) await getDatabase().delete(s.evidencePublications).where(inArray(s.evidencePublications.id, publications));
  if (runIds.length) await getDatabase().execute(sql`delete from pgboss.job where data->>'runId' in (${sql.join(runIds.map(id => sql`${id}`), sql`,`)})`);
  if (conversationIds.length) {
    for (const table of [s.conversationPrivateBranches, s.privateBranchDeletions, s.runDeletions, s.conversationKnowledgeSelections, s.conversationKnowledge, s.knowledgePreparations, s.conversationRuns]) {
      await getDatabase().delete(table).where(inArray(table.conversationId, conversationIds));
    }
    await getDatabase().delete(s.conversations).where(inArray(s.conversations.id, conversationIds));
  }
  if (runIds.length) await getDatabase().delete(s.runs).where(inArray(s.runs.id, runIds));
  runIds.length = 0; conversationIds.length = 0; publications.length = 0;
});
afterAll(async () => { await closeBoss(); await closeDatabase(); });
async function fixture(extra: Partial<CreateRunRequest> = {}) {
  const input = createRunRequestSchema.parse({ idempotencyKey: randomUUID(), question: "Generated single-confirmation deletion fixture", providerMode: "fake",
    scenario: "success", members: defaultFakeCouncilMembers, reviewRounds: 0, ...extra });
  const run = await enqueueDurableRun(input); runIds.push(run.runId);
  await executeDurableRun(run.runId);
  const [member] = await getDatabase().select().from(s.conversationRuns).where(eq(s.conversationRuns.runId, run.runId));
  if (!conversationIds.includes(member!.conversationId)) conversationIds.push(member!.conversationId);
  return { id: run.runId, conversationId: member!.conversationId, input };
}
async function branch(runId: string) {
  const seed = (await previewPrivateBranchSeed(runId, defaultFakeCouncilMembers[0]!.id))!;
  return (await createPrivateBranch({ action: "create", sourceRunId: runId, memberId: defaultFakeCouncilMembers[0]!.id, expectedSeedSha256: seed.sha256, requestId: randomUUID() }))!;
}
async function continuation(id: string) { return { runId: id, expectedSha256: (await loadRunContinuation(id)).sha256 }; }
test("one confirmation atomically removes internal continuations/private content and local knowledge bindings, preserving neighbor and tombstones", async () => {
  const source = await fixture();
  const child = await fixture({ continuationSource: await continuation(source.id) });
  const privateBranch = await branch(source.id); const neighbor = await fixture();
  expect(child.conversationId).toBe(source.conversationId);
  const packet = randomUUID();
  await getDatabase().insert(s.knowledgePreparations).values({ id: packet, ownerId: LOCAL_OWNER_ID, conversationId: source.conversationId,
    requestHash: "fixture", packetCiphertext: "generated-opaque-packet" });
  const preview = (await previewConversationContentDeletion(source.conversationId))!;
  expect(preview.blockedReasons).toEqual([]);
  expect(preview).toMatchObject({ eligible: true, membershipCount: 2, knowledgeRecordCount: 1, privateBranchIds: [privateBranch.id], dependencies: [] });
  expect(preview.runIds).toEqual([source.id, child.id].sort());
  expect(await previewConversationContentDeletion(source.conversationId)).toEqual(preview);
  await deleteConversationContent(source.conversationId, preview.fingerprint!);
  expect(await previewConversationContentDeletion(source.conversationId)).toBeUndefined();
  expect(await deleteConversationContent(source.conversationId, preview.fingerprint!)).toBeUndefined();
  expect(await findDurableRunById(neighbor.id)).toBeDefined();
  expect(await getDatabase().select().from(s.runDeletions).where(eq(s.runDeletions.conversationId, source.conversationId))).toHaveLength(2);
  expect(await getDatabase().select().from(s.privateBranchDeletions).where(eq(s.privateBranchDeletions.id, privateBranch.id))).toHaveLength(1);
  expect(await getDatabase().select().from(s.knowledgePreparations).where(eq(s.knowledgePreparations.id, packet))).toHaveLength(0);
  await expect(enqueueDurableRun(source.input)).rejects.toThrow();
});
test("retains independent copied runs, private branches and published evidence with visible dependencies", async () => {
  const source = await fixture(); const neighbor = await fixture();
  await getDatabase().update(s.runs).set({ memoryContextCiphertext: encryptJson([{ sourceRunId: source.id, content: "Generated retained copied memory" }],
    `run:${neighbor.id}:memory-context`) }).where(eq(s.runs.id, neighbor.id));
  const privateCopy = await branch(source.id);
  await getDatabase().update(s.conversationPrivateBranches).set({ conversationId: neighbor.conversationId }).where(eq(s.conversationPrivateBranches.id, privateCopy.id));
  // Reauthenticate the moved fixture envelope against its new conversation binding.
  const [row] = await getDatabase().select().from(s.conversationPrivateBranches).where(eq(s.conversationPrivateBranches.id, privateCopy.id));
  const { decryptJson } = await import("./crypto");
  const body = decryptJson(row!.bodyCiphertext, `private-branch:${row!.id}:body`) as Record<string, unknown>;
  (body.seed as Record<string, unknown>).conversationId = neighbor.conversationId;
  await getDatabase().update(s.conversationPrivateBranches).set({ bodyCiphertext: encryptJson(body, `private-branch:${row!.id}:body`) }).where(eq(s.conversationPrivateBranches.id, privateCopy.id));
  const publication = randomUUID(); publications.push(publication);
  await getDatabase().insert(s.evidencePublications).values({ id: publication, ownerId: LOCAL_OWNER_ID, runId: source.id, candidateId: randomUUID(),
    requestHash: "fixture", dedupHash: randomUUID(), bodyCiphertext: "independent-fixture-evidence", status: "local_saved" });
  const preview = (await previewConversationContentDeletion(source.conversationId))!;
  expect(preview.blockedReasons).toEqual([]); expect(preview.eligible).toBe(true);
  expect(preview.dependencies).toEqual(expect.arrayContaining([{ kind: "run", id: neighbor.id }, { kind: "private", id: privateCopy.id }, { kind: "publication", id: publication }]));
  await deleteConversationContent(source.conversationId, preview.fingerprint!);
  expect(await findDurableRunById(neighbor.id)).toBeDefined();
  expect(await getDatabase().select().from(s.conversationPrivateBranches).where(eq(s.conversationPrivateBranches.id, privateCopy.id))).toHaveLength(1);
  expect(await getDatabase().select().from(s.evidencePublications).where(eq(s.evidencePublications.id, publication))).toHaveLength(1);
});
test("a changed child invalidates the whole confirmation without partial deletion", async () => {
  const source = await fixture(); const child = await fixture({ continuationSource: await continuation(source.id) });
  const preview = (await previewConversationContentDeletion(source.conversationId))!;
  await getDatabase().update(s.runs).set({ finishedAt: new Date("2400-01-01") }).where(eq(s.runs.id, child.id));
  await expect(deleteConversationContent(source.conversationId, preview.fingerprint!)).rejects.toBeInstanceOf(ConversationDeletionStaleError);
  expect(await findDurableRunById(source.id)).toBeDefined(); expect(await findDurableRunById(child.id)).toBeDefined();
  expect(await getDatabase().select().from(s.runDeletions).where(eq(s.runDeletions.conversationId, source.conversationId))).toHaveLength(0);
});
test("pending/unknown and active runs block the entire aggregate", async () => {
  const source = await fixture(); const preview = (await previewConversationContentDeletion(source.conversationId))!;
  await getDatabase().insert(s.providerOperations).values({ id: randomUUID(), runId: source.id, memberId: "member-a", provider: "fake", model: "fixture",
    status: "outcome_unknown", requestFingerprint: "fixture" });
  expect((await previewConversationContentDeletion(source.conversationId))!.blockedReasons).toContain("pending_operations");
  await expect(deleteConversationContent(source.conversationId, preview.fingerprint!)).rejects.toBeInstanceOf(ConversationDeletionBlockedError);
  await getDatabase().update(s.runs).set({ status: "running" }).where(eq(s.runs.id, source.id));
  expect((await previewConversationContentDeletion(source.conversationId))!.blockedReasons).toContain("active_run");
});
test("the live execution lease blocks apply, even for a terminal-looking run", async () => {
  const source = await fixture(); const preview = (await previewConversationContentDeletion(source.conversationId))!;
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    await client.query("begin");
    const key = createHash("sha256").update(`deliberation-ai-run:${source.id}`).digest().readBigInt64BE(0).toString();
    await client.query("select pg_advisory_xact_lock($1::bigint)", [key]);
    await expect(deleteConversationContent(source.conversationId, preview.fingerprint!)).rejects.toBeInstanceOf(RunDeletionBlockedError);
    expect(await findDurableRunById(source.id)).toBeDefined();
  } finally { await client.query("rollback"); await client.end(); }
});
test("a late invalid receipt rolls back earlier body deletions and audits", async () => {
  const source = await fixture(); const child = await fixture({ continuationSource: await continuation(source.id) });
  const later = [source.id, child.id].sort()[1]!;
  await getDatabase().insert(s.providerOperations).values({ id: randomUUID(), runId: later, memberId: "member-a", provider: "fake", model: "fixture",
    status: "succeeded", requestFingerprint: "fixture", resultMetadataCiphertext: "invalid-audit-fixture" });
  const preview = (await previewConversationContentDeletion(source.conversationId))!; expect(preview.blockedReasons).toEqual([]); expect(preview.eligible).toBe(true);
  await expect(deleteConversationContent(source.conversationId, preview.fingerprint!)).rejects.toThrow();
  expect(await findDurableRunById(source.id)).toBeDefined(); expect(await findDurableRunById(child.id)).toBeDefined();
  expect(await getDatabase().select().from(s.runDeletions).where(eq(s.runDeletions.conversationId, source.conversationId))).toHaveLength(0);
});
test("foreign ownership and unknown knowledge cascade dependencies fail closed", async () => {
  const source = await fixture();
  await getDatabase().update(s.conversations).set({ ownerId: "foreign-fixture" }).where(eq(s.conversations.id, source.conversationId));
  expect(await previewConversationContentDeletion(source.conversationId)).toBeUndefined();
  await getDatabase().update(s.conversations).set({ ownerId: LOCAL_OWNER_ID }).where(eq(s.conversations.id, source.conversationId));
  await getDatabase().execute(sql`create table deletion_unknown_dependency (id uuid references knowledge_preparations(id) on delete cascade)`);
  try {
    expect((await previewConversationContentDeletion(source.conversationId))!.blockedReasons).toContain("schema_changed");
  } finally { await getDatabase().execute(sql`drop table deletion_unknown_dependency`); }
});
test("oversized target and local knowledge scopes block before mutation", async () => {
  const source = await fixture(); const preview = (await previewConversationContentDeletion(source.conversationId))!;
  await getDatabase().insert(s.conversationRuns).values(Array.from({ length: 100 }, () => ({ ownerId: LOCAL_OWNER_ID, conversationId: source.conversationId,
    runId: randomUUID(), kind: "independent", createdAt: new Date() })));
  const large = (await previewConversationContentDeletion(source.conversationId))!;
  expect(large).toMatchObject({ eligible: false, runIds: [], privateBranchIds: [] });
  expect(large.blockedReasons).toContain("too_many_members");
  await expect(deleteConversationContent(source.conversationId, preview.fingerprint!)).rejects.toBeInstanceOf(ConversationDeletionBlockedError);
  await getDatabase().delete(s.conversationRuns).where(and(eq(s.conversationRuns.conversationId, source.conversationId), sql`${s.conversationRuns.runId} <> ${source.id}::uuid`));
  await getDatabase().insert(s.knowledgePreparations).values(Array.from({ length: 1_001 }, () => ({ id: randomUUID(), ownerId: LOCAL_OWNER_ID,
    conversationId: source.conversationId, requestHash: "fixture-limit", packetCiphertext: "opaque-limit-fixture" })));
  expect((await previewConversationContentDeletion(source.conversationId))!.blockedReasons).toContain("inspection_limit");
  await expect(deleteConversationContent(source.conversationId, preview.fingerprint!)).rejects.toBeInstanceOf(ConversationDeletionBlockedError);
  expect(await findDurableRunById(source.id)).toBeDefined();
});
test("consumed retry permissions do not block conversation deletion, while an unknown call still does", async () => {
  const source = await fixture();
  const original = { id: randomUUID(), runId: source.id, memberId: defaultFakeCouncilMembers[0]!.id, round: 0 as const, attempt: 1, provider: "fake", model: "offline-model", requestFingerprint: "fixture" };
  await getDatabase().insert(s.providerOperations).values({ ...original, status: "retry_authorized" });
  await getDatabase().insert(s.providerOperations).values({ id: randomUUID(), runId: source.id, memberId: original!.memberId, round: original!.round,
    attempt: original!.attempt + 1, provider: original!.provider, model: original!.model, status: "discarded", requestFingerprint: original!.requestFingerprint });
  expect(await previewConversationContentDeletion(source.conversationId)).toMatchObject({ eligible: true, pendingOperations: [] });
  await getDatabase().update(s.providerOperations).set({ status: "outcome_unknown", errorCode: "remote_outcome_unknown" }).where(eq(s.providerOperations.id, original!.id));
  const blocked = (await previewConversationContentDeletion(source.conversationId))!;
  expect(blocked.blockedReasons).toContain("pending_operations");
  expect(blocked.pendingOperations).toEqual([expect.objectContaining({ id: original!.id, model: original!.model, errorCode: "remote_outcome_unknown", canDiscard: true })]);
  await resolveProviderOperation(original!.id, "discard");
  const ready = (await previewConversationContentDeletion(source.conversationId))!;
  await deleteConversationContent(source.conversationId, ready.fingerprint!);
  expect(await previewConversationContentDeletion(source.conversationId)).toBeUndefined();
});
test("deletion preserves consumed retry grants and unknown usage in a readable v2 audit", async () => {
  const source = await fixture(); const first = randomUUID(); const later = randomUUID();
  const common = { runId: source.id, memberId: "member-a", round: 0 as const, provider: "fake", model: "offline-model", requestFingerprint: "fixture" };
  await getDatabase().insert(s.providerOperations).values([
    { ...common, id: first, attempt: 1, status: "retry_authorized" },
    { ...common, id: later, attempt: 2, status: "discarded" },
  ]);
  const ready = (await previewConversationContentDeletion(source.conversationId))!;
  await deleteConversationContent(source.conversationId, ready.fingerprint!);
  expect(await previewConversationContentDeletion(source.conversationId)).toBeUndefined();
  const audit = (await loadRunDeletion(source.id))!;
  expect(audit.version).toBe("run-deletion-audit-v2");
  expect(audit.receipts).toEqual(expect.arrayContaining([
    expect.objectContaining({ operationId: first, status: "retry_authorized", inputTokens: null, outputTokens: null }),
    expect.objectContaining({ operationId: later, status: "discarded", inputTokens: null, outputTokens: null }),
  ]));
});
