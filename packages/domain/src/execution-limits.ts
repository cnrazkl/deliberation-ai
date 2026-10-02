import type { ExecutionLimits } from "@deliberation-ai/contracts";

export function plannedProviderCalls(memberCount: number, reviewRounds: number, selectedMemberOnly = false): number {
  return (selectedMemberOnly ? 1 : memberCount) + memberCount * reviewRounds;
}

export function executionPlanFits(limits: ExecutionLimits, calls: number): boolean {
  return limits.maxProviderCalls >= calls && limits.maxReservedOutputTokens >= calls * limits.maxOutputTokensPerCall;
}

export function executionReservationAllowed(limits: ExecutionLimits, submittedCalls: number, reservedOutputTokens: number): boolean {
  return Number.isSafeInteger(submittedCalls) && Number.isSafeInteger(reservedOutputTokens)
    && submittedCalls >= 0 && reservedOutputTokens >= 0 && submittedCalls < limits.maxProviderCalls
    && reservedOutputTokens + limits.maxOutputTokensPerCall <= limits.maxReservedOutputTokens;
}

export class ExecutionPlanLimitsError extends Error {
  constructor() {
    super("Çağrı ve toplam yanıt kotası, seçili tam çalışma planını karşılamıyor.");
    this.name = "ExecutionPlanLimitsError";
  }
}
