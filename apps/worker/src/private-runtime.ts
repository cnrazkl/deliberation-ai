import { executePrivateDelivery } from "@deliberation-ai/persistence";
import { generatePrivateText, NormalizedProviderError } from "@deliberation-ai/providers";
import { privateDeliveryUsageSchema } from "@deliberation-ai/contracts";

export async function executeWorkerPrivateDelivery(branchId: string, operationId: string) {
  return executePrivateDelivery(branchId, operationId, async (operation, target, id) => {
    try { return { result: await generatePrivateText(operation.request, { ...target, operationKey: `${id}:${operation.id}` }) }; }
    catch (error) {
      if (!(error instanceof NormalizedProviderError)) return { errorCode: "private_provider_interrupted", outcome: "unknown" };
      const usage = error.metadata ? privateDeliveryUsageSchema.safeParse({ model: error.metadata.model,
        remoteResponseId: error.metadata.remoteResponseId || null, inputTokens: error.metadata.inputTokens ?? null,
        outputTokens: error.metadata.outputTokens ?? null, tokenDetails: error.metadata.tokenDetails ?? null }) : null;
      return { errorCode: error.code, outcome: error.outcome, ...(usage?.success ? { usage: usage.data } : {}) };
    }
  });
}
