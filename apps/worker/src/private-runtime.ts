import { executePrivateDelivery } from "@deliberation-ai/persistence";
import { generatePrivateText, NormalizedProviderError } from "@deliberation-ai/providers";

export async function executeWorkerPrivateDelivery(branchId: string, operationId: string) {
  return executePrivateDelivery(branchId, operationId, async (operation, target, id) => {
    try { return { result: await generatePrivateText(operation.request, { ...target, operationKey: `${id}:${operation.id}` }) }; }
    catch (error) {
      return error instanceof NormalizedProviderError ? { errorCode: error.code, outcome: error.outcome } : { errorCode: "private_provider_interrupted", outcome: "unknown" };
    }
  });
}
