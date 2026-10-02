import { executeCouncil, executeFakeCouncil } from "@deliberation-ai/application";
import {
  fingerprintProviderRequest,
  claimProviderOperationSubmission,
  ExecutionLimitsExceededError,
  loadProviderConnectionSecret,
  loadProviderOperationResult,
  loadProviderOperationFailureRawText,
  prepareProviderOperation,
  updateProviderOperation,
  type DurableRunWork,
} from "@deliberation-ai/persistence";
import {
  NormalizedProviderError,
  AnthropicMessagesProvider,
  GeminiGenerateContentProvider,
  OpenAICompatibleProvider,
  OpenAIResponsesProvider,
  type ProviderRequest,
  type ProviderResult,
  type TextProvider,
} from "@deliberation-ai/providers";

class UnavailableProvider implements TextProvider {
  readonly role?: string;
  readonly councilRole: TextProvider["councilRole"];
  readonly receivesAttachments = false;

  constructor(
    readonly id: string,
    readonly label: string,
    councilRole: TextProvider["councilRole"],
    role?: string,
  ) {
    this.councilRole = councilRole;
    if (role !== undefined) this.role = role;
  }

  async generate(): Promise<ProviderResult> {
    throw new NormalizedProviderError(
      "Sağlayıcı bağlantısı yerel ayarlarda yapılandırılmamış veya üye seçimiyle eşleşmiyor.",
      "provider_not_configured",
      "known",
      false,
    );
  }
}

export class ReceiptTrackedProvider implements TextProvider {
  readonly id: string;
  readonly label: string;
  readonly role?: string;
  readonly councilRole: TextProvider["councilRole"];
  readonly receivesAttachments: boolean;

  constructor(
    private readonly runId: string,
    private readonly provider: string,
    private readonly model: string,
    private readonly webSearchMode: "off" | "auto",
    private readonly delegate: TextProvider,
    role?: string,
    private readonly maxOutputTokens?: number,
    private readonly pricingConnection?: { id: string; revision: number },
  ) {
    this.id = delegate.id;
    this.label = delegate.label;
    this.councilRole = delegate.councilRole;
    this.receivesAttachments = delegate.receivesAttachments === true;
    if (role !== undefined) this.role = role;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    const requestFingerprint = fingerprintProviderRequest({
      memberId: request.memberId,
      role: request.role,
      councilRole: request.councilRole,
      input: request.input,
      round: request.round,
      reviewContext: request.reviewContext,
      provider: this.provider,
      model: this.model,
      webSearchMode: this.webSearchMode,
      ...(this.maxOutputTokens !== undefined ? { maxOutputTokens: this.maxOutputTokens } : {}),
    });
    const operation = await prepareProviderOperation({
      runId: this.runId,
      memberId: this.id,
      provider: this.provider,
      model: this.model,
      requestFingerprint,
      round: request.round,
    });

    if (operation.status === "succeeded") {
      const stored = await loadProviderOperationResult(operation.id);
      if (stored) return stored;
      throw new NormalizedProviderError(
        "Başarılı sağlayıcı makbuzunun şifreli sonucu bulunamadı.",
        "provider_result_missing",
        "unknown",
        false,
      );
    }
    if (operation.status === "submitted" || operation.status === "outcome_unknown") {
      throw new NormalizedProviderError(
        "Önceki sağlayıcı çağrısının sonucu bilinmiyor; otomatik tekrar engellendi.",
        "remote_outcome_unknown",
        "unknown",
        false,
      );
    }
    if (operation.status === "failed" || operation.status === "discarded") {
      throw new NormalizedProviderError(
        operation.status === "discarded"
          ? "Belirsiz sağlayıcı çağrısı operatör tarafından başarısız sayıldı."
          : "Önceki sağlayıcı çağrısı kesin hata ile sonuçlandı.",
        operation.errorCode ??
          (operation.status === "discarded" ? "operator_discarded" : "provider_failed"),
        "known",
        false,
        operation.status === "failed" ? await loadProviderOperationFailureRawText(operation.id) : undefined,
      );
    }

    let claimed: boolean;
    try {
      claimed = await claimProviderOperationSubmission(operation.id, this.maxOutputTokens, this.pricingConnection);
    } catch (error) {
      if (!(error instanceof ExecutionLimitsExceededError)) throw error;
      await updateProviderOperation(operation.id, { status: "failed", errorCode: error.code });
      throw new NormalizedProviderError(error.message, error.code, "known", false);
    }
    if (!claimed) {
      throw new NormalizedProviderError(
        "Sağlayıcı çağrısı başka bir işçi tarafından başlatıldı; otomatik tekrar engellendi.",
        "remote_outcome_unknown",
        "unknown",
        false,
      );
    }
    try {
      const result = await this.delegate.generate({ ...request, operationId: operation.id,
        ...(this.maxOutputTokens !== undefined ? { maxOutputTokens: this.maxOutputTokens } : {}),
      });
      await updateProviderOperation(operation.id, {
        status: "succeeded",
        remoteResponseId: result.metadata?.remoteResponseId ?? "local-result",
        ...(result.metadata?.inputTokens !== undefined
          ? { inputTokens: result.metadata.inputTokens }
          : {}),
        ...(result.metadata?.outputTokens !== undefined
          ? { outputTokens: result.metadata.outputTokens }
          : {}),
        rawText: result.rawText,
        parsedOutput: result.parsed,
        ...(result.metadata ? { metadata: result.metadata } : {}),
      });
      return result;
    } catch (error) {
      const normalized =
        error instanceof NormalizedProviderError
          ? error
          : new NormalizedProviderError(
              "Sağlayıcı adaptöründe beklenmeyen hata oluştu.",
              "provider_unexpected",
              "known",
              false,
            );
      await updateProviderOperation(operation.id, {
        status: normalized.outcome === "unknown" ? "outcome_unknown" : "failed",
        errorCode: normalized.code,
        ...(normalized.metadata ? {
          metadata: normalized.metadata, remoteResponseId: normalized.metadata.remoteResponseId,
          ...(normalized.metadata.inputTokens !== undefined ? { inputTokens: normalized.metadata.inputTokens } : {}),
          ...(normalized.metadata.outputTokens !== undefined ? { outputTokens: normalized.metadata.outputTokens } : {}),
        } : {}),
        ...(normalized.outcome === "known" && normalized.rawText !== undefined
          ? { rawText: normalized.rawText }
          : {}),
      });
      throw normalized;
    }
  }
}

export async function executeWorkerCouncil(work: DurableRunWork) {
  const snapshot = {
    snapshotId: work.snapshotId,
    question: work.question,
    continuationContext: work.continuationContext,
    memoryContext: work.memoryContext,
    attachments: work.attachments.filter((attachment) => attachment.mimeType !== "application/pdf"),
    documents: work.attachments
      .filter((attachment) => attachment.mimeType === "application/pdf")
      .map((attachment) => ({
        name: attachment.name,
        sha256: attachment.sha256,
        content: attachment.extractedText,
      })),
    toolContext: work.toolContext,
  };
  if (work.providerMode === "fake") {
    return executeFakeCouncil(snapshot, work.scenario, work.members, work.reviewRounds, work.selfRevisionEnabled, work.reusedInitialResults);
  }

  const connectionCache = new Map<string, ReturnType<typeof loadProviderConnectionSecret>>();
  const members = await Promise.all(
    work.members.map(async (member): Promise<TextProvider> => {
      if (member.provider === "fake" || !member.connectionId) {
        return new UnavailableProvider(member.id, member.label, member.councilRole, member.role);
      }
      let pendingConnection = connectionCache.get(member.connectionId);
      if (!pendingConnection) {
        pendingConnection = loadProviderConnectionSecret(member.connectionId);
        connectionCache.set(member.connectionId, pendingConnection);
      }
      const connection = await pendingConnection;
      if (!connection || connection.provider !== member.provider) {
        return new UnavailableProvider(member.id, member.label, member.councilRole, member.role);
      }
      const shared = {
        apiKey: connection.apiKey,
        model: member.model,
        id: member.id,
        label: member.label,
        councilRole: member.councilRole,
        reasoningLevel: member.reasoningLevel,
        webSearchMode: member.webSearchMode,
        receivesAttachments: member.receiveAttachments === true,
      };
      const provider: TextProvider =
        member.provider === "openai"
          ? new OpenAIResponsesProvider({
              ...shared,
              reasoningProtocol: connection.reasoningProtocol,
              ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
            })
          : member.provider === "anthropic"
            ? new AnthropicMessagesProvider({
                ...shared,
                reasoningProtocol: connection.reasoningProtocol,
                ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
              })
            : member.provider === "google"
              ? new GeminiGenerateContentProvider({
                  ...shared,
                  reasoningProtocol: connection.reasoningProtocol,
                  ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
                })
              : connection.baseUrl
                ? new OpenAICompatibleProvider({
                    ...shared,
                    baseUrl: connection.baseUrl,
                    reasoningProtocol: connection.reasoningProtocol,
                    structuredOutputMode: connection.structuredOutputMode,
                    endpointPreset: connection.endpointPreset,
                  })
                : new UnavailableProvider(
                    member.id,
                    member.label,
                    member.councilRole,
                    member.role,
                  );
      return new ReceiptTrackedProvider(
        work.runId,
        member.provider,
        member.model,
        member.webSearchMode,
        provider,
        member.role,
        work.executionLimits?.maxOutputTokensPerCall,
        { id: connection.id, revision: connection.revision },
      );
    }),
  );
  return executeCouncil(snapshot, members, work.reviewRounds, work.members, work.selfRevisionEnabled, work.reusedInitialResults);
}
