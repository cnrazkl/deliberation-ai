import { privateDeliveryRequestSchema, privateDeliveryResultSchema, type PrivateDeliveryRequest, type PrivateDeliveryResult } from "@deliberation-ai/contracts";
import { NormalizedProviderError } from "./index";
import { providerHttpError, providerNetworkError, withProviderNetworkDeadline } from "./provider-utils";
import { extractTokenUsage } from "./token-usage";
import { z } from "zod";

const anthropicReplySchema = z.object({
  type: z.literal("message"), role: z.literal("assistant"),
  content: z.array(z.object({ type: z.literal("text"), text: z.string().max(16_384) })).min(1),
  stop_reason: z.enum(["end_turn", "max_tokens"]),
});

/** Separate plain-text boundary; council schemas/prompts are never reused. */
export async function generatePrivateText(request: PrivateDeliveryRequest, options: {
  provider?: "openai-compatible" | "anthropic"; baseUrl: string; apiKey: string; endpointPreset: string; operationKey: string; fetch?: typeof fetch; timeoutMs?: number;
}): Promise<PrivateDeliveryResult> {
  const input = privateDeliveryRequestSchema.parse(request);
  if (!options.operationKey) throw new NormalizedProviderError("İşlem kimliği gerekli.", "missing_operation_id", "known", false);
  const provider = options.provider ?? "openai-compatible";
  if (provider !== "openai-compatible" && provider !== "anthropic") {
    throw new NormalizedProviderError("Özel gönderim sağlayıcısı desteklenmiyor.", "unsupported_private_provider", "known", false);
  }
  const anthropic = provider === "anthropic";
  const [system, ...messages] = input.messages;
  // Refuse translation that would drop/reorder an instruction or continue an
  // assistant prefill. Consecutive owner turns remain separate, in exact order.
  if (anthropic && (system?.role !== "system" || messages.some((item) => item.role === "system") ||
    messages[0]?.role !== "user" || messages.at(-1)?.role !== "user")) {
    throw new NormalizedProviderError("Özel mesaj sırası geçersiz.", "invalid_private_messages", "known", false);
  }
  const body = anthropic
    ? { model: input.model, system: system!.content, messages, max_tokens: input.maxOutputTokens }
    : { model: input.model, messages: input.messages,
      ...(options.endpointPreset === "openrouter" ? { max_completion_tokens: input.maxOutputTokens } : { max_tokens: input.maxOutputTokens }) };
  const label = anthropic ? "Private Anthropic" : "Private compatible";
  let value: unknown;
  try {
    value = await withProviderNetworkDeadline(async (signal) => {
      const response = await (options.fetch ?? fetch)(`${options.baseUrl.replace(/\/$/, "")}${anthropic ? "/v1/messages" : "/chat/completions"}`, {
        method: "POST", redirect: "error", signal,
        headers: { "content-type": "application/json", "idempotency-key": options.operationKey,
          ...(anthropic ? { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01" }
            : options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
        body: JSON.stringify(body),
      });
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
