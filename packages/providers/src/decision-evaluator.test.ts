import { describe, expect, it, vi } from "vitest";
import type { DecisionAssessmentInput } from "@deliberation-ai/evaluation";
import {
  FakeDecisionEvaluator,
  TypeSafeDecisionEvaluator,
  TYPESAFE_SYSTEM_ONE_URL,
} from "./decision-evaluator";

const input: DecisionAssessmentInput = {
  assessmentId: "00000000-0000-4000-8000-000000000001",
  runId: "00000000-0000-4000-8000-000000000002",
  claimId: "claim-001",
  sourceId: "00000000-0000-4000-8000-000000000003",
  claim: "Planlı bakım süreleri hesaba dahildir.",
  sourceExcerpt: "Planlı bakım süreleri hesaba dahil edilmez.",
  sourcePublishedAt: null,
  sourceCapturedAt: "2026-09-21T12:00:00.000Z",
  rubricVersion: "source-support-v1",
  model: "jev-1.13.0",
};

describe("decision evaluators", () => {
  it("keeps the fake evaluator deterministic and offline", async () => {
    const result = await new FakeDecisionEvaluator("contradicts").evaluate(input);
    expect(result.label).toBe("contradicts");
    expect(result.returnedModel).toBe("deterministic-decision-fixture-v1");
    expect(Object.values(result.probabilities).reduce((sum, value) => sum + value, 0)).toBe(1);
  });

  it("translates the frozen source-support rubric to TypeSafe without retries", async () => {
    const fetcher = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () =>
      Response.json({
        model: "jev-1.13.0",
        answers: {
          source_support: {
            type: "choice",
            choice: "contradicts",
            probabilities: {
              supports: 0.02,
              contradicts: 0.9,
              insufficient_evidence: 0.07,
              not_applicable: 0.01,
            },
            confidence: 0.87,
          },
        },
        usage: { input_tokens: 230, output_tokens: 20 },
      }),
    );
    const evaluator = new TypeSafeDecisionEvaluator({
      apiKey: "secret",
      model: "jev-1.13.0",
      fetcher,
    });
    const result = await evaluator.evaluate(input);
    expect(result).toMatchObject({
      label: "contradicts",
      returnedModel: "jev-1.13.0",
      inputTokens: 230,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(TYPESAFE_SYSTEM_ONE_URL);
    const init = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      state: { claim: string; source_excerpt: string };
      questions: { source_support: { type: string; criteria: Record<string, string> } };
    };
    expect(body.state).toEqual({
      claim: input.claim,
      source_excerpt: input.sourceExcerpt,
      source_published_at: null,
      source_captured_at: input.sourceCapturedAt,
    });
    expect(body.questions.source_support.type).toBe("choice");
    expect(Object.keys(body.questions.source_support.criteria)).toEqual([
      "supports",
      "contradicts",
      "insufficient_evidence",
      "not_applicable",
    ]);
  });

  it("rejects moving aliases and normalizes known versus unknown outcomes", async () => {
    expect(
      () => new TypeSafeDecisionEvaluator({ apiKey: "secret", model: "jev-latest" }),
    ).toThrow(/tam sürümlü/);

    const rejected = new TypeSafeDecisionEvaluator({
      apiKey: "secret",
      model: "jev-1.13.0",
      fetcher: async () => new Response("bad", { status: 422 }),
    });
    await expect(rejected.evaluate(input)).rejects.toMatchObject({
      code: "typesafe_http_422",
      outcome: "known",
    });

    const unknown = new TypeSafeDecisionEvaluator({
      apiKey: "secret",
      model: "jev-1.13.0",
      fetcher: async () => {
        throw new Error("network");
      },
    });
    await expect(unknown.evaluate(input)).rejects.toMatchObject({
      code: "typesafe_network_unknown",
      outcome: "unknown",
    });
  });
});
