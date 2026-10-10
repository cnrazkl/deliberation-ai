import { providerOutputSchema, type GenerationObservation, type SaveProviderConnectionRequest } from "@deliberation-ai/contracts";
import { executeGenerationCheck, generateConnectionChatText, NormalizedProviderError, type ProviderResult } from "@deliberation-ai/providers";
export { generationCheckPrompt, GENERATION_CHECK_TIMEOUT_MS } from "@deliberation-ai/providers";
export type ConnectionCheckExecution = Pick<GenerationObservation, "status" | "failure" | "returnedModel" | "remoteResponseId" | "inputTokens" | "outputTokens" | "httpStatus" | "reply" | "replyTruncated" | "errorCode">;
export function connectionChatPrompt(message: string) {
  return { version: "connection-chat-v1", system: "Bu yalnız bir API bağlantı testidir. Kullanıcının mesajını kısa ve açık biçimde yanıtla. Araç veya harici kaynak kullanma.",
    user: message, maxOutputTokens: 512, timeoutMs: 45_000 };
}
function failureFields(error: unknown): ConnectionCheckExecution {
  const normalized = error instanceof NormalizedProviderError ? error : null;
  const unknown = !normalized || normalized.outcome === "unknown";
  const failure = unknown ? "network_unknown" : normalized.code.includes("incomplete") ? "incomplete"
    : normalized.code.includes("invalid") ? "invalid_output" : normalized.code === "provider_not_configured" ? "unavailable" : "rejected";
  const status = normalized?.code.match(/_(\d{3})$/u)?.[1];
  const httpStatus = status && Number(status) >= 400 && Number(status) <= 599 ? Number(status) : null;
  const code = normalized?.code;
  const errorCode = httpStatus ? `provider_http_${httpStatus}` : code && ["provider_timeout", "provider_dns_failure", "provider_connection_refused", "provider_connection_reset", "provider_tls_failure", "provider_response_unreadable", "remote_outcome_unknown", "provider_not_configured", "invalid_private_response", "invalid_response", "empty_response", "response_too_large", "private_output_limit_without_text", "recovery_generation_disabled"].includes(code)
    ? code : unknown ? "remote_outcome_unknown" : "provider_response_invalid";
  return { ...metadataFields(normalized?.metadata), status: unknown ? "outcome_unknown" : "failed", failure, httpStatus, errorCode };
}
function metadataFields(metadata?: ProviderResult["metadata"]) {
  const count = (value?: number) => Number.isSafeInteger(value) && value! >= 0 ? value! : null;
  const text = (value: string | undefined, max: number) => value && value.length <= max ? value : null;
  return { returnedModel: text(metadata?.model, 120), remoteResponseId: text(metadata?.remoteResponseId, 512),
    inputTokens: count(metadata?.inputTokens), outputTokens: count(metadata?.outputTokens) };
}
export async function executeBoundedConnectionCheck(target: SaveProviderConnectionRequest, id: string): Promise<ConnectionCheckExecution> {
  try {
    const result = await executeGenerationCheck(target, id);
    if (!providerOutputSchema.safeParse(result.parsed).success) throw new NormalizedProviderError("Deneme çıktısı geçersiz.", "provider_response_invalid", "known", false);
    return { ...metadataFields(result.metadata), status: "succeeded", failure: null, httpStatus: null };
  } catch (error) {
    return failureFields(error);
  }
}
export async function executeBoundedConnectionChat(target: SaveProviderConnectionRequest, id: string, message: string): Promise<ConnectionCheckExecution> {
  try {
    const prompt = connectionChatPrompt(message);
    const baseUrl = target.baseUrl ?? ({ openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com", google: "https://generativelanguage.googleapis.com/v1beta", "openai-compatible": "" }[target.provider]);
    if (!baseUrl) throw new NormalizedProviderError("Bağlantı adresi eksik.", "provider_not_configured", "known", false);
    const result = await generateConnectionChatText({ model: target.defaultModel, instructions: prompt.system, message: prompt.user },
    { provider: target.provider, apiKey: target.apiKey, baseUrl, endpointPreset: target.endpointPreset, operationKey: id, timeoutMs: prompt.timeoutMs });
    if (result.finishReason === "other") throw new NormalizedProviderError("Deneme yanıtı tamamlanmadı.", "invalid_private_response", "known", false);
    return { ...metadataFields({ provider: target.provider, model: result.model, remoteResponseId: result.remoteResponseId ?? "",
      ...(result.inputTokens === null ? {} : { inputTokens: result.inputTokens }), ...(result.outputTokens === null ? {} : { outputTokens: result.outputTokens }) }),
      status: "succeeded", failure: null, httpStatus: null, errorCode: null, reply: result.text, replyTruncated: result.finishReason === "length" };
  } catch (error) { return failureFields(error); }
}
