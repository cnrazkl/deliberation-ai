import { expect, test } from "vitest";
import { unresolvedProviderOperations } from "./provider-operation-state";
const base = { runId: "run", memberId: "member", round: 0 };
test("consumed retry grants remain historical after a later attempt closes", () => {
  const items = [1, 2, 3].map(attempt => ({ ...base, attempt, status: attempt < 3 ? "retry_authorized" : "discarded" }));
  expect(unresolvedProviderOperations(items)).toEqual([]);
  expect(items[0]?.status).toBe("retry_authorized");
});
test("a later pending attempt still blocks and unconsumed permission still requires a decision", () => {
  const grant = { ...base, attempt: 1, status: "retry_authorized" };
  const later = { ...base, attempt: 2, status: "outcome_unknown" };
  expect(unresolvedProviderOperations([later, grant])).toEqual([later]);
  expect(unresolvedProviderOperations([grant])).toEqual([grant]);
});
test("other runs, members and rounds cannot consume a permission; unknown calls remain unknown", () => {
  const unknown = { ...base, attempt: 1, status: "outcome_unknown" };
  const later = { ...base, attempt: 2, status: "succeeded" };
  expect(unresolvedProviderOperations([unknown, later])).toEqual([unknown]);
  const grant = { ...unknown, status: "retry_authorized" };
  for (const change of [{ runId: "other" }, { memberId: "other" }, { round: 1 }])
    expect(unresolvedProviderOperations([grant, { ...later, ...change }])).toEqual([grant]);
});
