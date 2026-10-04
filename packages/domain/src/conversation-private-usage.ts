import type { PrivateBranchBody, PrivateBranchDeletionAudit, PrivateDeliveryUsage } from "@deliberation-ai/contracts";
import { summarizePrivateUsageRecords, type PrivateUsageRecord } from "./private-usage";

export class PrivateUsageIntegrityError extends Error {}
function normalizedUsage(value: PrivateDeliveryUsage | null | undefined): PrivateDeliveryUsage | null {
  return value ? { model: value.model, remoteResponseId: value.remoteResponseId, inputTokens: value.inputTokens,
    outputTokens: value.outputTokens, tokenDetails: value.tokenDetails ? {
      version: value.tokenDetails.version, inputTokenKind: value.tokenDetails.inputTokenKind,
      outputTokenKind: value.tokenDetails.outputTokenKind, totalTokens: value.tokenDetails.totalTokens,
      cachedInputTokens: value.tokenDetails.cachedInputTokens, cacheWriteInputTokens: value.tokenDetails.cacheWriteInputTokens,
      reasoningTokens: value.tokenDetails.reasoningTokens, toolInputTokens: value.tokenDetails.toolInputTokens,
    } : value.tokenDetails } : null;
}
export function summarizeConversationPrivateUsage(
  branches: readonly { id: string; body: PrivateBranchBody }[], audits: readonly PrivateBranchDeletionAudit[],
) {
  const origins = new Map<string, PrivateUsageRecord>(); const copies: PrivateUsageRecord[] = [];
  const collect = (branchId: string, record: PrivateUsageRecord) => {
    if (record.originBranchId !== branchId) { copies.push(record); return; }
    if (origins.has(record.id)) throw new PrivateUsageIntegrityError("Duplicate origin receipt");
    origins.set(record.id, record);
  };
  for (const branch of branches) for (const item of branch.body.deliveries ?? []) {
    const usage = normalizedUsage(item.usage ?? item.result);
    collect(branch.id, { id: item.id, originBranchId: item.originBranchId, connectionId: item.connectionId,
      status: item.status, submittedAt: item.submittedAt, model: usage?.model ?? null, usage });
  }
  for (const audit of audits) for (const item of audit.receipts) {
    const usage = normalizedUsage(item.usage);
    collect(audit.branchId, { id: item.operationId, originBranchId: item.originBranchId, connectionId: item.connectionId,
      status: item.status, submittedAt: item.submittedAt, model: usage?.model ?? null, usage });
  }
  let unattributedCopies = 0;
  for (const copy of copies) {
    const origin = origins.get(copy.id);
    if (!origin) { unattributedCopies++; continue; }
    if (JSON.stringify(origin) !== JSON.stringify(copy)) throw new PrivateUsageIntegrityError("Copied receipt differs from origin");
  }
  return { ...summarizePrivateUsageRecords([...origins.values()]), copiedReceipts: copies.length,
    unattributedCopies, retainedBranches: branches.length, deletedBranches: audits.length };
}
