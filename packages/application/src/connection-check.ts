import { providerOutputSchema, type GenerationObservation, type SaveProviderConnectionRequest } from "@deliberation-ai/contracts";
import { executeGenerationCheck, NormalizedProviderError, type ProviderResult } from "@deliberation-ai/providers";
export { generationCheckPrompt, GENERATION_CHECK_TIMEOUT_MS } from "@deliberation-ai/providers";
export type ConnectionCheckExecution = Pick<GenerationObservation, "status" | "failure" | "returnedModel" | "remoteResponseId" | "inputTokens" | "outputTokens" | "httpStatus">;
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
    const normalized = error instanceof NormalizedProviderError ? error : null;
    const unknown = !normalized || normalized.outcome === "unknown";
    const failure = unknown ? "network_unknown" : normalized.code.includes("incomplete") ? "incomplete"
      : normalized.code.includes("invalid") ? "invalid_output" : normalized.code === "provider_not_configured" ? "unavailable" : "rejected";
    const status = normalized?.code.match(/_(\d{3})$/u)?.[1];
    const httpStatus = status && Number(status) >= 400 && Number(status) <= 599 ? Number(status) : null;
    return { ...metadataFields(normalized?.metadata), status: unknown ? "outcome_unknown" : "failed", failure, httpStatus };
  }
}
