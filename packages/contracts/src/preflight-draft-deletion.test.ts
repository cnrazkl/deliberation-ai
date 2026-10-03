import { expect, test } from "vitest";
import { deletePreflightDraftSchema, preflightDraftDeletionReceiptSchema } from "./index";

test("draft deletion requires both explicit acknowledgements and excludes private text from retained receipts", () => {
  const draftId = "11111111-1111-4111-8111-111111111111"; const fingerprint = "a".repeat(64);
  const input = { draftId, fingerprint, confirmContentDeletion: true, acknowledgeRetainedRecords: true };
  expect(deletePreflightDraftSchema.safeParse(input).success).toBe(true);
  expect(deletePreflightDraftSchema.safeParse({ ...input, acknowledgeRetainedRecords: false }).success).toBe(false);
  expect(deletePreflightDraftSchema.safeParse({ draftId, fingerprint }).success).toBe(false);
  const receipt = { version: "preflight-draft-deletion-v1", draftId, fingerprint, deletedAt: "2026-10-03T09:00:00.000Z",
    previousStatus: "awaiting_input", retainedRunId: null };
  expect(preflightDraftDeletionReceiptSchema.safeParse(receipt).success).toBe(true);
  expect(preflightDraftDeletionReceiptSchema.safeParse({ ...receipt, question: "Private content" }).success).toBe(false);
});
