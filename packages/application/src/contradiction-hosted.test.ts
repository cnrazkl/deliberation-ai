import { expect, it, vi } from "vitest";
import { createHostedContradictionEvaluator } from "./contradiction-hosted";
import type { SynthesisTextPort } from "./synthesis";

const returned = { status: "returned" as const, result: { text: "{}", model: "offline", remoteResponseId: null,
  inputTokens: 20, outputTokens: 10, tokenDetails: null, finishReason: "stop" as const } };
it("journals before one bounded request and after return without promoting wire values", async () => {
  const events: string[] = [];
  const call = vi.fn<SynthesisTextPort["call"]>(async () => { events.push("network"); return returned; });
  const evaluator = createHostedContradictionEvaluator({ identity: "offline", call }, {
    before: async () => { events.push("before"); }, after: async () => { events.push("after"); } });
  expect(await evaluator.evaluate({ instructions: "Test", data: "{}" })).toEqual({});
  expect(events).toEqual(["before", "network", "after"]); expect(call).toHaveBeenCalledTimes(1);
});
it("refuses changed sources, oversized input and unknown/incomplete responses without retry", async () => {
  const call = vi.fn<SynthesisTextPort["call"]>(async () => returned);
  const blocked = createHostedContradictionEvaluator({ identity: "offline", call }, {
    before: async () => { throw new Error("Changed source"); }, after: async () => {} });
  await expect(blocked.evaluate({ instructions: "Test", data: "{}" })).rejects.toThrow();
  await expect(blocked.evaluate({ instructions: "Test", data: "x".repeat(12_001) })).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
  for (const outcome of [{ status: "failed" as const, outcome: "unknown" as const, code: "unknown", inputTokens: null, outputTokens: null },
    { ...returned, result: { ...returned.result, finishReason: "length" as const } },
    { ...returned, result: { ...returned.result, outputTokens: 4_097 } }]) {
    const attempt = vi.fn<SynthesisTextPort["call"]>(async () => outcome);
    const evaluator = createHostedContradictionEvaluator({ identity: "offline", call: attempt }, { before: async () => {}, after: async () => {} });
    await expect(evaluator.evaluate({ instructions: "Test", data: "{}" })).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
  }
});
