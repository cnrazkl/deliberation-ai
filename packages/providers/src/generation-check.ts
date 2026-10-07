import type { SaveProviderConnectionRequest } from "@deliberation-ai/contracts";
import { AnthropicMessagesProvider, GeminiGenerateContentProvider, OpenAICompatibleProvider, OpenAIResponsesProvider,
  NormalizedProviderError, type ProviderRequest, type ProviderResult, type TextProvider } from "./index";
import { inputFor, instructionsFor } from "./provider-utils";

export const GENERATION_CHECK_TIMEOUT_MS = 45_000;
export const GENERATION_CHECK_OUTPUT_TOKENS = 512;
export const GENERATION_CHECK_VERSION = "connection-generation-v1";
type Target = Omit<SaveProviderConnectionRequest, "label" | "id">;
export function generationCheckRequest(operationId: string): ProviderRequest {
  return { operationId, memberId: "connection-check", role: "Kısa bağlantı denemesi", councilRole: "analyst", round: 0,
    maxOutputTokens: GENERATION_CHECK_OUTPUT_TOKENS,
    input: { snapshotId: "00000000-0000-4000-8000-000000000001",
      question: "Bu bir bağlantı denemesidir. 2 + 2 toplamını tek kısa iddia olarak yaz. Özet ve alıntı birer kısa cümle olsun. Harici kaynak kullanma." } };
}
export function generationCheckPrompt() {
  const request = generationCheckRequest("00000000-0000-4000-8000-000000000002");
  return { version: GENERATION_CHECK_VERSION, system: instructionsFor(request), user: inputFor(request),
    maxOutputTokens: GENERATION_CHECK_OUTPUT_TOKENS, timeoutMs: GENERATION_CHECK_TIMEOUT_MS,
    reasoning: "none" as const, webSearch: "off" as const };
}

// Both SDK and HTTP adapters use this bounded reader; no raw error/response escapes.
export function boundedCheckFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, { ...init, redirect: "error" });
    const reader = response.body?.getReader();
    if (!reader) return response;
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 65_536) throw new Error("Generation check response too large.");
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch { await reader.cancel().catch(() => undefined); throw new Error("Generation check response unavailable."); }
    finally { reader.releaseLock(); }
  };
}

export function createGenerationCheckProvider(target: Target, injectedFetch?: typeof fetch): TextProvider {
  const options = { apiKey: target.apiKey, model: target.defaultModel, id: "connection-check", label: "Bağlantı denemesi",
    councilRole: "analyst" as const, reasoningLevel: "none" as const, reasoningProtocol: target.reasoningProtocol,
    webSearchMode: "off" as const, receivesAttachments: false, timeoutMs: GENERATION_CHECK_TIMEOUT_MS,
    fetch: boundedCheckFetch(injectedFetch), ...(target.baseUrl ? { baseUrl: target.baseUrl } : {}) };
  if (target.provider === "openai") return new OpenAIResponsesProvider(options);
  if (target.provider === "anthropic") return new AnthropicMessagesProvider(options);
  if (target.provider === "google") return new GeminiGenerateContentProvider(options);
  if (!target.baseUrl) throw new NormalizedProviderError("Bağlantı adresi eksik.", "provider_not_configured", "known", false);
  return new OpenAICompatibleProvider({ ...options, baseUrl: target.baseUrl,
    endpointPreset: target.endpointPreset, structuredOutputMode: target.structuredOutputMode });
}
export async function executeGenerationCheck(target: Target, operationId: string, injectedFetch?: typeof fetch): Promise<ProviderResult> {
  return createGenerationCheckProvider(target, injectedFetch).generate(generationCheckRequest(operationId));
}
