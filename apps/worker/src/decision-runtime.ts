import {
  completeDecisionAssessment,
  failDecisionAssessment,
  loadDecisionConnectionSecret,
  loadDecisionOperationResult,
  prepareDecisionOperation,
  startDecisionAssessment,
  updateDecisionOperation,
} from "@deliberation-ai/persistence";
import {
  DecisionProviderError,
  TypeSafeDecisionEvaluator,
} from "@deliberation-ai/providers";

export async function executeWorkerDecisionAssessment(
  assessmentId: string,
): Promise<"missing" | "completed" | "failed" | "outcome_unknown" | "cancelled"> {
  const work = await startDecisionAssessment(assessmentId);
  if (!work) return "missing";
  const connection = await loadDecisionConnectionSecret(work.connectionId);
  if (!connection) {
    await failDecisionAssessment(assessmentId, "failed", "decision_connection_missing");
    return "failed";
  }
  const evaluator = new TypeSafeDecisionEvaluator({
    apiKey: connection.apiKey,
    model: work.input.model,
  });
  const operation = await prepareDecisionOperation({
    assessmentId,
    provider: evaluator.provider,
    model: evaluator.model,
    requestFingerprint: work.requestFingerprint,
  });

  if (operation.status === "succeeded") {
    const stored = await loadDecisionOperationResult(operation.id);
    if (!stored) {
      await failDecisionAssessment(assessmentId, "outcome_unknown", "decision_result_missing");
      return "outcome_unknown";
    }
    return (await completeDecisionAssessment(assessmentId, stored)) ? "completed" : "cancelled";
  }
  if (operation.status === "submitted" || operation.status === "outcome_unknown") {
    await failDecisionAssessment(assessmentId, "outcome_unknown", "remote_outcome_unknown");
    return "outcome_unknown";
  }
  if (operation.status === "failed" || operation.status === "discarded") {
    await failDecisionAssessment(
      assessmentId,
      "failed",
      operation.errorCode ?? (operation.status === "discarded" ? "operator_discarded" : "decision_failed"),
    );
    return "failed";
  }

  await updateDecisionOperation(operation.id, { status: "submitted" });
  try {
    const result = await evaluator.evaluate(work.input);
    await updateDecisionOperation(operation.id, { status: "succeeded", result });
    return (await completeDecisionAssessment(assessmentId, result)) ? "completed" : "cancelled";
  } catch (error) {
    const normalized =
      error instanceof DecisionProviderError
        ? error
        : new DecisionProviderError(
            "Karar sağlayıcısının sonucu belirlenemedi.",
            "decision_unexpected_unknown",
            "unknown",
          );
    const status = normalized.outcome === "unknown" ? "outcome_unknown" : "failed";
    await updateDecisionOperation(operation.id, {
      status,
      errorCode: normalized.code,
    });
    await failDecisionAssessment(assessmentId, status, normalized.code);
    return status;
  }
}
