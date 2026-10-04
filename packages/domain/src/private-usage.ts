import type { PrivateDelivery } from "@deliberation-ai/contracts";

export type PrivateUsageCounter = {
  reported: number; attempts: number; knownSubtotal: number | null; total: number | null;
};
// Input is one validated branch body. Copied receipts are provenance, not new calls.
export function summarizePrivateUsage(branchId: string, deliveries: readonly PrivateDelivery[]) {
  const own = deliveries.filter((item) => item.originBranchId === branchId);
  const submitted = own.filter((item) => item.submittedAt !== null || item.result !== null || item.usage != null ||
    ["submitted", "succeeded", "outcome_unknown", "discarded"].includes(item.status));
  const buckets = new Map<string, typeof submitted>();
  for (const item of submitted) {
    const usage = item.usage ?? item.result;
    const key = JSON.stringify([item.connectionId, item.request.model,
      usage?.tokenDetails?.inputTokenKind ?? "unknown", usage?.tokenDetails?.outputTokenKind ?? "unknown"]);
    const bucket = buckets.get(key) ?? []; bucket.push(item); buckets.set(key, bucket);
  }
  const groups = [...buckets].map(([key, items]) => {
    const first = items[0]!; const details = (first.usage ?? first.result)?.tokenDetails;
    const counter = (read: (item: PrivateDelivery) => number | null | undefined): PrivateUsageCounter => {
      const values = items.map(read).filter((value): value is number => value != null);
      const sum = values.reduce((total, value) => total + value, 0);
      return { reported: values.length, attempts: items.length, knownSubtotal: values.length ? sum : null,
        total: values.length === items.length ? sum : null };
    };
    return { key, connectionId: first.connectionId, model: first.request.model,
      inputKind: details?.inputTokenKind ?? "unknown", outputKind: details?.outputTokenKind ?? "unknown",
      input: counter((item) => (item.usage ?? item.result)?.inputTokens),
      output: counter((item) => (item.usage ?? item.result)?.outputTokens),
      cachedInput: counter((item) => (item.usage ?? item.result)?.tokenDetails?.cachedInputTokens),
      cacheWriteInput: counter((item) => (item.usage ?? item.result)?.tokenDetails?.cacheWriteInputTokens),
      reasoning: counter((item) => (item.usage ?? item.result)?.tokenDetails?.reasoningTokens),
      providerTotal: counter((item) => (item.usage ?? item.result)?.tokenDetails?.totalTokens) };
  });
  return { ownReceipts: own.length, submittedAttempts: submitted.length,
    copiedReceipts: deliveries.length - own.length,
    pending: own.filter((item) => ["prepared", "submitted"].includes(item.status)).length,
    uncertain: own.filter((item) => ["outcome_unknown", "discarded"].includes(item.status)).length, groups };
}
