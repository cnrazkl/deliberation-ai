import { privateDeliveryRequestSchema, privateDeliveryResultSchema, type PrivateDeliveryRequest, type PrivateDeliveryResult } from "@deliberation-ai/contracts";
import { NormalizedProviderError } from "./index";
import { providerHttpError, providerNetworkError, withProviderNetworkDeadline } from "./provider-utils";
import { extractTokenUsage } from "./token-usage";

/** Separate plain-text boundary; council schemas/prompts are never reused. */
export async function generatePrivateText(request: PrivateDeliveryRequest, options: {
  baseUrl: string; apiKey: string; endpointPreset: string; operationKey: string; fetch?: typeof fetch; timeoutMs?: number;
}): Promise<PrivateDeliveryResult> {
  const input = privateDeliveryRequestSchema.parse(request);
  if (!options.operationKey) throw new NormalizedProviderError("İşlem kimliği gerekli.", "missing_operation_id", "known", false);
  const body = { model: input.model, messages: input.messages,
    ...(options.endpointPreset === "openrouter" ? { max_completion_tokens: input.maxOutputTokens } : { max_tokens: input.maxOutputTokens }) };
  let value: unknown;
  try {
    value = await withProviderNetworkDeadline(async (signal) => {
      const response = await (options.fetch ?? fetch)(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", redirect: "error", signal,
        headers: { "content-type": "application/json", "idempotency-key": options.operationKey, ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw providerHttpError("Private compatible", response.status);
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
    throw providerNetworkError("Private compatible");
  }
  const json = value as { id?: unknown; model?: unknown; choices?: Array<{ finish_reason?: string; message?: { content?: unknown; tool_calls?: unknown } }>; usage?: unknown } | null;
  const choice = json?.choices?.[0]; const raw = choice?.message?.content;
  const usage = extractTokenUsage("openai-compatible", json?.usage);
  const parsed = privateDeliveryResultSchema.safeParse({ text: raw, model: typeof json?.model === "string" ? json.model : input.model,
    remoteResponseId: typeof json?.id === "string" ? json.id : null, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null,
    tokenDetails: usage.tokenDetails ?? null, finishReason: choice?.finish_reason === "stop" || choice?.finish_reason === "length" ? choice.finish_reason : "other" });
  if (!parsed.success || choice?.message?.tool_calls) throw new NormalizedProviderError("Özel metin yanıtı geçersiz veya çok büyük.", "invalid_private_response", "known", false);
  return parsed.data;
}
