type OperationState = { runId: string; memberId: string; round: number; attempt: number; status: string };
/** A consumed retry permission is historical; the later attempt carries current state. */
export function unresolvedProviderOperations<T extends OperationState>(operations: readonly T[]): T[] {
  const latest = new Map<string, number>();
  const key = (item: OperationState) => JSON.stringify([item.runId, item.memberId, item.round]);
  for (const item of operations) latest.set(key(item), Math.max(latest.get(key(item)) ?? 0, item.attempt));
  return operations.filter(item => ["prepared", "submitted", "outcome_unknown", "retry_authorized"].includes(item.status)
    && !(item.status === "retry_authorized" && latest.get(key(item))! > item.attempt));
}
