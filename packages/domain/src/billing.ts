import type { BillingState, ProviderBillingChange, ProviderBillingChangeInput, ProviderBillingInput, ProviderBillingRecord, ProviderBillingReallocationInput } from "@deliberation-ai/contracts";

export function usdToPico(value: string): bigint {
  if (!/^-?(0|[1-9]\d{0,8})(\.\d{1,12})?$/u.test(value)) throw new Error("Invalid USD amount.");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return (BigInt(whole!) * BigInt("1000000000000") + BigInt(fraction.padEnd(12, "0"))) * BigInt(negative ? -1 : 1);
}
export function validateBillingAmounts(input: ProviderBillingInput): void {
  let total = BigInt(0);
  for (const component of input.components) {
    const value = usdToPico(component.amountUsd);
    if ((component.kind === "credit" && value > BigInt(0)) || (component.kind !== "credit" && value < BigInt(0))) {
      throw new Error("Only credits may be negative; credits cannot be positive.");
    }
    total += value;
  }
  if (total !== usdToPico(input.totalUsd)) throw new Error("Billing components do not match the declared total.");
}

export function validateBillingReplacement(original: ProviderBillingInput, change: ProviderBillingChangeInput): void {
  if (change.action !== "replace") return;
  const replacement = change.replacement;
  for (const key of ["operationId", "connectionId", "provider", "model", "remoteResponseId", "statementId", "lineId", "attribution", "scope", "currency"] as const) {
    if (original[key] !== replacement[key]) throw new Error("Billing identity and source attribution cannot change.");
  }
  if (replacement.documentSha256 !== change.documentSha256 || replacement.reviewedAt !== change.reviewedAt) throw new Error("Replacement evidence and review must match the change.");
  if (Date.parse(replacement.billedAt) > Date.parse(change.reviewedAt)) throw new Error("Billing dates are unordered.");
  validateBillingAmounts(replacement);
}

export function validateBillingReallocation(source: BillingState, input: ProviderBillingReallocationInput): void {
  if (source.id !== input.sourceRecordId || source.status === "reallocated") throw new Error("Billing source is unavailable for reallocation.");
  if (input.expectedFingerprint !== source.currentFingerprint) throw new Error("Billing reallocation is stale; review the source first.");
  if (input.documentSha256 !== input.replacement.documentSha256 || input.reviewedAt !== input.replacement.reviewedAt) throw new Error("Reallocation evidence/review must match the replacement.");
  if (Date.parse(input.reviewedAt) < Date.parse(source.changes.at(-1)?.reviewedAt ?? source.reviewedAt)
    || Date.parse(input.replacement.billedAt) > Date.parse(input.reviewedAt)) throw new Error("Billing reallocation reviews must be chronological.");
  const keys = ["operationId", "connectionId", "provider", "model", "remoteResponseId", "statementId", "lineId"] as const;
  if (keys.every((key) => source[key] === input.replacement[key])) throw new Error("Use a same-attribution correction when identity has not changed.");
  validateBillingAmounts(input.replacement);
}

export function foldBillingChanges(original: ProviderBillingRecord, changes: readonly ProviderBillingChange[]): BillingState {
  let state: BillingState = { ...original, original, status: "owner_recorded", currentFingerprint: original.fingerprint, changes: [] };
  for (const change of changes) {
    if (change.recordId !== original.id || change.sequence !== state.changes.length + 1 || change.sequence > 100
      || change.expectedFingerprint !== state.currentFingerprint) throw new Error("Billing change chain is incomplete or out of order.");
    validateBillingReplacement(original, change);
    if (Date.parse(change.reviewedAt) < Date.parse(state.changes.at(-1)?.reviewedAt ?? original.reviewedAt)) throw new Error("Billing reviews must be chronological.");
    state = { ...state, ...(change.action === "replace" ? change.replacement : {}),
      status: change.action === "void" ? "voided" : "owner_recorded", currentFingerprint: change.fingerprint, changes: [...state.changes, change] };
  }
  return state;
}
