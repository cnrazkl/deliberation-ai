import type {
  ReasoningLevel,
  CouncilRole,
  SaveProviderConnectionRequest,
  WebSearchMode,
} from "@deliberation-ai/contracts";
import { extractTokenUsage } from "./token-usage";
import {
  NormalizedProviderError,
  type ProviderRequest,
  type ProviderResult,
  type TextProvider,
} from "./index";
import {
  inputFor,
  attachmentDataUrl,
  imageAttachmentsFor,
  instructionsFor,
  extractProviderCitations,
  outputJsonSchemaFor,
  parseProviderJson,
  providerHttpError,
  providerNetworkError,
  requireOperationId,
  outputTokenLimitFor,
  withProviderNetworkDeadline,
} from "./provider-utils";

type FetchLike = typeof fetch;

export type OpenAICompatibleProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  id: string;
  label: string;
  councilRole: CouncilRole;
  reasoningLevel: ReasoningLevel;
  reasoningProtocol: SaveProviderConnectionRequest["reasoningProtocol"];
  structuredOutputMode: SaveProviderConnectionRequest["structuredOutputMode"];
  endpointPreset: SaveProviderConnectionRequest["endpointPreset"];
  webSearchMode?: WebSearchMode;
  receivesAttachments?: boolean;
  fetch?: FetchLike;
  timeoutMs?: number;
};

export class OpenAICompatibleProvider implements TextProvider {
  readonly id: string;
  readonly label: string;
  readonly councilRole: CouncilRole;
  readonly receivesAttachments: boolean;
  readonly #options: OpenAICompatibleProviderOptions;
  readonly #fetch: FetchLike;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    this.councilRole = options.councilRole;
    this.receivesAttachments = options.receivesAttachments === true;
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    const maxOutputTokens = outputTokenLimitFor(request);
    const operationId = requireOperationId(request, "OpenAI uyumlu sağlayıcı");
    const body: Record<string, unknown> = {
      model: this.#options.model,
      messages: [
        { role: "system", content: instructionsFor(request) },
        {
          role: "user",
          content: this.receivesAttachments && imageAttachmentsFor(request).length > 0
            ? [
                { type: "text", text: inputFor(request) },
                ...imageAttachmentsFor(request).map((attachment) => ({
                  type: "image_url",
                  image_url: { url: attachmentDataUrl(attachment) },
                })),
              ]
            : inputFor(request),
        },
      ],
    };
    if (this.#options.endpointPreset === "openrouter") {
      // OpenRouter counts hidden reasoning inside the completion budget. Some
      // compact reasoning models otherwise exhaust the cap before emitting JSON.
      body.max_completion_tokens = maxOutputTokens ?? 8_192;
    } else if (this.#options.endpointPreset === "qwen") {
      // Qwen 3.8 maps low reasoning effort to as many as 4k thinking
      // tokens, so reserve a separate margin for the required JSON answer.
      body.max_tokens = maxOutputTokens ?? 8_192;
    } else {
      body.max_tokens = maxOutputTokens ?? 4_096;
    }
    if (this.#options.structuredOutputMode === "json-schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: request.round > 0 ? "council_cross_review" : "council_member_output",
          strict: true,
          schema: outputJsonSchemaFor(request.round, Boolean(request.reviewContext?.selfRevision)),
        },
      };
    } else if (this.#options.structuredOutputMode === "json-object") {
      body.response_format = { type: "json_object" };
    }
    if (
      this.#options.reasoningProtocol === "openai" &&
      !["default", "none"].includes(this.#options.reasoningLevel)
    ) {
      body.reasoning_effort = this.#options.reasoningLevel;
    }
    if (this.#options.webSearchMode === "auto") {
      if (this.#options.endpointPreset !== "openrouter") {
        throw new NormalizedProviderError(
          "Bu OpenAI uyumlu bağlantıda yönetilen web arama aracı yapılandırılmamış.",
          "web_search_not_supported",
          "known",
          false,
        );
      }
      body.tools = [
        {
          type: "openrouter:web_search",
          parameters: {
            engine: "auto",
            max_uses: 3,
            max_total_results: 10,
            search_context_size: "low",
          },
        },
      ];
      body.max_tool_calls = 3;
    }

    let json: {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    };
    try {
      json = await withProviderNetworkDeadline(async (signal) => {
        const response = await this.#fetch(
          `${this.#options.baseUrl.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(this.#options.apiKey
                ? { authorization: `Bearer ${this.#options.apiKey}` }
                : {}),
              "idempotency-key": operationId,
            },
            body: JSON.stringify(body),
            signal,
          },
        );
        if (!response.ok) throw providerHttpError("OpenAI uyumlu sağlayıcı", response.status);
        return response.json() as Promise<typeof json>;
      }, this.#options.timeoutMs);
    } catch (error) {
      if (error instanceof NormalizedProviderError) throw error;
      throw providerNetworkError("OpenAI uyumlu sağlayıcı");
    }
    const rawText = json.choices?.[0]?.message?.content;
    const citations = extractProviderCitations(json);
    const metadata = { provider: "openai-compatible", model: json.model ?? this.#options.model,
      remoteResponseId: json.id ?? operationId, ...extractTokenUsage("openai-compatible", json.usage),
      ...(citations.length > 0 ? { citations } : {}) };
    return {
      rawText: rawText ?? "",
      parsed: parseProviderJson(rawText ?? "", request.round, Boolean(request.reviewContext?.selfRevision), metadata),
      metadata,
    };
  }
}
