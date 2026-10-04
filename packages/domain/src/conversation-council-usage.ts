import type { ProviderTokenDetails } from "@deliberation-ai/contracts";
import type { PrivateUsageCounter } from "./private-usage";

export type CouncilUsageRecord = { id: string; provider: string; model: string; round: number; status: string;
  inputTokens: number | null; outputTokens: number | null; tokenDetails: ProviderTokenDetails | null };
export function summarizeConversationCouncilUsage(records: readonly CouncilUsageRecord[]) {
  if (new Set(records.map((item) => item.id)).size !== records.length) throw new Error("Duplicate council usage receipt");
  const buckets = new Map<string, CouncilUsageRecord[]>();
  for (const record of records) {
    const key = JSON.stringify([record.provider, record.model, record.round,
      record.tokenDetails?.inputTokenKind ?? "unknown", record.tokenDetails?.outputTokenKind ?? "unknown"]);
    const bucket = buckets.get(key) ?? []; bucket.push(record); buckets.set(key, bucket);
  }
  const groups = [...buckets].map(([key, items]) => {
    const first = items[0]!;
    const counter = (read: (item: CouncilUsageRecord) => number | null | undefined): PrivateUsageCounter => {
      const values = items.map(read).filter((value): value is number => value != null);
      if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error("Invalid council usage counter");
      const sum = values.reduce((total, value) => total + value, 0);
      if (!Number.isSafeInteger(sum)) throw new Error("Council usage subtotal exceeds safe integer range");
      return { reported: values.length, attempts: items.length, knownSubtotal: values.length ? sum : null,
        total: values.length === items.length ? sum : null };
    };
    return { key, provider: first.provider, model: first.model, round: first.round,
      inputKind: first.tokenDetails?.inputTokenKind ?? "unknown", outputKind: first.tokenDetails?.outputTokenKind ?? "unknown",
      input: counter((item) => item.inputTokens), output: counter((item) => item.outputTokens),
      cachedInput: counter((item) => item.tokenDetails?.cachedInputTokens), cacheWriteInput: counter((item) => item.tokenDetails?.cacheWriteInputTokens),
      reasoning: counter((item) => item.tokenDetails?.reasoningTokens), toolInput: counter((item) => item.tokenDetails?.toolInputTokens),
      providerTotal: counter((item) => item.tokenDetails?.totalTokens) };
  });
  return { operationCount: records.length, pending: records.filter((item) => ["prepared", "submitted", "retry_authorized"].includes(item.status)).length,
    uncertain: records.filter((item) => ["outcome_unknown", "discarded", "retry_authorized"].includes(item.status)).length, groups };
}
