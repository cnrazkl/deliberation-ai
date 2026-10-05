import {
  crossReviewOutputSchema,
  crossReviewWithRevisionOutputSchema,
  providerOutputSchema,
  type FakePerspective,
  type CouncilRole,
  type FrozenMemoryEntry,
  type FrozenContinuation,
  type ProviderOutput,
  type CrossReviewOutput,
  type ReviewRoundCount,
  type CrossReviewRound,
  type ProviderCitation,
  type RunAttachment,
  type FrozenToolContext,
  type KnowledgePacket,
  type ProviderTokenDetails,
} from "@deliberation-ai/contracts";

export type FrozenInputSnapshot = {
  snapshotId: string;
  question: string;
  continuationContext?: FrozenContinuation | null | undefined;
  memoryContext?: FrozenMemoryEntry[];
  attachments?: RunAttachment[];
  documents?: Array<{ name: string; sha256: string; content: string }>;
  toolContext?: FrozenToolContext[];
  knowledgePacket?: KnowledgePacket | null | undefined;
};

export type ProviderRequest = {
  memberId: string;
  role: string;
  councilRole: CouncilRole;
  input: FrozenInputSnapshot;
  round: ReviewRoundCount;
  reviewContext?: {
    selfRevision?: { ownInitial: ProviderOutput };
    peers: Array<{
      memberId: string;
      label: string;
      councilRole: CouncilRole;
      summary: string;
      claims: ProviderOutput["claims"];
    }>;
    previousRound?: CrossReviewRound;
    previousReviews?: Array<{
      reviewerMemberId: string;
      reviewerLabel: string;
      reviewerCouncilRole: CouncilRole;
      summary: CrossReviewOutput["summary"];
      claims: CrossReviewOutput["claims"];
    }>;
  };
  operationId?: string;
  maxOutputTokens?: number;
};

export type ProviderResult = {
  rawText: string;
  parsed: ProviderOutput;
  metadata?: {
    provider: string;
    model: string;
    remoteResponseId: string;
    inputTokens?: number;
    outputTokens?: number;
    tokenDetails?: ProviderTokenDetails;
    citations?: ProviderCitation[];
  };
};

export class NormalizedProviderError extends Error {
  readonly rawText?: string;
  readonly metadata?: ProviderResult["metadata"];

  constructor(
    message: string,
    readonly code: string,
    readonly outcome: "known" | "unknown",
    readonly retryable: boolean,
    rawText?: string,
    metadata?: ProviderResult["metadata"],
  ) {
    super(message);
    this.name = "NormalizedProviderError";
    if (rawText !== undefined) {
      Object.defineProperty(this, "rawText", { value: rawText, enumerable: false });
    }
    if (metadata !== undefined) Object.defineProperty(this, "metadata", { value: metadata, enumerable: false });
  }
}

export interface TextProvider {
  readonly id: string;
  readonly label: string;
  readonly role?: string;
  readonly councilRole: CouncilRole;
  readonly receivesAttachments?: boolean;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}

export * from "./openai-responses-provider";
export * from "./openai-compatible-provider";
export * from "./anthropic-messages-provider";
export * from "./gemini-generate-content-provider";
export * from "./model-catalog";
export { generatePrivateText } from "./private-text";
export { inputFor, instructionsFor, outputJsonSchemaFor } from "./provider-utils";

type FakeProviderOptions = {
  id: string;
  label: string;
  role?: string;
  councilRole: CouncilRole;
  perspective: FakePerspective;
  fail?: boolean;
  delayMs?: number;
};

export class FakeProvider implements TextProvider {
  readonly id: string;
  readonly label: string;
  readonly role?: string;
  readonly councilRole: CouncilRole;
  readonly receivesAttachments = false;
  readonly #perspective: FakeProviderOptions["perspective"];
  readonly #fail: boolean;
  readonly #delayMs: number;

  constructor(options: FakeProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    if (options.role !== undefined) this.role = options.role;
    this.councilRole = options.councilRole;
    this.#perspective = options.perspective;
    this.#fail = options.fail ?? false;
    this.#delayMs = options.delayMs ?? 25;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    await new Promise((resolve) => setTimeout(resolve, this.#delayMs));
    if (this.#fail) {
      throw new Error("Deneme üyesi planlanan hata senaryosunu tetikledi.");
    }

    if (request.round > 0 && request.reviewContext) {
      const output = (request.reviewContext.selfRevision ? crossReviewWithRevisionOutputSchema : crossReviewOutputSchema).parse({
        summary: `${this.label}, ${request.round}. turda diğer üyelerin ilk tur iddialarını ve varsa önceki kapanmış incelemeleri değerlendirdi.`,
        claims: request.reviewContext.peers.map((peer) => {
          const quoted = peer.claims[0]?.statement ?? peer.summary;
          return {
            statement:
              this.councilRole === "red-team"
                ? `${peer.label} görüşünün başarısız olacağı koşullar açıkça sınanmalıdır.`
                : `${peer.label} görüşünün dayandığı koşullar karar öncesinde ayrıca doğrulanmalıdır.`,
            kind: "objection" as const,
            quote: quoted,
            targetMemberId: peer.memberId,
            reviewStance: this.councilRole === "red-team" ? "challenge" as const : "qualify" as const,
          };
        }),
        ...(request.reviewContext.selfRevision ? { selfRevisions: [{
          sourceClaimIndex: 0,
          action: "qualify",
          statement: `${request.reviewContext.selfRevision.ownInitial.claims[0]?.statement ?? "İlk iddia"} (koşulları doğrulanmalı)`,
          reason: "Çapraz inceleme sonrası koşullar açık yazılmalıdır.",
        }] } : {}),
      });
      return { rawText: JSON.stringify(output), parsed: output };
    }

    const shared = "Karar vermeden önce sorunun kapsamını ve geçerli koşulları doğrula.";
    const perspectiveClaims: Record<
      FakePerspective,
      { statement: string; kind: ProviderOutput["claims"][number]["kind"] }
    > = {
      procedural: {
        statement: "İzlenebilir bir kontrol listesi oluştur ve varsayımları ayrı göster.",
        kind: "recommendation",
      },
      risk: {
        statement: "Eksik bilgiyle kesin sonuca varmanın riskini ayrıca raporla.",
        kind: "risk",
      },
      evidence: {
        statement: "Her önemli iddiayı doğrulanabilir bir kanıt veya kaynak gereksinimiyle eşleştir.",
        kind: "recommendation",
      },
      implementation: {
        statement: "Kararı küçük, geri alınabilir uygulama adımlarına ve ölçülebilir eşiklere böl.",
        kind: "recommendation",
      },
      alternatives: {
        statement: "En az iki uygulanabilir alternatifi aynı başarı ölçütleriyle karşılaştır.",
        kind: "objection",
      },
      assumptions: {
        statement: "Sonucu değiştirebilecek varsayımları önem sırasına koy ve yanlışlanma koşullarını yaz.",
        kind: "risk",
      },
    };
    const perspectiveClaim = perspectiveClaims[this.#perspective];
    if (this.councilRole === "red-team") {
      const output = providerOutputSchema.parse({
        summary: `${this.label}, soruyu karşı argümanlar ve başarısızlık koşulları açısından bağımsız olarak sınadı.`,
        claims: [
          {
            statement: perspectiveClaim.statement,
            kind: perspectiveClaim.kind === "recommendation" ? "objection" : perspectiveClaim.kind,
            quote: perspectiveClaim.statement,
          },
          {
            statement: "Önerilen yaklaşımın geri dönüşü olmayan zarar eşiği önceden tanımlanmalıdır.",
            kind: "risk",
            quote: "Geri dönüşü olmayan zarar eşiği önceden tanımlanmalıdır.",
          },
        ],
      });
      return { rawText: JSON.stringify(output), parsed: output };
    }
    const output = providerOutputSchema.parse({
      summary: `${this.label}, soruyu “${request.input.question}” bağımsız girdisi üzerinden değerlendirdi.${request.input.memoryContext?.length ? ` Kullanıcının seçtiği ${request.input.memoryContext.length} geçmiş bağlam kaydı doğrulanmış gerçek sayılmadan dikkate alındı.` : ""}`,
      claims: [
        { statement: shared, kind: "shared", quote: shared },
        {
          statement: perspectiveClaim.statement,
          kind: perspectiveClaim.kind,
          quote: perspectiveClaim.statement,
        },
      ],
    });
    const rawText = JSON.stringify(output);
    return { rawText, parsed: output };
  }
}
export * from "./decision-evaluator";
