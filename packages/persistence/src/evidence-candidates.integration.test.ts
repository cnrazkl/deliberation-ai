import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, afterEach, expect, test } from "vitest";
import { createRunRequestSchema, defaultFakeCouncilMembers, type CreateEvidenceCandidate } from "@deliberation-ai/contracts";
import { buildCouncilReport } from "@deliberation-ai/domain";
import { buildRiskPreflight, buildRoundZeroPromptPlan, KnowledgeAccessError } from "@deliberation-ai/application";
import { createEvidenceCandidate, EvidenceCandidateConflictError, listEvidenceCandidates } from "./evidence-candidates";
import { deleteEvidenceSource, EvidenceSourceInUseError, EvidenceSourceLimitError, saveEvidenceSource, updateEvidenceSourceReview } from "./evidence-sources";
import { closeDatabase, getDatabase } from "./database";
import { closeBoss } from "./queue";
import { enqueueDurableRun, executeDurableRun, findDurableRunById, updateDurableClaimEvidenceState, EvidenceRequirementError } from "./run-repository";
import { createKnowledgeCollection, createKnowledgeConversation, changeKnowledgeGrant, setConversationKnowledge } from "./knowledge-scope";
import { importKnowledgeFiles } from "./knowledge-sources";
import { prepareKnowledgePacket } from "./knowledge-packets";
import { previewRunDeletion, deleteRunBody } from "./run-deletion";
import { auditRestoredEncryption } from "../scripts/backup-encryption-audit";
import * as s from "./schema";
const ids: string[] = [], conversationIds: string[] = [], collectionIds: string[] = [];
afterEach(async () => {
  if (ids.length) { await getDatabase().delete(s.runDeletions).where(inArray(s.runDeletions.id, ids)); await getDatabase().delete(s.conversationRuns).where(inArray(s.conversationRuns.runId, ids)); await getDatabase().delete(s.runs).where(inArray(s.runs.id, ids)); }
  if (conversationIds.length) {
    await getDatabase().delete(s.knowledgePreparations).where(inArray(s.knowledgePreparations.conversationId, conversationIds));
    await getDatabase().delete(s.conversationKnowledgeSelections).where(inArray(s.conversationKnowledgeSelections.conversationId, conversationIds));
    await getDatabase().delete(s.conversationKnowledge).where(inArray(s.conversationKnowledge.conversationId, conversationIds));
    await getDatabase().delete(s.conversations).where(inArray(s.conversations.id, conversationIds));
  }
  if (collectionIds.length) {
    const sources = await getDatabase().select({ id: s.knowledgeSources.id }).from(s.knowledgeSources).where(inArray(s.knowledgeSources.collectionId, collectionIds));
    if (sources.length) await getDatabase().delete(s.knowledgeSourceVersions).where(inArray(s.knowledgeSourceVersions.sourceId, sources.map((item) => item.id)));
    await getDatabase().delete(s.knowledgeSources).where(inArray(s.knowledgeSources.collectionId, collectionIds));
    await getDatabase().delete(s.knowledgeGrants).where(inArray(s.knowledgeGrants.collectionId, collectionIds));
    await getDatabase().delete(s.knowledgeCollections).where(inArray(s.knowledgeCollections.id, collectionIds));
  }
  ids.length = 0; conversationIds.length = 0; collectionIds.length = 0;
});
afterAll(async () => { await closeBoss(); await closeDatabase(); });
async function fixture(local = false) {
  let packet;
  let scope;
  if (local) {
    const collection = await createKnowledgeCollection("Generated candidate library"); collectionIds.push(collection.id);
    scope = await changeKnowledgeGrant(collection.id, 1, "active");
    await importKnowledgeFiles(scope, [{ sourceId: randomUUID(), expectedVersionId: null, name: "candidate.txt", mediaType: "text/plain", bytes: Buffer.from("keyword original conflicting passage") }]);
    const { conversationId } = await createKnowledgeConversation(); conversationIds.push(conversationId);
    const revision = await setConversationKnowledge(conversationId, null, { topic: "candidate fixture", scopes: [scope] });
    packet = await prepareKnowledgePacket({ id: randomUUID(), conversationId, selectionRevision: revision!, query: "keyword", allowWithoutEvidence: false });
  }
  const question = "Generated candidate question", members = defaultFakeCouncilMembers.slice(0, 2);
  const plan = buildRoundZeroPromptPlan({ question, members, memoryContext: [], toolContext: [], documents: [], images: [], knowledgePacket: packet });
  const risk = buildRiskPreflight({ question, documents: packet?.excerpts.map((quote) => ({ content: quote.text })) ?? [], memoryContext: [], toolContext: [], promptFingerprint: plan.fingerprint, reviewRounds: 0 });
  const queued = await enqueueDurableRun(createRunRequestSchema.parse({ question, members, providerMode: "fake", reviewRounds: 0, idempotencyKey: randomUUID(),
    ...(packet ? { knowledgePacket: { id: packet.id, fingerprint: packet.fingerprint, reviewed: true }, expectedPreflightFingerprint: plan.fingerprint, expectedRiskFingerprint: risk.fingerprint } : {}) }));
  ids.push(queued.runId);
  await executeDurableRun(queued.runId, async () => buildCouncilReport(members.map((member) => ({ memberId: member.id, label: member.label,
    councilRole: "analyst" as const, rawText: "Original generated model response", citations: [{ url: "https://example.invalid/candidate", title: "Generated model citation" }],
    parsed: { summary: "Generated answer", claims: [{ statement: "Generated common claim", kind: "shared" as const, quote: "Generated model passage" }] } })), []));
  const run = (await findDurableRunById(queued.runId))!;
  const [membership] = await getDatabase().select().from(s.conversationRuns).where(eq(s.conversationRuns.runId, run.runId));
  if (!conversationIds.includes(membership!.conversationId)) conversationIds.push(membership!.conversationId);
  const claimId = run.report!.sharedClaims[0]!.claimId;
  return { run, claimId, packet, scope, owner: { origin: "owner", requestId: randomUUID(), runId: run.runId, claimId,
    title: "Generated false source", url: "https://example.invalid/false", excerpt: "Original false statement.", relation: "supports", note: "", publishedAt: "2020-01-01" } satisfies CreateEvidenceCandidate };
}
test("false/stale/conflicting submissions remain frozen; separate human decisions never promote claims", async () => {
  const f = await fixture(); const source = (await createEvidenceCandidate(f.owner))!;
  expect(source).toMatchObject({ reviewStatus: "unreviewed", freshnessStatus: "unreviewed", candidateProvenance: { origin: "owner" } });
  await updateEvidenceSourceReview(source.id, { reviewStatus: "rejected" });
  await updateEvidenceSourceReview(source.id, { freshnessStatus: "stale" });
  const conflicting = (await createEvidenceCandidate({ ...f.owner, requestId: randomUUID(), relatedSourceId: source.id, relation: "contradicts", excerpt: "New conflicting original passage." }))!;
  await updateEvidenceSourceReview(conflicting.id, { reviewStatus: "verified" });
  await updateEvidenceSourceReview(conflicting.id, { freshnessStatus: "current" });
  expect((await findDurableRunById(f.run.runId))!.report!.sharedClaims[0]!.evidenceState).toBe("unsupported");
  const list = (await listEvidenceCandidates(f.run.runId))!;
  expect(list).toHaveLength(2); expect(list.find((item) => item.id === source.id)).toMatchObject({ excerpt: f.owner.excerpt, reviewStatus: "rejected", freshnessStatus: "stale" });
  await expect(deleteEvidenceSource(source.id)).rejects.toBeInstanceOf(EvidenceSourceInUseError);
  await expect(getDatabase().update(s.evidenceSources).set({ titleCiphertext: "replacement" }).where(eq(s.evidenceSources.id, source.id))).rejects.toMatchObject({ cause: { message: "Evidence source snapshot fields are immutable" } });
  expect((await getDatabase().select().from(s.evidenceSources).where(eq(s.evidenceSources.id, source.id)))[0]!.candidateProvenanceCiphertext).not.toContain("Generated common claim");
  const legacy = (await saveEvidenceSource({ runId: f.run.runId, claimId: f.claimId, title: "Earlier manual source", url: "https://example.invalid/old", excerpt: "Earlier passage", relation: "context", note: "" }))!;
  await createEvidenceCandidate({ ...f.owner, requestId: randomUUID(), relatedSourceId: legacy.id });
  await expect(deleteEvidenceSource(legacy.id)).rejects.toBeInstanceOf(EvidenceSourceInUseError);
  expect(await Promise.all(Array.from({ length: 6 }, (_, index) => index % 2 === 0
    ? createEvidenceCandidate({ ...f.owner, requestId: randomUUID() })
    : saveEvidenceSource({ runId: f.run.runId, claimId: f.claimId, title: "Concurrent manual source", url: "https://example.invalid/parallel", excerpt: "Original parallel passage", relation: "context", note: "" })))).toHaveLength(6);
  await expect(createEvidenceCandidate({ ...f.owner, requestId: randomUUID() })).rejects.toBeInstanceOf(EvidenceSourceLimitError);
  await expect(saveEvidenceSource({ runId: f.run.runId, claimId: f.claimId, title: "Overflow", url: "https://example.invalid/overflow", excerpt: "overflow", relation: "context", note: "" })).rejects.toBeInstanceOf(EvidenceSourceLimitError);
});
test("stored model citation identity is checked; model passage cannot masquerade as source text", async () => {
  const f = await fixture(); const input = { origin: "model-citation", requestId: randomUUID(), runId: f.run.runId, claimId: f.claimId, memberId: defaultFakeCouncilMembers[0]!.id, citationIndex: 0, relation: "context" } as const;
  const source = (await createEvidenceCandidate(input))!;
  expect(source.excerpt).toBeNull(); expect(source.candidateProvenance!.model!.passage).toBe("Generated model passage");
  await expect(updateEvidenceSourceReview(source.id, { reviewStatus: "verified" })).rejects.toBeInstanceOf(EvidenceSourceInUseError);
  await expect(updateEvidenceSourceReview(source.id, { freshnessStatus: "current" })).rejects.toBeInstanceOf(EvidenceSourceInUseError);
  await updateEvidenceSourceReview(source.id, { freshnessStatus: "inaccessible" });
  expect(await createEvidenceCandidate(input)).toMatchObject({ id: source.id, freshnessStatus: "inaccessible" });
  await expect(createEvidenceCandidate({ ...input, citationIndex: 1 })).rejects.toBeInstanceOf(EvidenceCandidateConflictError);
  await expect(createEvidenceCandidate({ ...input, requestId: randomUUID(), memberId: "forged-member" })).rejects.toBeInstanceOf(EvidenceCandidateConflictError);
  expect(await createEvidenceCandidate({ ...f.owner, runId: randomUUID() })).toBeUndefined();
});
test("changed/revoked local version retains original provenance but cannot authorize fresh evidence", async () => {
  const f = await fixture(true), quote = f.packet!.excerpts[0]!;
  const input = { origin: "local-excerpt", requestId: randomUUID(), runId: f.run.runId, claimId: f.claimId, excerptId: quote.excerptId, relation: "supports" } as const;
  const source = (await createEvidenceCandidate(input))!;
  await updateEvidenceSourceReview(source.id, { reviewStatus: "verified", freshnessStatus: "current" });
  expect((await listEvidenceCandidates(f.run.runId))![0]!.availability).toBe("same-version");
  await importKnowledgeFiles(f.scope!, [{ sourceId: quote.source.sourceId, expectedVersionId: quote.source.versionId, name: "candidate.txt", mediaType: "text/plain", bytes: Buffer.from("keyword changed passage") }]);
  expect((await listEvidenceCandidates(f.run.runId))![0]).toMatchObject({ excerpt: quote.text, availability: "changed", freshnessStatus: "current" });
  await expect(updateDurableClaimEvidenceState(f.run.runId, f.claimId, "externally-verified")).rejects.toBeInstanceOf(EvidenceRequirementError);
  await expect(updateEvidenceSourceReview(source.id, { freshnessStatus: "current" })).rejects.toBeInstanceOf(EvidenceSourceInUseError);
  await updateEvidenceSourceReview(source.id, { freshnessStatus: "changed" });
  await changeKnowledgeGrant(f.scope!.collectionId, 2, "revoked");
  expect((await listEvidenceCandidates(f.run.runId))![0]).toMatchObject({ availability: "inaccessible", excerpt: quote.text });
  expect(await createEvidenceCandidate(input)).toMatchObject({ id: source.id });
  await expect(createEvidenceCandidate({ ...input, requestId: randomUUID() })).rejects.toBeInstanceOf(KnowledgeAccessError);
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { expect((await auditRestoredEncryption(client)).decryptedValues).toBeGreaterThan(0); } finally { await client.end(); }
});
test("serialized idempotent intake, owner isolation and reviewed deletion include candidate snapshots", async () => {
  const f = await fixture(); const [a, b] = await Promise.all([createEvidenceCandidate(f.owner), createEvidenceCandidate(f.owner)]); expect(a).toEqual(b);
  await expect(createEvidenceCandidate({ ...f.owner, excerpt: "Changed replay" })).rejects.toBeInstanceOf(EvidenceCandidateConflictError);
  const [row] = await getDatabase().select().from(s.runs).where(eq(s.runs.id, f.run.runId));
  await getDatabase().update(s.runs).set({ ownerId: "foreign-owner" }).where(eq(s.runs.id, f.run.runId));
  expect(await listEvidenceCandidates(f.run.runId)).toBeUndefined(); expect(await createEvidenceCandidate({ ...f.owner, requestId: randomUUID() })).toBeUndefined();
  await getDatabase().update(s.runs).set({ ownerId: row!.ownerId }).where(eq(s.runs.id, f.run.runId));
  const first = (await previewRunDeletion(f.run.runId))!; expect(first.eligible).toBe(true); expect(first.contentCounts.evidence_sources).toBe(1);
  await updateEvidenceSourceReview(a!.id, { reviewStatus: "rejected" });
  const next = (await previewRunDeletion(f.run.runId))!; expect(next.fingerprint).not.toBe(first.fingerprint);
  await deleteRunBody(f.run.runId, next.fingerprint!); expect(await listEvidenceCandidates(f.run.runId)).toBeUndefined();
});
