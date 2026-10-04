import { expect, test } from "vitest";
import type { PrivateBranchBody, PrivateBranchDeletionAudit, PrivateDelivery, PrivateDeliveryUsage } from "@deliberation-ai/contracts";
import { summarizeConversationPrivateUsage as summarize, PrivateUsageIntegrityError } from "./conversation-private-usage";
const usage: PrivateDeliveryUsage = { model: "observed", remoteResponseId: null, inputTokens: 0, outputTokens: 5, tokenDetails: null };
const receipt = (overrides: Partial<PrivateDelivery> = {}): PrivateDelivery => ({ id: "send", originBranchId: "root", messageId: "msg",
  fingerprint: "hash", connectionId: "connection", connectionFingerprint: "hash", status: "succeeded",
  request: { version: "private-text-v1", model: "requested", messages: [], maxOutputTokens: 1024 },
  createdAt: "date", submittedAt: "date", finishedAt: "date", errorCode: null, result: { ...usage, text: "SECRET REPLY" }, ...overrides });
const branch = (id: string, deliveries: PrivateDelivery[]) => ({ id, body: { deliveries } as PrivateBranchBody });
const audit = (branchId: string, deliveries: PrivateDelivery[]): PrivateBranchDeletionAudit => ({ version: "private-branch-deletion-audit-v1",
  branchId, conversationId: "conversation", creationRequestId: "request", sourceRunId: "run", parentBranchId: null, deletedAt: "date",
  fingerprint: "hash", messageCount: 1, receipts: deliveries.map((item) => ({ operationId: item.id, originBranchId: item.originBranchId,
    connectionId: item.connectionId, status: item.status as "succeeded", createdAt: item.createdAt, submittedAt: item.submittedAt,
    finishedAt: item.finishedAt, usage: item.usage ?? item.result })) });
test("origins count once across retained forks and deletion audits without content", () => {
  const own = receipt(); const copy = receipt();
  const before = summarize([branch("root", [own]), branch("child", [copy])], []);
  const after = summarize([], [audit("root", [own]), audit("child", [copy])]);
  expect(before).toMatchObject({ ownReceipts: 1, submittedAttempts: 1, copiedReceipts: 1, unattributedCopies: 0 });
  expect(after.groups).toEqual(before.groups); expect(after.deletedBranches).toBe(2);
  expect(before.groups[0]!.model).toBe("observed"); expect(before.groups[0]!.input.total).toBe(0);
  expect(JSON.stringify(after)).not.toContain("SECRET REPLY");
});
test("missing origin is explicit and does not turn copied provenance into a new call", () => {
  expect(summarize([branch("child", [receipt()])], [])).toMatchObject({ ownReceipts: 0, submittedAttempts: 0,
    copiedReceipts: 1, unattributedCopies: 1, groups: [] });
});
test("duplicate origins and conflicting copies fail closed", () => {
  expect(() => summarize([branch("root", [receipt(), receipt()])], [])).toThrow(PrivateUsageIntegrityError);
  expect(() => summarize([branch("root", [receipt()]), branch("child", [receipt({ usage: { ...usage, inputTokens: 10 } })])], []))
    .toThrow(PrivateUsageIntegrityError);
});
test("counter property order does not change copied receipt identity", () => {
  const original = receipt({ usage: { ...usage, tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "inclusive", totalTokens: 5 } } });
  const copy = receipt({ usage: { ...usage, tokenDetails: { totalTokens: 5, outputTokenKind: "inclusive", inputTokenKind: "inclusive", version: "provider-token-details-v1" } } });
  expect(summarize([branch("root", [original]), branch("child", [copy])], []).submittedAttempts).toBe(1);
});
test("unknown deleted usage stays unknown and does not reconstruct a requested model", () => {
  const unknown = receipt({ result: null, status: "discarded" });
  const summary = summarize([], [audit("root", [unknown])]);
  expect(summary).toMatchObject({ submittedAttempts: 1, uncertain: 1 });
  expect(summary.groups[0]).toMatchObject({ model: null, input: { total: null, knownSubtotal: null, reported: 0, attempts: 1 } });
});
test("pending drafts and locally cancelled records are not submitted calls", () => {
  const summary = summarize([branch("root", [receipt({ status: "prepared", result: null, submittedAt: null }),
    receipt({ id: "cancelled", status: "cancelled", result: null, submittedAt: null })])], []);
  expect(summary).toMatchObject({ ownReceipts: 2, pending: 1, submittedAttempts: 0, groups: [] });
});
