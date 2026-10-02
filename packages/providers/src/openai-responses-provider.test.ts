import OpenAI from "openai";
import { describe, expect, test, vi } from "vitest";
import { NormalizedProviderError } from "./index";
import { OpenAIResponsesProvider } from "./openai-responses-provider";

describe("OpenAIResponsesProvider", () => {
  test("uses structured Responses output without provider storage", async () => {
    const parse = vi.fn().mockResolvedValue({
      id: "resp_test",
      model: "test-model",
      status: "completed",
      output_text: '{"summary":"Özet","claims":[]}',
      output_parsed: {
        summary: "Özet",
        claims: [{ statement: "İddia", kind: "recommendation", quote: "İddia" }],
      },
      output: [
        {
          type: "web_search_call",
          action: { sources: [{ url: "https://example.com/kaynak", title: "Örnek kaynak" }] },
        },
      ],
      usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20,
        input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 3 } },
    });
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-key-never-sent",
      model: "test-model",
      id: "member-a",
      label: "OpenAI A",
      councilRole: "analyst",
      reasoningLevel: "high",
      reasoningProtocol: "openai",
      webSearchMode: "auto",
      client: { responses: { parse } } as unknown as OpenAI,
    });

    const result = await provider.generate({
      memberId: "member-a",
      role: "independent analyst",
      councilRole: "analyst",
      round: 0,
      operationId: "operation-123",
      input: { snapshotId: "snapshot-1", question: "Yeterince uzun bir test sorusu" },
    });

    expect(result.parsed.claims).toHaveLength(1);
    expect(result.metadata).toMatchObject({
      remoteResponseId: "resp_test",
      inputTokens: 12,
      tokenDetails: { totalTokens: 20, cachedInputTokens: 4, reasoningTokens: 3 },
      citations: [{ url: "https://example.com/kaynak", title: "Örnek kaynak" }],
    });
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        store: false,
        max_output_tokens: 2_000,
        reasoning: { effort: "high" },
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        max_tool_calls: 3,
      }),
      { idempotencyKey: "operation-123" },
    );
  });

  test("sends the frozen request cap in preference to the configured legacy cap", async () => {
    const output = { summary: "Özet", claims: [{ statement: "İddia", kind: "risk", quote: "İddia" }] };
    const parse = vi.fn().mockResolvedValue({
      id: "resp_bounded", model: "test-model", status: "completed",
      output_text: JSON.stringify(output), output_parsed: output,
    });
    const provider = new OpenAIResponsesProvider({
      apiKey: "not-sent", model: "test-model", id: "member-a", label: "Bounded",
      councilRole: "analyst", reasoningLevel: "high", reasoningProtocol: "openai",
      maxOutputTokens: 4_096, client: { responses: { parse } } as unknown as OpenAI,
    });
    for (const maxOutputTokens of [128, 32_768]) {
      await provider.generate({
        memberId: "member-a", role: "analyst", councilRole: "analyst", round: 0,
        operationId: "bounded-operation", maxOutputTokens,
        input: { snapshotId: "snapshot-1", question: "Yeterince uzun bir test sorusu" },
      });
      expect(parse).toHaveBeenLastCalledWith(expect.objectContaining({
        max_output_tokens: maxOutputTokens, reasoning: { effort: "high" },
      }), { idempotencyKey: "bounded-operation" });
    }
    expect(parse).toHaveBeenCalledTimes(2);
  });

  test("rejects invalid request caps before invoking the OpenAI client", async () => {
    const parse = vi.fn();
    const provider = new OpenAIResponsesProvider({
      apiKey: "not-sent", model: "test-model", id: "member-a", label: "Bounded",
      councilRole: "analyst", reasoningLevel: "default", reasoningProtocol: "openai",
      client: { responses: { parse } } as unknown as OpenAI,
    });
    for (const maxOutputTokens of [0, 127, 32_769, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(provider.generate({
        memberId: "member-a", role: "analyst", councilRole: "analyst", round: 0,
        operationId: "bounded-operation", maxOutputTokens,
        input: { snapshotId: "snapshot-1", question: "Yeterince uzun bir test sorusu" },
      })).rejects.toMatchObject({ code: "invalid_output_token_limit", outcome: "known", retryable: false });
    }
    expect(parse).not.toHaveBeenCalled();
  });

  test("refuses a remote call without a durable operation id", async () => {
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-key-never-sent",
      model: "test-model",
      id: "member-a",
      label: "OpenAI A",
      councilRole: "analyst",
      reasoningLevel: "default",
      reasoningProtocol: "openai",
      client: { responses: { parse: vi.fn() } } as unknown as OpenAI,
    });
    await expect(
      provider.generate({
        memberId: "member-a",
        role: "independent analyst",
        councilRole: "analyst",
        round: 0,
        input: { snapshotId: "snapshot-1", question: "Yeterince uzun bir test sorusu" },
      }),
    ).rejects.toMatchObject({ code: "missing_operation_id" } satisfies Partial<NormalizedProviderError>);
  });

  test("retains structured peer review and opt-in self-revision fields", async () => {
    const parsed = {
      summary: "İnceleme", claims: [{ statement: "Koşul eksik", kind: "objection", quote: "İlk iddia",
        targetMemberId: "peer-b", reviewStance: "qualify" }],
      selfRevisions: [{ sourceClaimIndex: 0, action: "qualify", statement: "İlk iddia, koşul sağlanırsa", reason: "Koşul eksik" }],
    };
    const parse = vi.fn().mockResolvedValue({ id: "resp_review", model: "test-model", status: "completed",
      output_text: JSON.stringify(parsed), output_parsed: parsed });
    const provider = new OpenAIResponsesProvider({ apiKey: "test-key-never-sent", model: "test-model", id: "member-a",
      label: "OpenAI A", councilRole: "analyst", reasoningLevel: "default", reasoningProtocol: "openai",
      client: { responses: { parse } } as unknown as OpenAI });
    const result = await provider.generate({ memberId: "member-a", role: "independent analyst", councilRole: "analyst",
      round: 1, operationId: "operation-review", input: { snapshotId: "snapshot-1", question: "Yeterince uzun bir test sorusu" },
      reviewContext: { peers: [{ memberId: "peer-b", label: "B", councilRole: "analyst", summary: "Diğer",
        claims: [{ statement: "İlk iddia", kind: "risk", quote: "İlk iddia" }] }],
        selfRevision: { ownInitial: { summary: "İlk", claims: [{ statement: "İlk iddia", kind: "risk", quote: "İlk iddia" }] } } },
    });
    expect(result.parsed).toMatchObject(parsed);
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ text: expect.objectContaining({
      format: expect.objectContaining({ name: "council_cross_review" }),
    }) }), { idempotencyKey: "operation-review" });
  });
});
