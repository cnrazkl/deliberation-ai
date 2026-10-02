import { describe, expect, it } from "vitest";
import { executionPlanFits, executionReservationAllowed, plannedProviderCalls } from "./execution-limits";

const limits = { version: "dispatch-limits-v1" as const, maxProviderCalls: 4, maxOutputTokensPerCall: 128, maxReservedOutputTokens: 512 };
describe("execution limits", () => {
  it("requires capacity for the full plan, including all peer review calls", () => {
    expect(plannedProviderCalls(2, 1)).toBe(4);
    expect(plannedProviderCalls(2, 1, true)).toBe(3);
    expect(executionPlanFits(limits, 4)).toBe(true);
    expect(executionPlanFits(limits, 5)).toBe(false);
    expect(executionPlanFits({ ...limits, maxReservedOutputTokens: 384 }, 4)).toBe(false);
  });
  it("admits only whole permanent reservations and fails closed on invalid counters", () => {
    expect(executionReservationAllowed(limits, 3, 384)).toBe(true);
    expect(executionReservationAllowed(limits, 4, 512)).toBe(false);
    expect(executionReservationAllowed(limits, 3, 385)).toBe(false);
    expect(executionReservationAllowed(limits, -1, 0)).toBe(false);
    expect(executionReservationAllowed(limits, 0, Number.NaN)).toBe(false);
  });
});
