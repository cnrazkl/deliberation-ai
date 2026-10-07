import { NVIDIA_HOSTED_BASE_URL, privateDeliveryRequestSchema, privateDeliveryResultSchema, type PrivateDeliveryRequest, type PrivateDeliveryResult } from "@deliberation-ai/contracts";
import { NormalizedProviderError } from "./index";
import { assertRecoveryGenerationAllowed, providerHttpError, providerNetworkError, withProviderNetworkDeadline } from "./provider-utils";
import { extractTokenUsage } from "./token-usage";
import { z } from "zod";

const anthropicReplySchema = z.object({
  type: z.literal("message"), role: z.literal("assistant"),
  content: z.array(z.object({ type: z.literal("text"), text: z.string().max(16_384) })).min(1),
  stop_reason: z.enum(["end_turn", "max_tokens"]),
});
const openaiItemStatus = z.enum(["completed", "incomplete"]);
const geminiReplySchema = z.object({
  error: z.null().optional(),
  promptFeedback: z.object({ blockReason: z.literal("BLOCK_REASON_UNSPECIFIED").optional(),
    safetyRatings: z.array(z.object({ blocked: z.literal(false).optional() })).optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.enum(["STOP", "MAX_TOKENS"]),
    content: z.object({ role: z.literal("model"), parts: z.array(z.object({
      text: z.string().max(16_384), thought: z.literal(false).optional(),
      // Opaque state is accepted only on a plain text part and never retained.
      thoughtSignature: z.string().max(131_072).optional(),
    }).strict()) }).optional(),
    safetyRatings: z.array(z.object({ blocked: z.literal(false).optional() })).optional(),
    groundingMetadata: z.never().optional(), urlContextMetadata: z.never().optional(),
    groundingAttributions: z.array(z.never()).max(0).optional(),
  })).length(1),
});
const openaiReplySchema = z.object({
  object: z.literal("response"), status: z.enum(["completed", "incomplete"]),
  error: z.null().optional(),
  incomplete_details: z.object({ reason: z.literal("max_output_tokens") }).nullable().optional(),
  output: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("message"), role: z.literal("assistant"), status: openaiItemStatus,
      phase: z.literal("final_answer").nullable().optional(),
      content: z.array(z.object({ type: z.literal("output_text"), text: z.string().max(16_384),
        annotations: z.array(z.never()).max(0).optional() })).min(1) }),
    // Default reasoning can produce an opaque envelope. Never promote it to
    // visible text or replay it as provider-managed continuation state.
    z.object({ type: z.literal("reasoning"), summary: z.array(z.never()).max(0),
      content: z.array(z.never()).max(0).optional(), encrypted_content: z.string().max(131_072).nullable().optional(),
      status: openaiItemStatus.optional() }),
  ])).min(1),
}).superRefine((reply, ctx) => {
  if (reply.status === "incomplete" ? !reply.incomplete_details : Boolean(reply.incomplete_details)) ctx.addIssue({ code: "custom", message: "Invalid completion boundary" });
  if (reply.status === "completed" && reply.output.some((item) => item.status === "incomplete")) ctx.addIssue({ code: "custom", message: "Unfinished output item" });
});

/** Separate plain-text boundary; council schemas/prompts are never reused. */
export async function generatePrivateText(request: PrivateDeliveryRequest, options: {
  provider?: "openai-compatible" | "anthropic" | "openai" | "google"; baseUrl: string; apiKey: string; endpointPreset: string; operationKey: string; fetch?: typeof fetch; timeoutMs?: number;
}): Promise<PrivateDeliveryResult> {
  assertRecoveryGenerationAllowed();
  const input = privateDeliveryRequestSchema.parse(request);
  if (!options.operationKey) throw new NormalizedProviderError("İşlem kimliği gerekli.", "missing_operation_id", "known", false);
  const provider = options.provider ?? "openai-compatible";
  if (options.endpointPreset === "nvidia" && (provider !== "openai-compatible" || options.baseUrl !== NVIDIA_HOSTED_BASE_URL || !options.apiKey.trim())) {
    throw new NormalizedProviderError("NVIDIA hosted bağlantısı geçersiz.", "nvidia_settings_not_supported", "known", false);
  }
  if (provider !== "openai-compatible" && provider !== "anthropic" && provider !== "openai" && provider !== "google") {
    throw new NormalizedProviderError("Özel gönderim sağlayıcısı desteklenmiyor.", "unsupported_private_provider", "known", false);
  }
  const anthropic = provider === "anthropic";
  const responses = provider === "openai";
  const gemini = provider === "google";
  const [system, ...messages] = input.messages;
  // Refuse translation that would drop/reorder an instruction or continue an
  // assistant prefill. Consecutive owner turns remain separate, in exact order.
  if ((anthropic || responses || gemini) && (system?.role !== "system" || messages.some((item) => item.role === "system") ||
    messages[0]?.role !== "user" || messages.at(-1)?.role !== "user")) {
    throw new NormalizedProviderError("Özel mesaj sırası geçersiz.", "invalid_private_messages", "known", false);
  }
  const body = gemini
    ? { systemInstruction: { parts: [{ text: system!.content }] },
      contents: messages.map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] })),
      generationConfig: { candidateCount: 1, maxOutputTokens: input.maxOutputTokens, responseMimeType: "text/plain" } }
    : responses
    ? { model: input.model, input: input.messages.map((item) => item.role === "assistant" ? { ...item, phase: "final_answer" } : item),
      max_output_tokens: input.maxOutputTokens, store: false, background: false, stream: false,
      truncation: "disabled", text: { format: { type: "text" } } }
    : anthropic
    ? { model: input.model, system: system!.content, messages, max_tokens: input.maxOutputTokens }
    : { model: input.model, messages: input.messages,
      ...(options.endpointPreset === "openrouter" ? { max_completion_tokens: input.maxOutputTokens } : { max_tokens: input.maxOutputTokens }) };
  const label = gemini ? "Private Gemini" : responses ? "Private OpenAI" : anthropic ? "Private Anthropic" : "Private compatible";
  let value: unknown;
  try {
    value = await withProviderNetworkDeadline(async (signal) => {
      const response = await (options.fetch ?? fetch)(`${options.baseUrl.replace(/\/$/, "")}${gemini ? `/models/${encodeURIComponent(input.model)}:generateContent` : responses ? "/responses" : anthropic ? "/v1/messages" : "/chat/completions"}`, {
        method: "POST", redirect: "error", signal,
        headers: { "content-type": "application/json", "idempotency-key": options.operationKey,
          ...(gemini ? { "x-goog-api-key": options.apiKey, "x-goog-request-id": options.operationKey }
            : anthropic ? { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01" }
            : options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
        body: JSON.stringify(body),
      });
      if (options.endpointPreset === "nvidia" && response.status === 202) throw providerNetworkError("NVIDIA hosted (pending)");
      if (!response.ok) throw providerHttpError(label, response.status);
      const reader = response.body?.getReader(); if (!reader) throw new NormalizedProviderError("Yanıt boş.", "empty_response", "known", false);
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 131_072) { await reader.cancel(); throw new NormalizedProviderError("Yanıt sınırı aşıldı.", "response_too_large", "known", false); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
      catch { throw new NormalizedProviderError("Yanıt okunamadı.", "invalid_response", "known", false); }
    }, options.timeoutMs ?? 90_000);
  } catch (error) {
    if (error instanceof NormalizedProviderError) throw error;
    throw providerNetworkError(label);
  }
  if (anthropic) return normalizeAnthropicReply(value, input.model);
  if (responses) return normalizeOpenAIReply(value, input.model);
  if (gemini) return normalizeGeminiReply(value, input.model);
  const json = value as { id?: unknown; model?: unknown; choices?: Array<{ finish_reason?: string; message?: { content?: unknown; tool_calls?: unknown } }>; usage?: unknown } | null;
  const choice = json?.choices?.[0]; const raw = choice?.message?.content;
  const usage = extractTokenUsage("openai-compatible", json?.usage);
  const parsed = privateDeliveryResultSchema.safeParse({ text: raw, model: typeof json?.model === "string" ? json.model : input.model,
    remoteResponseId: typeof json?.id === "string" ? json.id : null, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null,
    tokenDetails: usage.tokenDetails ?? null, finishReason: choice?.finish_reason === "stop" || choice?.finish_reason === "length" ? choice.finish_reason : "other" });
  if (!parsed.success || choice?.message?.tool_calls) throw new NormalizedProviderError("Özel metin yanıtı geçersiz veya çok büyük.", "invalid_private_response", "known", false, undefined, {
    provider: "openai-compatible", model: typeof json?.model === "string" ? json.model : input.model,
    remoteResponseId: typeof json?.id === "string" ? json.id : "", ...usage,
  });
  return parsed.data;
}

function normalizeGeminiReply(value: unknown, requestedModel: string): PrivateDeliveryResult {
  const json = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const usage = extractTokenUsage("google", json.usageMetadata);
  const model = typeof json.modelVersion === "string" ? json.modelVersion : requestedModel;
  const remoteResponseId = typeof json.responseId === "string" ? json.responseId : null;
  const metadata = { provider: "google", model, remoteResponseId: remoteResponseId ?? "", ...usage };
  const candidates = json.candidates;
  if (Array.isArray(candidates) && candidates.length === 1 && candidates[0] && typeof candidates[0] === "object" &&
    (candidates[0].finishReason === undefined || candidates[0].finishReason === "FINISH_REASON_UNSPECIFIED")) {
    throw new NormalizedProviderError("Uzaktaki işlem henüz tamamlanmadı.", "private_remote_pending", "unknown", false, undefined, metadata);
  }
  const native = geminiReplySchema.safeParse(value);
  const candidate = native.success ? native.data.candidates[0] : undefined;
  const text = candidate?.content?.parts.map((part) => part.text).join("");
  const parsed = privateDeliveryResultSchema.safeParse({ text, model, remoteResponseId,
    inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null,
    tokenDetails: usage.tokenDetails, finishReason: candidate?.finishReason === "MAX_TOKENS" ? "length" : "stop" });
  if (!native.success || !parsed.success) throw new NormalizedProviderError(
    "Özel metin yanıtı geçersiz, boş veya çok büyük.",
    native.success && candidate?.finishReason === "MAX_TOKENS" && !text ? "private_output_limit_without_text" : "invalid_private_response",
    "known", false, undefined, metadata,
  );
  return parsed.data;
}

function normalizeAnthropicReply(value: unknown, requestedModel: string): PrivateDeliveryResult {
  const json = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const usage = extractTokenUsage("anthropic", json.usage);
  const model = typeof json.model === "string" ? json.model : requestedModel;
  const remoteResponseId = typeof json.id === "string" ? json.id : null;
  const native = anthropicReplySchema.safeParse(value);
  const parsed = privateDeliveryResultSchema.safeParse({
    text: native.success ? native.data.content.map((part) => part.text).join("") : undefined,
    model, remoteResponseId, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null,
    tokenDetails: usage.tokenDetails, finishReason: native.success && native.data.stop_reason === "max_tokens" ? "length" : "stop",
  });
  if (!native.success || !parsed.success) throw new NormalizedProviderError(
    "Özel metin yanıtı geçersiz veya çok büyük.", "invalid_private_response", "known", false, undefined,
    { provider: "anthropic", model, remoteResponseId: remoteResponseId ?? "", ...usage },
  );
  return parsed.data;
}

function normalizeOpenAIReply(value: unknown, requestedModel: string): PrivateDeliveryResult {
  const json = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const usage = extractTokenUsage("openai", json.usage);
  const model = typeof json.model === "string" ? json.model : requestedModel;
  const remoteResponseId = typeof json.id === "string" ? json.id : null;
  const metadata = { provider: "openai", model, remoteResponseId: remoteResponseId ?? "", ...usage };
  if (json.status === "queued" || json.status === "in_progress") throw new NormalizedProviderError(
    "Uzaktaki işlem henüz tamamlanmadı.", "private_remote_pending", "unknown", false, undefined, metadata,
  );
  const native = openaiReplySchema.safeParse(value);
  const text = native.success ? native.data.output.flatMap((item) => item.type === "message" ? item.content.map((part) => part.text) : []).join("") : undefined;
  const parsed = privateDeliveryResultSchema.safeParse({
    text, model, remoteResponseId, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null,
    tokenDetails: usage.tokenDetails, finishReason: native.success && native.data.status === "incomplete" ? "length" : "stop",
  });
  if (!native.success || !parsed.success) throw new NormalizedProviderError(
    "Özel metin yanıtı geçersiz, boş veya çok büyük.",
    native.success && native.data.status === "incomplete" && !text ? "private_output_limit_without_text" : "invalid_private_response",
    "known", false, undefined, metadata,
  );
  return parsed.data;
}
