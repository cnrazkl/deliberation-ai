import type {
  CouncilRole,
  ReasoningLevel,
  SaveProviderConnectionRequest,
  WebSearchMode,
} from "@deliberation-ai/contracts";
import { extractTokenUsage } from "./token-usage";
import { NormalizedProviderError, type ProviderRequest, type ProviderResult, type TextProvider } from "./index";
import {
  inputFor,
  imageAttachmentsFor,
  instructionsFor,
  extractProviderCitations,
  parseProviderJson,
  providerHttpError,
  providerNetworkError,
  requireOperationId,
  outputTokenLimitFor,
  withProviderNetworkDeadline,
} from "./provider-utils";

type FetchLike = typeof fetch;

export type AnthropicMessagesProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  id: string;
  label: string;
  councilRole: CouncilRole;
  reasoningLevel: ReasoningLevel;
  reasoningProtocol: SaveProviderConnectionRequest["reasoningProtocol"];
  webSearchMode?: WebSearchMode;
  receivesAttachments?: boolean;
  fetch?: FetchLike;
  timeoutMs?: number;
};

export class AnthropicMessagesProvider implements TextProvider {
  readonly id: string;
  readonly label: string;
  readonly councilRole: CouncilRole;
  readonly receivesAttachments: boolean;
  readonly #options: AnthropicMessagesProviderOptions;
  readonly #fetch: FetchLike;

  constructor(options: AnthropicMessagesProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    this.councilRole = options.councilRole;
    this.receivesAttachments = options.receivesAttachments === true;
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    const maxOutputTokens = outputTokenLimitFor(request);
    const operationId = requireOperationId(request, "Anthropic");
    const body: Record<string, unknown> = {
      model: this.#options.model,
      max_tokens: maxOutputTokens ?? 2_000,
      system: instructionsFor(request),
      messages: [{
        role: "user",
        content: this.receivesAttachments && imageAttachmentsFor(request).length > 0
          ? [
              { type: "text", text: inputFor(request) },
              ...imageAttachmentsFor(request).map((attachment) => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: attachment.mimeType,
                  data: attachment.dataBase64,
                },
              })),
            ]
          : inputFor(request),
      }],
    };
    if (
      this.#options.reasoningProtocol === "anthropic" &&
      !["default", "none"].includes(this.#options.reasoningLevel)
    ) {
      body.output_config = { effort: this.#options.reasoningLevel };
    }
    if (this.#options.webSearchMode === "auto") {
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
    }
    let json: {
      id?: string;
      model?: string;
      content?: Array<{ type?: string; text?: string }>;
      usage?: unknown;
    };
    try {
      json = await withProviderNetworkDeadline(async (signal) => {
        const response = await this.#fetch(
          `${(this.#options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": this.#options.apiKey,
              "anthropic-version": "2023-06-01",
              "idempotency-key": operationId,
            },
            body: JSON.stringify(body),
            signal,
          },
        );
        if (!response.ok) throw providerHttpError("Anthropic", response.status);
        return response.json() as Promise<typeof json>;
      }, this.#options.timeoutMs);
    } catch (error) {
      if (error instanceof NormalizedProviderError) throw error;
      throw providerNetworkError("Anthropic", error);
    }
    const rawText = json.content?.filter((part) => part.type === "text").map((part) => part.text).join("");
    const citations = extractProviderCitations(json);
    const metadata = { provider: "anthropic", model: json.model ?? this.#options.model,
      remoteResponseId: json.id ?? operationId, ...extractTokenUsage("anthropic", json.usage),
      ...(citations.length > 0 ? { citations } : {}) };
    return {
      rawText: rawText ?? "",
      parsed: parseProviderJson(rawText ?? "", request.round, Boolean(request.reviewContext?.selfRevision), metadata),
      metadata,
    };
  }
}
