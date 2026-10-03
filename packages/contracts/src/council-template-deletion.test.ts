import { expect, test } from "vitest";
import { defaultFakeCouncilMembers, saveCouncilTemplateSchema, deleteCouncilTemplateSchema, councilTemplateDeletionReceiptSchema } from "./index";
const id = "00000000-0000-4000-8000-000000000001";
test("creation and update identities are explicit and exclusive", () => {
  const input = { name: "Generated template", members: defaultFakeCouncilMembers };
  expect(saveCouncilTemplateSchema.safeParse(input).success).toBe(false);
  expect(saveCouncilTemplateSchema.safeParse({ ...input, requestId: id }).success).toBe(true);
  expect(saveCouncilTemplateSchema.safeParse({ ...input, id }).success).toBe(true);
  expect(saveCouncilTemplateSchema.safeParse({ ...input, id, requestId: id }).success).toBe(false);
});
test("deletion requires both acknowledgements and refuses added content", () => {
  const input = { templateId: id, fingerprint: "a".repeat(64), confirmContentDeletion: true, acknowledgeRetainedCopies: true };
  expect(deleteCouncilTemplateSchema.safeParse(input).success).toBe(true);
  expect(deleteCouncilTemplateSchema.safeParse({ ...input, acknowledgeRetainedCopies: false }).success).toBe(false);
  expect(deleteCouncilTemplateSchema.safeParse({ ...input, question: "unrequested" }).success).toBe(false);
  expect(councilTemplateDeletionReceiptSchema.safeParse({ version: "council-template-deletion-v1", templateId: id,
    creationRequestId: null, creationRequestHash: null, fingerprint: input.fingerprint, deletedAt: "2026-10-03T00:00:00.000Z", memberCount: 2, name: "removed content" }).success).toBe(false);
});
