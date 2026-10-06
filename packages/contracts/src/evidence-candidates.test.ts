import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { createEvidenceCandidateSchema, evidenceCandidateProvenanceSchema } from "./index";
const base = { requestId: randomUUID(), runId: randomUUID(), claimId: "claim-001", relation: "context" };
test("owner intake preserves exact source characters and rejects unsafe addresses/oversize/implicit review", () => {
  const owner = { ...base, origin: "owner", title: "A", url: "https://example.invalid/a", excerpt: "  exact passage\n" };
  expect(createEvidenceCandidateSchema.parse(owner)).toMatchObject({ excerpt: owner.excerpt });
  for (const patch of [{ url: "javascript:alert(1)" }, { excerpt: "x".repeat(4001) }, { reviewStatus: "verified" }, { excerpt: " " }]) expect(createEvidenceCandidateSchema.safeParse({ ...owner, ...patch }).success).toBe(false);
});
test("model citations accept identities only, never caller-supplied citations or source passages", () => {
  const citation = { ...base, origin: "model-citation", memberId: "member-a", citationIndex: 0 };
  expect(createEvidenceCandidateSchema.safeParse(citation).success).toBe(true);
  expect(createEvidenceCandidateSchema.safeParse({ ...citation, url: "https://forged.invalid" }).success).toBe(false);
  expect(createEvidenceCandidateSchema.safeParse({ ...citation, excerpt: "invented source passage" }).success).toBe(false);
});
test("local candidates bind only stored excerpt identity; arbitrary text/scope is rejected", () => {
  const local = { ...base, origin: "local-excerpt", excerptId: randomUUID() };
  expect(createEvidenceCandidateSchema.safeParse(local).success).toBe(true);
  expect(createEvidenceCandidateSchema.safeParse({ ...local, text: "forged" }).success).toBe(false);
});
test("restored provenance rejects mismatched origins", () => {
  const provenance = { version: "evidence-candidate-v1", requestHash: "a".repeat(64), origin: "model-citation", statement: "Claim", relatedSourceId: null, model: null, localExcerpt: null };
  expect(evidenceCandidateProvenanceSchema.safeParse(provenance).success).toBe(false);
  expect(evidenceCandidateProvenanceSchema.safeParse({ ...provenance, origin: "owner" }).success).toBe(true);
});
