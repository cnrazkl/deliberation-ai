import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { evidencePublicationCommitSchema, evidencePublicationPreviewRequestSchema } from "./index";
const candidateId = randomUUID();
const scope = { ownerId: "local-owner", accountId: "local", collectionId: randomUUID(), grantId: randomUUID(), grantRevision: 2 };
test("publication requires exact destination, explicit consent and an immutable review digest", () => {
  const request = { candidateId, destination: { kind: "local", scope } };
  expect(evidencePublicationPreviewRequestSchema.parse(request)).toEqual(request);
  const commit = { ...request, requestId: randomUUID(), fingerprint: "a".repeat(64), consent: true };
  expect(evidencePublicationCommitSchema.safeParse(commit).success).toBe(true);
  for (const invalid of [{ ...commit, consent: false }, { ...commit, consent: undefined }, { ...commit, fingerprint: "old" }, { ...commit, excerpt: "substituted" }]) expect(evidencePublicationCommitSchema.safeParse(invalid).success).toBe(false);
});
test("manual handoff binds named account and HTTPS link without granting an adapter write", () => {
  const destination = { kind: "manual", name: "Owner selected destination", account: "Owner account", url: "https://example.invalid/notebook" };
  expect(evidencePublicationPreviewRequestSchema.safeParse({ candidateId, destination }).success).toBe(true);
  for (const invalid of [{ ...destination, account: "" }, { ...destination, url: "file:///secrets" }, { ...destination, tool: "upload" }, { ...destination, kind: "remote" }]) expect(evidencePublicationPreviewRequestSchema.safeParse({ candidateId, destination: invalid }).success).toBe(false);
});
