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
  outputJsonSchemaFor,
  parseProviderJson,
  providerHttpError,
  providerNetworkError,
  requireOperationId,
  outputTokenLimitFor,
  withProviderNetworkDeadline,
} from "./provider-utils";

type FetchLike = typeof fetch;

export type GeminiGenerateContentProviderOptions = {
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

const budgetByLevel: Record<ReasoningLevel, number | undefined> = {
  default: undefined,
  none: 0,
  minimal: 512,
  low: 1_024,
  medium: 8_192,
  high: 24_576,
  xhigh: 24_576,
  max: 24_576,
};

export class GeminiGenerateContentProvider implements TextProvider {
  readonly id: string;
  readonly label: string;
  readonly councilRole: CouncilRole;
  readonly receivesAttachments: boolean;
  readonly #options: GeminiGenerateContentProviderOptions;
  readonly #fetch: FetchLike;

  constructor(options: GeminiGenerateContentProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    this.councilRole = options.councilRole;
    this.receivesAttachments = options.receivesAttachments === true;
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    const maxOutputTokens = outputTokenLimitFor(request);
    const operationId = requireOperationId(request, "Gemini");
    const generationConfig: Record<string, unknown> = {
      responseMimeType: "application/json",
      responseJsonSchema: outputJsonSchemaFor(request.round, Boolean(request.reviewContext?.selfRevision)),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    };
    if (this.#options.reasoningProtocol === "gemini-level" && this.#options.reasoningLevel !== "default") {
      const level =
        this.#options.reasoningLevel === "none" || this.#options.reasoningLevel === "minimal"
          ? /^gemini-3\.[78]-flash(?:$|-)/u.test(this.#options.model) ? "low" : "minimal"
          : this.#options.reasoningLevel === "xhigh" || this.#options.reasoningLevel === "max"
            ? "high"
            : this.#options.reasoningLevel;
      generationConfig.thinkingConfig = { thinkingLevel: level };
    } else if (this.#options.reasoningProtocol === "gemini-budget") {
      const budget = budgetByLevel[this.#options.reasoningLevel];
      if (budget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: budget };
    }
    const body = {
      systemInstruction: { parts: [{ text: instructionsFor(request) }] },
      contents: [{
        role: "user",
        parts: [
          { text: inputFor(request) },
          ...(this.receivesAttachments ? imageAttachmentsFor(request).map((attachment) => ({
            inlineData: { mimeType: attachment.mimeType, data: attachment.dataBase64 },
          })) : []),
        ],
      }],
      generationConfig,
      ...(this.#options.webSearchMode === "auto" ? { tools: [{ googleSearch: {} }] } : {}),
    };
    let json: {
      responseId?: string;
      modelVersion?: string;
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: unknown;
    };
    try {
      json = await withProviderNetworkDeadline(async (signal) => {
        const base = (this.#options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
        const response = await this.#fetch(
          `${base}/models/${encodeURIComponent(this.#options.model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": this.#options.apiKey,
              "x-goog-request-id": operationId,
            },
            body: JSON.stringify(body),
            signal,
          },
        );
        if (!response.ok) throw providerHttpError("Gemini", response.status);
        return response.json() as Promise<typeof json>;
      }, this.#options.timeoutMs);
    } catch (error) {
      if (error instanceof NormalizedProviderError) throw error;
      throw providerNetworkError("Gemini");
    }
    const rawText = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    const citations = extractProviderCitations(json);
    const metadata = { provider: "google", model: json.modelVersion ?? this.#options.model,
      remoteResponseId: json.responseId ?? operationId, ...extractTokenUsage("google", json.usageMetadata),
      ...(citations.length > 0 ? { citations } : {}) };
    return {
      rawText: rawText ?? "",
      parsed: parseProviderJson(rawText ?? "", request.round, Boolean(request.reviewContext?.selfRevision), metadata),
      metadata,
    };
  }
}
