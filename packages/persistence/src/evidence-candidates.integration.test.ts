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
import { commitEvidencePublication, previewEvidencePublication, listEvidencePublications, acknowledgeManualEvidencePublication, EvidencePublicationConflictError } from "./evidence-publications";
import { listKnowledgeSources, exportKnowledgeVersion, searchLocalKnowledge } from "./knowledge-sources";
const ids: string[] = [], conversationIds: string[] = [], collectionIds: string[] = [];
afterEach(async () => {
  if (ids.length) await getDatabase().delete(s.evidencePublications).where(inArray(s.evidencePublications.runId, ids));
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


test("reviewed reusable save freezes exact originals, deduplicates concurrent retries and fences review/destination changes", async () => {
  const f = await fixture(); const candidate = (await createEvidenceCandidate({ ...f.owner, excerpt: "  Özgün conflicting passage.\n" }))!;
  const collection = await createKnowledgeCollection("Approved evidence destination"); collectionIds.push(collection.id);
  const scope = await changeKnowledgeGrant(collection.id, 1, "active");
  const request = { candidateId: candidate.id, destination: { kind: "local" as const, scope } };
  await expect(previewEvidencePublication(request)).rejects.toBeInstanceOf(EvidencePublicationConflictError);
  await updateEvidenceSourceReview(candidate.id, { reviewStatus: "verified", freshnessStatus: "current" });
  const preview = await previewEvidencePublication(request);
  const commit = { ...request, requestId: randomUUID(), fingerprint: preview.fingerprint, consent: true as const };
  const [a, b] = await Promise.all([commitEvidencePublication(commit), commitEvidencePublication(commit)]);
  expect(a).toEqual(b); expect(a.candidate.excerpt).toBe("  Özgün conflicting passage.\n");
  expect((await listKnowledgeSources(scope)).items).toHaveLength(1);
  expect((await exportKnowledgeVersion(scope, a.sourceId!, a.versionId!)).extraction.text).toBe(a.candidate.excerpt);
  expect((await searchLocalKnowledge([scope], "conflicting")).hits).toHaveLength(1);
  const another = await commitEvidencePublication({ ...commit, requestId: randomUUID() });
  expect(another.sourceId).toBe(a.sourceId); expect(another.versionId).toBe(a.versionId);
  expect((await listKnowledgeSources(scope)).items).toHaveLength(1);
  await expect(commitEvidencePublication({ ...commit, destination: { kind: "manual", name: "Wrong", account: "Wrong", url: "https://example.invalid/wrong" } })).rejects.toBeInstanceOf(EvidencePublicationConflictError);
  await expect(commitEvidencePublication({ ...commit, requestId: randomUUID(), destination: { kind: "manual", name: "Wrong", account: "Wrong", url: "https://example.invalid/wrong" } })).rejects.toBeInstanceOf(EvidencePublicationConflictError);
  await expect(previewEvidencePublication({ ...request, destination: { kind: "local", scope: { ...scope, ownerId: "foreign-owner" } } })).rejects.toBeInstanceOf(KnowledgeAccessError);
  await updateEvidenceSourceReview(candidate.id, { freshnessStatus: "stale" });
  await expect(commitEvidencePublication({ ...commit, requestId: randomUUID() })).rejects.toBeInstanceOf(EvidencePublicationConflictError);
  const revoked = await changeKnowledgeGrant(collection.id, scope.grantRevision, "revoked");
  expect(await commitEvidencePublication(commit)).toEqual(a); // lost acknowledgement creates no second write/access
  await expect(previewEvidencePublication(request)).rejects.toBeInstanceOf(EvidencePublicationConflictError);
  const active = await changeKnowledgeGrant(collection.id, revoked.grantRevision, "active");
  await updateEvidenceSourceReview(candidate.id, { freshnessStatus: "current" });
  await expect(commitEvidencePublication({ ...commit, requestId: randomUUID() })).rejects.toBeInstanceOf(KnowledgeAccessError);
  expect((await listKnowledgeSources(active)).items).toHaveLength(1);
  expect((await previewRunDeletion(f.run.runId))!.blockedReasons).toContain("copied_content");
  const audit = new Client({ connectionString: process.env.DATABASE_URL }); await audit.connect();
  try {
    await auditRestoredEncryption(audit);
    await expect(audit.query("update evidence_publications set body_ciphertext = 'changed' where id=$1", [a.id])).rejects.toThrow();
    // Simulate a failed receipt insert after local source creation. Transaction rolls back both.
    await audit.query("CREATE FUNCTION fail_generated_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'generated rollback'; END $$");
    await audit.query("CREATE TRIGGER fail_generated_publication BEFORE INSERT ON evidence_publications FOR EACH ROW EXECUTE FUNCTION fail_generated_publication()");
    try {
      const second = await createKnowledgeCollection("Rollback destination"); collectionIds.push(second.id);
      const secondScope = await changeKnowledgeGrant(second.id, 1, "active");
      const other = { candidateId: candidate.id, destination: { kind: "local" as const, scope: secondScope } };
      const current = await previewEvidencePublication(other);
      await expect(commitEvidencePublication({ ...other, requestId: randomUUID(), fingerprint: current.fingerprint, consent: true })).rejects.toThrow();
      expect((await listKnowledgeSources(secondScope)).items).toHaveLength(0);
    } finally { await audit.query("DROP TRIGGER fail_generated_publication ON evidence_publications"); await audit.query("DROP FUNCTION fail_generated_publication()"); }
  } finally { await audit.end(); }
});

test("manual handoff remains pending until owner acknowledgement; model-only and changed local candidates cannot publish", async () => {
  const f = await fixture(true); const candidate = (await createEvidenceCandidate(f.owner))!;
  await updateEvidenceSourceReview(candidate.id, { reviewStatus: "verified", freshnessStatus: "current" });
  const destination = { kind: "manual" as const, name: "Selected notebook", account: "Declared account", url: "https://example.invalid/notebook" };
  const request = { candidateId: candidate.id, destination }; const p = await previewEvidencePublication(request);
  const receipt = await commitEvidencePublication({ ...request, requestId: randomUUID(), fingerprint: p.fingerprint, consent: true });
  expect(receipt).toMatchObject({ status: "awaiting_manual_addition", sourceId: null, versionId: null, indexing: "unknown", remoteReadBack: "not_performed" });
  const acknowledged = await acknowledgeManualEvidencePublication(receipt.id);
  expect(acknowledged.status).toBe("manual_acknowledged"); expect(acknowledged.remoteReadBack).toBe("not_performed");
  expect(await acknowledgeManualEvidencePublication(receipt.id)).toEqual(acknowledged);
  expect((await listEvidencePublications(f.run.runId))[0]).toEqual(acknowledged);
  const model = (await createEvidenceCandidate({ origin: "model-citation", requestId: randomUUID(), runId: f.run.runId, claimId: f.claimId, memberId: f.run.report!.memberResults[0]!.memberId, citationIndex: 0, relation: "context" }))!;
  await expect(previewEvidencePublication({ candidateId: model.id, destination })).rejects.toBeInstanceOf(EvidencePublicationConflictError);
  const quote = f.packet!.excerpts[0]!;
  const local = (await createEvidenceCandidate({ origin: "local-excerpt", requestId: randomUUID(), runId: f.run.runId, claimId: f.claimId, excerptId: quote.excerptId, relation: "contradicts" }))!;
  await updateEvidenceSourceReview(local.id, { reviewStatus: "verified", freshnessStatus: "current" });
  const localRequest = { candidateId: local.id, destination }; const old = await previewEvidencePublication(localRequest);
  await importKnowledgeFiles(f.scope!, [{ sourceId: quote.source.sourceId, expectedVersionId: quote.source.versionId, name: "updated.txt", mediaType: "text/plain", bytes: Buffer.from("Updated keyword source.") }]);
  await expect(commitEvidencePublication({ ...localRequest, requestId: randomUUID(), fingerprint: old.fingerprint, consent: true })).rejects.toBeInstanceOf(EvidencePublicationConflictError);
  const audit = new Client({ connectionString: process.env.DATABASE_URL }); await audit.connect();
  try { await auditRestoredEncryption(audit); } finally { await audit.end(); }
});
