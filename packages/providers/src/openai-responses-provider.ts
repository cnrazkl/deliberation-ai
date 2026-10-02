import {
  crossReviewOutputSchema,
  crossReviewWithRevisionOutputSchema,
  providerOutputSchema,
  type ProviderOutput,
  type CouncilRole,
  type ReasoningLevel,
  type SaveProviderConnectionRequest,
  type WebSearchMode,
} from "@deliberation-ai/contracts";
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { extractTokenUsage } from "./token-usage";
import { NormalizedProviderError, type ProviderRequest, type ProviderResult, type TextProvider } from "./index";
import { attachmentDataUrl, extractProviderCitations, imageAttachmentsFor, inputFor, instructionsFor, outputTokenLimitFor } from "./provider-utils";

export type OpenAIResponsesProviderOptions = {
  apiKey: string;
  model: string;
  id: string;
  label: string;
  councilRole: CouncilRole;
  reasoningLevel: ReasoningLevel;
  reasoningProtocol: SaveProviderConnectionRequest["reasoningProtocol"];
  webSearchMode?: WebSearchMode;
  receivesAttachments?: boolean;
  baseUrl?: string;
  maxOutputTokens?: number;
  client?: OpenAI;
};

export class OpenAIResponsesProvider implements TextProvider {
  readonly id: string;
  readonly label: string;
  readonly councilRole: CouncilRole;
  readonly receivesAttachments: boolean;
  readonly #model: string;
  readonly #maxOutputTokens: number;
  readonly #client: OpenAI;
  readonly #reasoningLevel: ReasoningLevel;
  readonly #reasoningProtocol: SaveProviderConnectionRequest["reasoningProtocol"];
  readonly #webSearchMode: WebSearchMode;

  constructor(options: OpenAIResponsesProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    this.councilRole = options.councilRole;
    this.receivesAttachments = options.receivesAttachments === true;
    this.#model = options.model;
    this.#maxOutputTokens = options.maxOutputTokens ?? 2_000;
    this.#reasoningLevel = options.reasoningLevel;
    this.#reasoningProtocol = options.reasoningProtocol;
    this.#webSearchMode = options.webSearchMode ?? "off";
    this.#client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        maxRetries: 0,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      });
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    const maxOutputTokens = outputTokenLimitFor(request) ?? this.#maxOutputTokens;
    if (!request.operationId) {
      throw new NormalizedProviderError(
        "OpenAI çağrısı için kalıcı operasyon kimliği eksik.",
        "missing_operation_id",
        "known",
        false,
      );
    }
    try {
      const response = await this.#client.responses.parse(
        {
          model: this.#model,
          store: false,
          max_output_tokens: maxOutputTokens,
          instructions: instructionsFor(request),
          input: this.receivesAttachments && imageAttachmentsFor(request).length > 0
            ? [{
                role: "user" as const,
                content: [
                  { type: "input_text" as const, text: inputFor(request) },
                  ...imageAttachmentsFor(request).map((attachment) => ({
                    type: "input_image" as const,
                    image_url: attachmentDataUrl(attachment),
                    detail: "auto" as const,
                  })),
                ],
              }]
            : inputFor(request),
          text: {
            format: zodTextFormat(
              request.round > 0 ? request.reviewContext?.selfRevision ? crossReviewWithRevisionOutputSchema : crossReviewOutputSchema : providerOutputSchema,
              request.round > 0 ? "council_cross_review" : "council_member_output",
            ),
          },
          metadata: {
            snapshot_id: request.input.snapshotId,
            member_id: request.memberId,
            round: String(request.round),
          },
          ...(this.#webSearchMode === "auto"
            ? {
                tools: [{ type: "web_search" as const }],
                tool_choice: "auto" as const,
                max_tool_calls: 3,
                include: ["web_search_call.action.sources" as const],
              }
            : {}),
          ...(this.#reasoningProtocol === "openai" && this.#reasoningLevel !== "default"
            ? {
                reasoning: {
                  effort: this.#reasoningLevel as
                    | "none"
                    | "minimal"
                    | "low"
                    | "medium"
                    | "high"
                    | "xhigh"
                    | "max",
                },
              }
            : {}),
        },
        { idempotencyKey: request.operationId },
      );

      const citations = extractProviderCitations(response);
      const metadata = {
        provider: "openai", model: String(response.model), remoteResponseId: response.id,
        ...extractTokenUsage("openai", response.usage),
        ...(citations.length > 0 ? { citations } : {}),
      };
      if (response.status !== "completed" || !response.output_parsed) {
        throw new NormalizedProviderError(
          "OpenAI yanıtı tamamlanmış ve doğrulanmış çıktı üretmedi.",
          response.status === "incomplete" ? "incomplete_response" : "invalid_response",
          "known",
          false,
          response.output_text || undefined,
          metadata,
        );
      }
      const validated = (request.round > 0
        ? request.reviewContext?.selfRevision ? crossReviewWithRevisionOutputSchema : crossReviewOutputSchema
        : providerOutputSchema).safeParse(response.output_parsed);
      if (!validated.success) {
        throw new NormalizedProviderError(
          "OpenAI yanıtı geçerli konsey JSON çıktısı üretmedi.",
          "provider_response_invalid",
          "known",
          false,
          response.output_text || JSON.stringify(response.output_parsed),
          metadata,
        );
      }
      const parsed: ProviderOutput = validated.data;
      return {
        rawText: response.output_text || JSON.stringify(parsed),
        parsed,
        metadata,
      };
    } catch (error) {
      if (error instanceof NormalizedProviderError) throw error;
      if (error instanceof APIConnectionTimeoutError || error instanceof APIConnectionError) {
        throw new NormalizedProviderError(
          "OpenAI çağrısının uzaktaki sonucu doğrulanamadı.",
          "remote_outcome_unknown",
          "unknown",
          false,
        );
      }
      if (error instanceof APIError) {
        const unknown = error.status === undefined || error.status >= 500;
        throw new NormalizedProviderError(
          "OpenAI isteği sağlayıcı hatasıyla tamamlanamadı.",
          `openai_${error.status ?? "unknown"}`,
          unknown ? "unknown" : "known",
          !unknown && (error.status === 408 || error.status === 409 || error.status === 429),
        );
      }
      throw new NormalizedProviderError(
        "OpenAI yanıtı işlenirken beklenmeyen bir hata oluştu.",
        "provider_response_invalid",
        "known",
        false,
      );
    }
  }
}
