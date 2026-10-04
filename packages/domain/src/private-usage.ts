import type { PrivateDelivery, PrivateDeliveryUsage } from "@deliberation-ai/contracts";

export type PrivateUsageCounter = {
  reported: number; attempts: number; knownSubtotal: number | null; total: number | null;
};
export type PrivateUsageRecord = Pick<PrivateDelivery, "id" | "originBranchId" | "connectionId" | "status" | "submittedAt"> & {
  model: string | null; usage: PrivateDeliveryUsage | null;
};
export function summarizePrivateUsageRecords(own: readonly PrivateUsageRecord[]) {
  const submitted = own.filter((item) => item.submittedAt !== null || item.usage != null ||
    ["submitted", "succeeded", "outcome_unknown", "discarded"].includes(item.status));
  const buckets = new Map<string, typeof submitted>();
  for (const item of submitted) {
    const usage = item.usage;
    const key = JSON.stringify([item.connectionId, item.model,
      usage?.tokenDetails?.inputTokenKind ?? "unknown", usage?.tokenDetails?.outputTokenKind ?? "unknown"]);
    const bucket = buckets.get(key) ?? []; bucket.push(item); buckets.set(key, bucket);
  }
  const groups = [...buckets].map(([key, items]) => {
    const first = items[0]!; const details = first.usage?.tokenDetails;
    const counter = (read: (item: PrivateUsageRecord) => number | null | undefined): PrivateUsageCounter => {
      const values = items.map(read).filter((value): value is number => value != null);
      const sum = values.reduce((total, value) => total + value, 0);
      return { reported: values.length, attempts: items.length, knownSubtotal: values.length ? sum : null,
        total: values.length === items.length ? sum : null };
    };
    return { key, connectionId: first.connectionId, model: first.model,
      inputKind: details?.inputTokenKind ?? "unknown", outputKind: details?.outputTokenKind ?? "unknown",
      input: counter((item) => item.usage?.inputTokens),
      output: counter((item) => item.usage?.outputTokens),
      cachedInput: counter((item) => item.usage?.tokenDetails?.cachedInputTokens),
      cacheWriteInput: counter((item) => item.usage?.tokenDetails?.cacheWriteInputTokens),
      reasoning: counter((item) => item.usage?.tokenDetails?.reasoningTokens),
      providerTotal: counter((item) => item.usage?.tokenDetails?.totalTokens) };
  });
  return { ownReceipts: own.length, submittedAttempts: submitted.length,
    copiedReceipts: 0,
    pending: own.filter((item) => ["prepared", "submitted"].includes(item.status)).length,
    uncertain: own.filter((item) => ["outcome_unknown", "discarded"].includes(item.status)).length, groups };
}

// Input is one validated branch body. Copied receipts are provenance, not new calls.
export function summarizePrivateUsage(branchId: string, deliveries: readonly PrivateDelivery[]) {
  const own = deliveries.filter((item) => item.originBranchId === branchId);
  const records = own.map((item): PrivateUsageRecord => ({ id: item.id, originBranchId: item.originBranchId,
    connectionId: item.connectionId, model: item.request.model, status: item.status, submittedAt: item.submittedAt,
    usage: item.usage ?? item.result }));
  return { ...summarizePrivateUsageRecords(records), copiedReceipts: deliveries.length - own.length };
}
