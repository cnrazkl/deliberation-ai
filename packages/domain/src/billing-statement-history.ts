import type { BillingStatementChangeInput, BillingStatementState, BillingStatementVersion } from "@deliberation-ai/contracts";
import { usdToPico } from "./billing";
import { picoUsdToUsd } from "./token-cost";

const dollars = (value: bigint): string => value < BigInt(0) ? `-${picoUsdToUsd(-value)}` : picoUsdToUsd(value);

export function validateStatementChange(input: BillingStatementChangeInput): void {
  if (input.action === "record" && (input.packet.connectionId !== input.connectionId || input.packet.statementId !== input.statementId
    || input.packet.documentSha256 !== input.documentSha256 || input.packet.reviewedAt !== input.reviewedAt)) {
    throw new Error("Statement packet identity/evidence/review does not match its revision.");
  }
}
export function foldStatementVersions(versions: readonly BillingStatementVersion[]): BillingStatementState {
  if (!versions.length) throw new Error("Statement history is empty.");
  let previous: BillingStatementVersion | undefined;
  for (const version of versions) {
    const input = version.input;
    validateStatementChange(input);
    if (version.sequence !== (previous?.sequence ?? 0) + 1 || version.sequence > 100 || input.expectedFingerprint !== (previous?.fingerprint ?? null)
      || (previous && (input.connectionId !== previous.input.connectionId || input.statementId !== previous.input.statementId
        || Date.parse(input.reviewedAt) < Date.parse(previous.input.reviewedAt)))) throw new Error("Statement history is incomplete, stale or out of order.");
    if (input.action === "void") {
      if (!previous || version.inspection !== null) throw new Error("A statement must be recorded before withdrawal.");
    } else {
      const inspection = version.inspection;
      if (!inspection || inspection.status !== "reconciled_owner_packet" || inspection.issues.length
        || inspection.connectionId !== input.connectionId || inspection.statementId !== input.statementId || inspection.documentSha256 !== input.documentSha256
        || Date.parse(inspection.inspectedAt) < Date.parse(input.reviewedAt)) throw new Error("Recorded statement inspection is invalid.");
      const attempts = input.packet.lines.filter((line) => line.allocation === "attempt");
      const shared = input.packet.lines.filter((line) => line.allocation === "unallocated");
      const sum = (lines: typeof input.packet.lines): bigint => lines.reduce((total, line) => total + usdToPico(line.amountUsd), BigInt(0));
      if (inspection.declaredTotalUsd !== dollars(usdToPico(input.packet.totalUsd)) || inspection.listedTotalUsd !== dollars(sum(input.packet.lines))
        || inspection.declaredTotalUsd !== inspection.listedTotalUsd || inspection.differenceUsd !== "0.000000000000"
        || inspection.matchedAttempts !== attempts.length || inspection.unallocatedLines !== shared.length
        || inspection.matchedAttemptSubtotalUsd !== (attempts.length ? dollars(sum(attempts)) : null)
        || inspection.unallocatedSubtotalUsd !== (shared.length ? dollars(sum(shared)) : null)) throw new Error("Recorded statement arithmetic is inconsistent.");
    }
    previous = version;
  }
  const head = versions.at(-1)!;
  return { status: head.input.action === "void" ? "voided" : "owner_recorded", head, versions: [...versions],
    effective: head.inspection, packet: head.input.action === "record" ? head.input.packet : null,
    providerAuthenticity: "unverified", paymentStatus: "unknown", monetaryDispatchAllowed: false };
}
