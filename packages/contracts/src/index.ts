import { z } from "zod";
export * from "./knowledge";
import { knowledgePacketReferenceSchema, knowledgeExcerptSchema, knowledgeScopeSchema } from "./knowledge";
export * from "./pricing";
export * from "./billing";
export * from "./billing-statement";
export * from "./billing-account";
export * from "./billing-payment";

// Optional counters retain provider conventions; subtotals are never added to totals.
export const providerTokenDetailsSchema = z.object({
  version: z.literal("provider-token-details-v1"),
  inputTokenKind: z.enum(["inclusive", "uncached", "provider_defined"]),
  outputTokenKind: z.enum(["inclusive", "candidates", "provider_defined"]),
  totalTokens: z.number().int().min(0).max(2_147_483_647).optional(),
  cachedInputTokens: z.number().int().min(0).max(2_147_483_647).optional(),
  cacheWriteInputTokens: z.number().int().min(0).max(2_147_483_647).optional(),
  reasoningTokens: z.number().int().min(0).max(2_147_483_647).optional(),
  toolInputTokens: z.number().int().min(0).max(2_147_483_647).optional(),
}).strict();
export type ProviderTokenDetails = z.infer<typeof providerTokenDetailsSchema>;

export const executionLimitsSchema = z.object({
  version: z.literal("dispatch-limits-v1"),
  maxProviderCalls: z.number().int().min(1).max(100),
  maxOutputTokensPerCall: z.number().int().min(128).max(32_768),
  maxReservedOutputTokens: z.number().int().min(128).max(3_276_800),
}).strict().refine((limits) => limits.maxReservedOutputTokens >= limits.maxOutputTokensPerCall, {
  message: "Toplam yanıt kotası en az bir çağrının kotasını karşılamalı.",
});
export type ExecutionLimits = z.infer<typeof executionLimitsSchema>;
export type ExecutionBudgetStatus = { limits: ExecutionLimits; submittedCalls: number; reservedOutputTokens: number;
  remainingCalls: number; remainingOutputTokens: number };

export const fakePerspectiveSchema = z.enum([
  "procedural",
  "risk",
  "evidence",
  "implementation",
  "alternatives",
  "assumptions",
]);

export type FakePerspective = z.infer<typeof fakePerspectiveSchema>;

export const remoteProviderSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
]);

export type RemoteProvider = z.infer<typeof remoteProviderSchema>;

export const providerSchema = z.union([z.literal("fake"), remoteProviderSchema]);
export type ProviderKind = z.infer<typeof providerSchema>;

export const reasoningLevelSchema = z.enum([
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export type ReasoningLevel = z.infer<typeof reasoningLevelSchema>;

export const webSearchModeSchema = z.enum(["off", "auto"]);
export type WebSearchMode = z.infer<typeof webSearchModeSchema>;

export const MAX_RUN_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_BYTES = 2_097_152;
export const MAX_PDF_ATTACHMENT_BYTES = 5_242_880;
export const MAX_TOTAL_ATTACHMENT_BYTES = MAX_RUN_ATTACHMENTS * MAX_ATTACHMENT_BYTES;

const imageAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  dataBase64: z.string().min(1).max(2_800_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const pdfAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mimeType: z.literal("application/pdf"),
  dataBase64: z.string().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  extractedText: z.string().trim().min(1).max(64_000),
});
export const runAttachmentSchema = z.union([imageAttachmentSchema, pdfAttachmentSchema]);
export type RunAttachment = z.infer<typeof runAttachmentSchema>;
export type RunImageAttachment = z.infer<typeof imageAttachmentSchema>;
export type RunPdfAttachment = z.infer<typeof pdfAttachmentSchema>;

export const frozenToolContextSchema = z.object({
  id: z.string().uuid(),
  connectionLabel: z.string().trim().min(1).max(80),
  toolName: z.string().trim().min(1).max(128),
  content: z.string().trim().min(1).max(64_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type FrozenToolContext = z.infer<typeof frozenToolContextSchema>;

export const councilRoleSchema = z.enum(["analyst", "red-team"]);
export type CouncilRole = z.infer<typeof councilRoleSchema>;

export const memorySourceTypeSchema = z.enum(["analyst-claim", "red-team-challenge"]);
export type MemorySourceType = z.infer<typeof memorySourceTypeSchema>;

export const endpointPresetSchema = z.enum([
  "custom",
  "kimi",
  "deepseek",
  "qwen",
  "vllm",
  "ollama",
  "litellm",
  "openrouter",
  "nvidia",
]);

export const NVIDIA_HOSTED_BASE_URL = "https://integrate.api.nvidia.com/v1";

export const reasoningProtocolSchema = z.enum([
  "none",
  "openai",
  "anthropic",
  "gemini-level",
  "gemini-budget",
]);

export const structuredOutputModeSchema = z.enum([
  "json-schema",
  "json-object",
  "prompt-only",
]);

export const councilMemberConfigSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  label: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(240),
  provider: providerSchema,
  model: z.string().trim().min(1).max(120),
  perspective: fakePerspectiveSchema.optional(),
  connectionId: z.string().uuid().optional(),
  // Frozen at enqueue for the distinct NVIDIA hosted service.
  nvidiaConnectionRevision: z.number().int().positive().optional(),
  reasoningLevel: reasoningLevelSchema.default("default"),
  webSearchMode: webSearchModeSchema.default("off"),
  councilRole: councilRoleSchema.default("analyst"),
  receiveAttachments: z.boolean().optional(),
});

export type CouncilMemberConfig = z.infer<typeof councilMemberConfigSchema>;

// Owner drafts cannot claim a new model response or enter provider input.
export const privateBranchSeedSchema = z.object({
  version: z.literal("selected-member-private-seed-v1"),
  conversationId: z.string().uuid(),
  sourceRunId: z.string().uuid(), sourceStateVersion: z.number().int().positive(),
  sourceRiskProfile: z.enum(["standard", "high"]),
  sourcePromptVersion: z.string().min(1).max(120),
  sourcePromptFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  member: councilMemberConfigSchema.strict(),
  question: z.string().min(1).max(20_000), rawText: z.string().min(1).max(262_144),
  reusedFromRunId: z.string().uuid().nullable(),
}).strict();
export type PrivateBranchSeed = z.infer<typeof privateBranchSeedSchema>;
export const privateOutputTokensSchema = z.number().int().min(128).max(1_024);
export const privateDeliverySettingsSchema = z.object({ maxOutputTokens: privateOutputTokensSchema.default(1_024) }).strict();
export const privateDeliveryRequestSchema = z.object({
  version: z.literal("private-text-v1"), model: z.string().min(1).max(120),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(262_144) }).strict()).min(4).max(132),
  maxOutputTokens: privateOutputTokensSchema,
}).strict();
export type PrivateDeliveryRequest = z.infer<typeof privateDeliveryRequestSchema>;
export const privateDeliveryUsageSchema = z.object({
  model: z.string().min(1).max(256), remoteResponseId: z.string().max(256).nullable(),
  inputTokens: z.number().int().min(0).max(2_147_483_647).nullable(), outputTokens: z.number().int().min(0).max(2_147_483_647).nullable(),
  tokenDetails: providerTokenDetailsSchema.nullable(),
}).strict();
export type PrivateDeliveryUsage = z.infer<typeof privateDeliveryUsageSchema>;
export const privateDeliveryResultSchema = z.object({
  finishReason: z.enum(["stop", "length", "other"]).optional(),
  text: z.string().min(1).max(16_384), model: z.string().min(1).max(256), remoteResponseId: z.string().max(256).nullable(),
  inputTokens: z.number().int().min(0).max(2_147_483_647).nullable(), outputTokens: z.number().int().min(0).max(2_147_483_647).nullable(),
  tokenDetails: providerTokenDetailsSchema.nullable(),
}).strict();
export type PrivateDeliveryResult = z.infer<typeof privateDeliveryResultSchema>;
export const privateDeliverySchema = z.object({
  id: z.string().uuid(), originBranchId: z.string().uuid(), messageId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["prepared", "submitted", "succeeded", "failed", "outcome_unknown", "cancelled", "discarded"]),
  connectionId: z.string().uuid(), connectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  request: privateDeliveryRequestSchema,
  createdAt: z.string().datetime(), submittedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable(),
  errorCode: z.string().max(100).nullable(), result: privateDeliveryResultSchema.nullable(),
  usage: privateDeliveryUsageSchema.nullable().optional(),
}).strict();
export type PrivateDelivery = z.infer<typeof privateDeliverySchema>;
export const privateBranchDeletionAuditSchema = z.object({
  version: z.literal("private-branch-deletion-audit-v1"), branchId: z.string().uuid(), conversationId: z.string().uuid(),
  creationRequestId: z.string().uuid(),
  sourceRunId: z.string().uuid(), parentBranchId: z.string().uuid().nullable(), deletedAt: z.string().datetime(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), messageCount: z.number().int().min(0).max(64),
  receipts: z.array(z.object({
    operationId: z.string().uuid(), originBranchId: z.string().uuid(), connectionId: z.string().uuid(),
    status: z.enum(["succeeded", "failed", "cancelled", "discarded"]),
    createdAt: z.string().datetime(), submittedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable(),
    usage: privateDeliveryUsageSchema.nullable(),
  }).strict()).max(16),
}).strict();
export type PrivateBranchDeletionAudit = z.infer<typeof privateBranchDeletionAuditSchema>;
export const runDeletionAuditSchema = z.object({
  version: z.literal("run-deletion-audit-v1"), runId: z.string().uuid(), conversationId: z.string().uuid(),
  creationIntentHash: z.string().regex(/^[a-f0-9]{64}$/), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  deletedAt: z.string().datetime(), status: z.enum(["completed", "partially_completed", "failed", "cancelled"]),
  receipts: z.array(z.object({
    operationId: z.string().uuid(), memberId: z.string().min(1).max(128), provider: z.string().min(1).max(128), model: z.string().min(1).max(256),
    round: z.number().int().min(0).max(3), attempt: z.number().int().positive(),
    status: z.enum(["succeeded", "failed", "discarded"]), startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
    inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
    tokenDetails: providerTokenDetailsSchema.nullable(), priceSnapshotId: z.string().uuid().nullable(),
  }).strict()).max(500),
}).strict();
export type RunDeletionAudit = z.infer<typeof runDeletionAuditSchema>;
export const deleteRunBodySchema = z.object({ runId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmContentDeletion: z.literal(true), acknowledgeRetainedRecords: z.literal(true) }).strict();
export const deletePreflightDraftSchema = z.object({ draftId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmContentDeletion: z.literal(true), acknowledgeRetainedRecords: z.literal(true) }).strict();
export const preflightDraftDeletionReceiptSchema = z.object({
  version: z.literal("preflight-draft-deletion-v1"), draftId: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), deletedAt: z.string().datetime(),
  previousStatus: z.enum(["awaiting_input", "started", "cancelled"]), retainedRunId: z.string().uuid().nullable(),
}).strict();
export type PreflightDraftDeletionReceipt = z.infer<typeof preflightDraftDeletionReceiptSchema>;
export const deletePrivateBranchSchema = z.object({ branchId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmContentDeletion: z.literal(true), acknowledgeRetainedMetadata: z.literal(true) }).strict();
export const sendPrivateDeliverySchema = z.object({ requestId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  maxOutputTokens: privateOutputTokensSchema.default(1_024) }).strict();
export const controlPrivateDeliverySchema = z.object({ operationId: z.string().uuid(), action: z.enum(["cancel", "recover", "discard_unknown"]),
  acknowledgeUnknown: z.boolean().optional() }).strict();
export const privateBranchBodySchema = z.object({
  version: z.literal("private-branch-drafts-v1"), seed: privateBranchSeedSchema,
  deliveryVersion: z.number().int().min(0).max(10_000).optional(),
  deliveries: z.array(privateDeliverySchema).max(16).optional(),
  forkedFrom: z.object({ branchId: z.string().uuid(), revision: z.number().int().positive(), messageCount: z.number().int().min(0).max(64) }).strict().nullable(),
  messages: z.array(z.object({
    id: z.string().uuid(), kind: z.literal("owner-draft"), text: z.string().min(1).max(8_000).refine((value) => value.trim().length > 0),
    createdAt: z.string().datetime(), originBranchId: z.string().uuid(), acceptedRevision: z.number().int().min(2),
  }).strict()).max(64),
}).strict();
export type PrivateBranchBody = z.infer<typeof privateBranchBodySchema>;
export const createPrivateBranchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), sourceRunId: z.string().uuid(), memberId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    expectedSeedSha256: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("fork"), parentBranchId: z.string().uuid(), expectedRevision: z.number().int().positive(), expectedDeliveryVersion: z.number().int().min(0).default(0), requestId: z.string().uuid() }).strict(),
]);
export type CreatePrivateBranch = z.input<typeof createPrivateBranchSchema>;
export const appendPrivateDraftSchema = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().positive(),
  text: z.string().min(1).max(8_000).refine((value) => value.trim().length > 0) }).strict();
export type AppendPrivateDraft = z.infer<typeof appendPrivateDraftSchema>;

export const providerCitationSchema = z.object({
  url: z.string().url().max(2_048),
  title: z.string().trim().min(1).max(300).optional(),
});
export type ProviderCitation = z.infer<typeof providerCitationSchema>;

export const councilMembersSchema = z
  .array(councilMemberConfigSchema)
  .min(2)
  .max(6)
  .superRefine((members, context) => {
    const ids = new Set<string>();
    members.forEach((member, index) => {
      if (ids.has(member.id)) {
        context.addIssue({
          code: "custom",
          message: "Konsey üye kimlikleri benzersiz olmalı.",
          path: [index, "id"],
        });
      }
      ids.add(member.id);
      if (member.provider === "fake" && !member.perspective) {
        context.addIssue({
          code: "custom",
          message: "Deneme üyesi için perspektif gerekli.",
          path: [index, "perspective"],
        });
      }
      if (member.provider !== "fake" && !member.connectionId) {
        context.addIssue({
          code: "custom",
          message: "Uzak sağlayıcı üyesi için bağlantı kimliği gerekli.",
          path: [index, "connectionId"],
        });
      }
    });
    if (!members.some((member) => member.councilRole === "analyst")) {
      context.addIssue({
        code: "custom",
        message: "Konseyde en az bir analist üye bulunmalı.",
        path: [],
      });
    }
  });

export const defaultFakeCouncilMembers: CouncilMemberConfig[] = [
  {
    id: "fake-a",
    label: "Analist A",
    role: "Süreç ve izlenebilirlik analisti",
    provider: "fake",
    model: "deterministic-fixture-v1",
    perspective: "procedural",
    reasoningLevel: "default",
    webSearchMode: "off",
    councilRole: "analyst",
  },
  {
    id: "fake-b",
    label: "Analist B",
    role: "Risk analisti",
    provider: "fake",
    model: "deterministic-fixture-v1",
    perspective: "risk",
    reasoningLevel: "default",
    webSearchMode: "off",
    councilRole: "analyst",
  },
];

export const riskProfileSchema = z.enum(["standard", "high"]);
export type RiskProfile = z.infer<typeof riskProfileSchema>;

export const riskAssessmentSchema = z.object({
  policyVersion: z.literal("risk-rules-v1"),
  requestedProfile: riskProfileSchema,
  effectiveProfile: riskProfileSchema,
  signals: z.array(z.object({
    category: z.enum(["health", "legal", "financial", "physical-safety", "irreversible", "uninspected-image"]),
    sources: z.array(z.enum(["question", "document", "memory", "tool", "image", "conversation"])).min(1).max(6),
  })).max(6),
}).strict();
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;

export const preflightPreviewImageSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().min(1).max(30_000),
  height: z.number().int().min(1).max(30_000),
}).strict();

export const preflightDecisionSchema = z.object({
  draftId: z.string().uuid(),
  choice: z.enum(["answer", "original"]),
  answer: z.string().trim().min(1).max(1_500).optional(),
}).strict().superRefine((value, context) => {
  if ((value.choice === "answer") !== Boolean(value.answer)) context.addIssue({ code: "custom", message: "Açıklama seçimi ve yanıt eşleşmiyor.", path: ["answer"] });
});
export type PreflightDecision = z.infer<typeof preflightDecisionSchema>;

export const promptRevisionSchema = z.object({
  version: z.literal("prompt-revision-v1"),
  originalQuestion: z.string().trim().min(10).max(4_000),
  candidateQuestion: z.string().trim().min(10).max(4_000),
  choice: z.enum(["original", "candidate"]),
}).strict();
export type PromptRevisionRequest = z.infer<typeof promptRevisionSchema>;

export const reviewRoundCountSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type ReviewRoundCount = z.infer<typeof reviewRoundCountSchema>;
export type CrossReviewRound = Exclude<ReviewRoundCount, 0>;

// Full text only; no automatic truncation or attachment-byte replay.
export const MAX_CONTINUATION_BYTES = 262_144;
export const MAX_CONTINUATION_ARCHIVE_BYTES = 2_097_152;
export const manualContinuationCompactionSchema = z.object({
  version: z.literal("manual-continuation-compaction-v1"),
  summary: z.string().trim().min(10).max(8_000),
  reviewed: z.literal(true),
}).strict();
export type ManualContinuationCompaction = z.infer<typeof manualContinuationCompactionSchema>;
export const continuationSourceSchema = z.object({
  runId: z.string().uuid(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  compaction: manualContinuationCompactionSchema.optional(),
}).strict();
export const frozenContinuationSchema = z.object({
  version: z.enum(["run-continuation-v1", "run-continuation-v2"]),
  sourceRunId: z.string().uuid(),
  sourceRiskProfile: riskProfileSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().min(1).max(MAX_CONTINUATION_BYTES),
}).strict();
export type FrozenContinuation = z.infer<typeof frozenContinuationSchema>;
export const continuationSourceContentSchema = z.object({
  sourceRunId: z.string().uuid(), question: z.string().min(1).max(4_000),
  status: z.enum(["completed", "partially_completed"]), promptVersion: z.string().min(1).max(128),
  promptFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  report: z.record(z.string(), z.unknown()), continuationContext: z.unknown().nullable(),
  earlierCompactionArchive: z.unknown().optional(),
});
export const continuationCompactionPacketSchema = z.object({
  version: z.literal("continuation-compaction-source-v1"),
  sourceRunId: z.string().uuid(),
  sourceRiskProfile: riskProfileSchema,
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceQuestion: z.string().min(1).max(4_000),
  sourceStatus: z.enum(["completed", "partially_completed"]),
  sourcePromptVersion: z.string().min(1).max(128),
  sourcePromptFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  originalContent: z.string().min(1).max(MAX_CONTINUATION_ARCHIVE_BYTES),
  originalBytes: z.number().int().min(1).max(MAX_CONTINUATION_ARCHIVE_BYTES),
  omissions: z.array(z.object({
    section: z.enum(["report", "earlier-context", "earlier-archive"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().min(1).max(MAX_CONTINUATION_ARCHIVE_BYTES),
  }).strict()).min(1).max(3),
}).strict();
export type ContinuationCompactionPacket = z.infer<typeof continuationCompactionPacketSchema>;
export const continuationArchiveSchema = z.object({
  version: z.literal("continuation-compaction-archive-v1"),
  packet: continuationCompactionPacketSchema,
  selection: manualContinuationCompactionSchema,
  deliveredSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ContinuationArchive = z.infer<typeof continuationArchiveSchema>;

export const createRunRequestSchema = z.object({
  knowledgePacket: knowledgePacketReferenceSchema.optional(),
  continuationSource: continuationSourceSchema.optional(),
  question: z.string().trim().min(10).max(4_000),
  idempotencyKey: z.string().min(8).max(128),
  scenario: z.enum(["success", "member-b-fails"]).default("success"),
  providerMode: z.enum(["fake", "remote", "openai"]).default("fake"),
  riskProfile: riskProfileSchema.optional(),
  reviewRounds: reviewRoundCountSchema.default(1),
  selfRevisionEnabled: z.boolean().optional(),
  executionLimits: executionLimitsSchema.optional(),
  memoryEntryIds: z.array(z.string().uuid()).max(5).default([]),
  attachments: z.array(runAttachmentSchema).max(MAX_RUN_ATTACHMENTS).optional(),
  toolResultIds: z.array(z.string().uuid()).max(3).optional(),
  retrieveToolContext: z.boolean().optional(),
  expectedPreflightFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  expectedRiskFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  previewImages: z.array(preflightPreviewImageSchema).max(MAX_RUN_ATTACHMENTS).optional(),
  preflightDecision: preflightDecisionSchema.optional(),
  promptRevision: promptRevisionSchema.optional(),
  members: councilMembersSchema.optional(),
}).superRefine((request, context) => {
  if (request.knowledgePacket && (!request.expectedPreflightFingerprint || !request.expectedRiskFingerprint))
    context.addIssue({ code: "custom", message: "Kaynak paketi için güncel istem ve risk incelemesi gerekli.", path: ["knowledgePacket"] });
  if (request.selfRevisionEnabled && request.reviewRounds === 0) context.addIssue({
    code: "custom", message: "Öz düzeltme için en az bir çapraz inceleme turu gerekli.", path: ["selfRevisionEnabled"],
  });
  if (request.promptRevision) {
    const { originalQuestion, candidateQuestion, choice } = request.promptRevision;
    if (request.question !== (choice === "candidate" ? candidateQuestion : originalQuestion)) context.addIssue({
      code: "custom", message: "Seçilen istem revizyonu gönderilen soruyla eşleşmiyor.", path: ["promptRevision"],
    });
    if (choice === "candidate" && (candidateQuestion.indexOf(originalQuestion) < 0 ||
      candidateQuestion.indexOf(originalQuestion, candidateQuestion.indexOf(originalQuestion) + originalQuestion.length) >= 0)) context.addIssue({
      code: "custom", message: "Aday istem özgün soruyu tam ve tek kez içermeli.", path: ["promptRevision"],
    });
  }
  if (request.providerMode !== "fake" && !request.members) {
    context.addIssue({
      code: "custom",
      message: "Uzak sağlayıcı modu için açık üye yapılandırması gerekli.",
      path: ["members"],
    });
  }
  if (request.riskProfile === "high") {
    if (request.reviewRounds < 1) context.addIssue({
      code: "custom", message: "Yüksek riskte en az bir çapraz inceleme turu zorunlu.", path: ["reviewRounds"],
    });
    if (!(request.members ?? defaultFakeCouncilMembers).some((member) => member.councilRole === "red-team")) context.addIssue({
      code: "custom", message: "Yüksek riskte en az bir red-team üyesi zorunlu.", path: ["members"],
    });
  }
  const expectsFake = request.providerMode === "fake";
  if (
    request.members?.some((member) =>
      expectsFake ? member.provider !== "fake" : member.provider === "fake",
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Deneme ve uzak sağlayıcı üyeleri aynı run içinde karıştırılamaz.",
      path: ["members"],
    });
  }
  if (new Set(request.memoryEntryIds).size !== request.memoryEntryIds.length) {
    context.addIssue({
      code: "custom",
      message: "Bellek kaydı kimlikleri benzersiz olmalı.",
      path: ["memoryEntryIds"],
    });
  }
  if (request.toolResultIds && new Set(request.toolResultIds).size !== request.toolResultIds.length) {
    context.addIssue({
      code: "custom",
      message: "Araç sonucu kimlikleri benzersiz olmalı.",
      path: ["toolResultIds"],
    });
  }
  const attachments = request.attachments ?? [];
  if (request.previewImages) {
    const actualImages = attachments.filter((attachment) => attachment.mimeType !== "application/pdf")
      .map(({ sha256, mimeType }) => `${sha256}:${mimeType}`).sort();
    const previewImages = request.previewImages.map(({ sha256, mimeType }) => `${sha256}:${mimeType}`).sort();
    if (JSON.stringify(actualImages) !== JSON.stringify(previewImages)) context.addIssue({
      code: "custom", message: "Görsel önizleme bilgileri eklerle eşleşmeli.", path: ["previewImages"],
    });
  }
  let totalBytes = 0;
  attachments.forEach((attachment, index) => {
    const padding = attachment.dataBase64.endsWith("==") ? 2 : attachment.dataBase64.endsWith("=") ? 1 : 0;
    const byteLength = Math.floor((attachment.dataBase64.length * 3) / 4) - padding;
    totalBytes += byteLength;
    const limit = attachment.mimeType === "application/pdf"
      ? MAX_PDF_ATTACHMENT_BYTES
      : MAX_ATTACHMENT_BYTES;
    if (byteLength > limit) {
      context.addIssue({
        code: "custom",
        message: attachment.mimeType === "application/pdf"
          ? "Her PDF en fazla 5 MiB olabilir."
          : "Her görsel en fazla 2 MiB olabilir.",
        path: ["attachments", index, "dataBase64"],
      });
    }
  });
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    context.addIssue({
      code: "custom",
      message: "Eklerin toplam boyutu en fazla 12 MiB olabilir.",
      path: ["attachments"],
    });
  }
});

export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const saveMcpConnectionSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(80),
  endpoint: z.string().trim().url().max(2_048),
});
export type SaveMcpConnectionRequest = z.infer<typeof saveMcpConnectionSchema>;

export const invokeMcpToolSchema = z.object({
  connectionId: z.string().uuid(),
  toolName: z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  arguments: z.record(z.string(), z.unknown()),
});
export type InvokeMcpToolRequest = z.infer<typeof invokeMcpToolSchema>;

export const scheduleCadenceSchema = z.enum(["daily", "weekly"]);
export type ScheduleCadence = z.infer<typeof scheduleCadenceSchema>;

export const createScheduleSchema = z.object({
  requestId: z.string().uuid().optional(),
  continuationSource: z.never().optional(),
  name: z.string().trim().min(1).max(80),
  question: z.string().trim().min(10).max(4_000),
  providerMode: z.enum(["fake", "remote"]),
  riskProfile: riskProfileSchema.optional(),
  reviewRounds: reviewRoundCountSchema.default(1),
  selfRevisionEnabled: z.boolean().optional(),
  executionLimits: executionLimitsSchema.optional(),
  cadence: scheduleCadenceSchema,
  nextRunAt: z.iso.datetime(),
  members: councilMembersSchema,
}).superRefine((request, context) => {
  if (request.selfRevisionEnabled && request.reviewRounds === 0) context.addIssue({
    code: "custom", message: "Öz düzeltme için en az bir çapraz inceleme turu gerekli.", path: ["selfRevisionEnabled"],
  });
  const expectsFake = request.providerMode === "fake";
  if (request.members.some((member) => expectsFake ? member.provider !== "fake" : member.provider === "fake")) {
    context.addIssue({ code: "custom", message: "Zamanlama sağlayıcı modu üyelerle eşleşmeli.", path: ["members"] });
  }
  if (request.riskProfile === "high") {
    if (request.reviewRounds < 1) context.addIssue({ code: "custom", message: "Yüksek riskte çapraz inceleme zorunlu.", path: ["reviewRounds"] });
    if (!request.members.some((member) => member.councilRole === "red-team")) context.addIssue({ code: "custom", message: "Yüksek riskte red-team üyesi zorunlu.", path: ["members"] });
  }
});
export type CreateScheduleRequest = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = z.object({ status: z.enum(["active", "paused"]) });
export type UpdateScheduleRequest = z.infer<typeof updateScheduleSchema>;
export const deleteLocalScheduleSchema = z.object({ scheduleId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmContentDeletion: z.literal(true), acknowledgeRetainedRuns: z.literal(true) }).strict();
export const localScheduleDeletionReceiptSchema = z.object({ version: z.literal("local-schedule-deletion-v1"), scheduleId: z.string().uuid(),
  creationRequestId: z.string().uuid().nullable(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), deletedAt: z.string().datetime(),
  retainedLastRunId: z.string().uuid().nullable() }).strict();
export type LocalScheduleDeletionReceipt = z.infer<typeof localScheduleDeletionReceiptSchema>;

export const saveCouncilTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).default(""),
  members: councilMembersSchema,
}).strict().superRefine((value, context) => {
  if (Boolean(value.id) === Boolean(value.requestId)) context.addIssue({ code: "custom", message: "Supply an update id or a creation request id, exclusively." });
});

export type SaveCouncilTemplateRequest = z.infer<typeof saveCouncilTemplateSchema>;
export const deleteCouncilTemplateSchema = z.object({ templateId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmContentDeletion: z.literal(true), acknowledgeRetainedCopies: z.literal(true) }).strict();
export const councilTemplateDeletionReceiptSchema = z.object({ version: z.literal("council-template-deletion-v1"), templateId: z.string().uuid(),
  creationRequestId: z.string().uuid().nullable(), creationRequestHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), deletedAt: z.string().datetime(), memberCount: z.number().int().min(2).max(6) }).strict();
export type CouncilTemplateDeletionReceipt = z.infer<typeof councilTemplateDeletionReceiptSchema>;

const claimCore = {
  statement: z.string().trim().min(1).max(1_000),
  kind: z.enum(["shared", "recommendation", "objection", "risk"]),
  quote: z.string().trim().min(1).max(1_000),
} as const;

export const reviewStanceSchema = z.enum(["support", "qualify", "challenge"]);

export const evidenceStateSchema = z.enum([
  "unsupported",
  "model-supported",
  "externally-verified",
  "contradicted",
  "stale",
]);

export type EvidenceState = z.infer<typeof evidenceStateSchema>;

export const evidenceRelationSchema = z.enum(["supports", "contradicts", "context"]);
export type EvidenceRelation = z.infer<typeof evidenceRelationSchema>;

export const evidenceReviewStatusSchema = z.enum(["unreviewed", "verified", "rejected"]);
export type EvidenceReviewStatus = z.infer<typeof evidenceReviewStatusSchema>;

export const evidenceFreshnessStatusSchema = z.enum([
  "unreviewed",
  "current",
  "needs-review",
  "stale",
  "changed",
  "inaccessible",
]);
export type EvidenceFreshnessStatus = z.infer<typeof evidenceFreshnessStatusSchema>;

export const saveEvidenceSourceSchema = z.object({
  runId: z.string().uuid(),
  claimId: z.string().trim().regex(/^(?:claim|red-team)-\d{3}$/),
  title: z.string().trim().min(1).max(160),
  url: z.string().trim().url().max(2_048),
  relation: evidenceRelationSchema,
  excerpt: z.string().trim().min(1).max(4_000),
  publishedAt: z.iso.date().optional(),
  note: z.string().trim().max(1_000).default(""),
});

export type SaveEvidenceSourceRequest = z.infer<typeof saveEvidenceSourceSchema>;

// A citation is model text, never a captured passage from the cited document.
const candidateCommon = {
  requestId: z.string().uuid(), runId: z.string().uuid(),
  claimId: z.string().regex(/^(?:claim|red-team)-\d{3}$/),
  relation: evidenceRelationSchema,
  relatedSourceId: z.string().uuid().optional(),
};
export const createEvidenceCandidateSchema = z.discriminatedUnion("origin", [
  z.object({ ...candidateCommon, origin: z.literal("owner"),
    title: z.string().trim().min(1).max(160),
    url: z.string().url().max(2048).refine((value) => /^https?:\/\//i.test(value)),
    excerpt: z.string().min(1).max(4000).refine((value) => value.trim().length > 0),
    publishedAt: z.iso.date().optional(), note: z.string().trim().max(1000).default("") }).strict(),
  z.object({ ...candidateCommon, origin: z.literal("model-citation"),
    memberId: z.string().min(1).max(64), citationIndex: z.number().int().min(0).max(99) }).strict(),
  z.object({ ...candidateCommon, origin: z.literal("local-excerpt"),
    excerptId: z.string().uuid() }).strict(),
]);
export type CreateEvidenceCandidate = z.infer<typeof createEvidenceCandidateSchema>;
export const evidenceCandidateProvenanceSchema = z.object({
  version: z.literal("evidence-candidate-v1"), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  origin: z.enum(["owner", "model-citation", "local-excerpt"]),
  relatedSourceId: z.string().uuid().nullable(), statement: z.string().min(1).max(1000),
  model: z.object({ memberId: z.string().min(1).max(64), label: z.string().max(160),
    citationIndex: z.number().int().min(0).max(99), passage: z.string().max(1000),
    rawSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
  localExcerpt: knowledgeExcerptSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.origin === "model-citation") !== Boolean(value.model) ||
      (value.origin === "local-excerpt") !== Boolean(value.localExcerpt)) {
    context.addIssue({ code: "custom", message: "Candidate origin/provenance mismatch." });
  }
});
export type EvidenceCandidateProvenance = z.infer<typeof evidenceCandidateProvenanceSchema>;

const publicationDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const evidencePublicationDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), scope: knowledgeScopeSchema }).strict(),
  z.object({ kind: z.literal("manual"), name: z.string().trim().min(1).max(160), account: z.string().trim().min(1).max(160),
    url: z.string().url().max(2048).refine((value) => /^https:\/\//i.test(value)) }).strict(),
]);
export const evidencePublicationPreviewRequestSchema = z.object({ candidateId: z.string().uuid(), destination: evidencePublicationDestinationSchema }).strict();
export const evidencePublicationCommitSchema = evidencePublicationPreviewRequestSchema.extend({ requestId: z.string().uuid(), fingerprint: publicationDigest, consent: z.literal(true) }).strict();
export const evidencePublicationBodySchema = z.object({
  version: z.literal("evidence-publication-v1"), id: z.string().uuid(), ownerId: z.string().min(1).max(100), requestHash: publicationDigest, fingerprint: publicationDigest,
  destination: evidencePublicationDestinationSchema, destinationTitle: z.string().min(1).max(200), createdAt: z.iso.datetime(),
  sourceId: z.string().uuid().nullable(), versionId: z.string().uuid().nullable(),
  candidate: z.object({ id: z.string().uuid(), runId: z.string().uuid(), claimId: z.string().regex(/^(?:claim|red-team)-\d{3}$/),
    title: z.string().min(1).max(160), url: z.string().max(2048), excerpt: z.string().min(1).max(4000), note: z.string().max(1000),
    relation: evidenceRelationSchema, reviewStatus: z.literal("verified"), freshnessStatus: z.literal("current"),
    capturedAt: z.iso.datetime(), publishedAt: z.iso.date().nullable(), freshnessReviewedAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
    provenance: evidenceCandidateProvenanceSchema }).strict(),
}).strict().superRefine((value, ctx) => {
  if ((value.destination.kind === "local") !== Boolean(value.sourceId && value.versionId)
    || (value.destination.kind === "manual" && (value.sourceId !== null || value.versionId !== null))) ctx.addIssue({ code: "custom", message: "Publication destination identity mismatch." });
  if (value.candidate.provenance.origin === "model-citation" || value.candidate.provenance.localExcerpt && value.candidate.provenance.localExcerpt.text !== value.candidate.excerpt
    || value.destination.kind === "local" && (value.destination.scope.ownerId !== value.ownerId || value.destination.scope.accountId !== "local")) ctx.addIssue({ code: "custom", message: "Publication original or owner mismatch." });
});
export type EvidencePublicationBody = z.infer<typeof evidencePublicationBodySchema>;
export type EvidencePublicationPreviewRequest = z.infer<typeof evidencePublicationPreviewRequestSchema>;
export type EvidencePublicationCommit = z.infer<typeof evidencePublicationCommitSchema>;

export const updateEvidenceSourceSchema = z
  .object({
    reviewStatus: evidenceReviewStatusSchema.optional(),
    freshnessStatus: evidenceFreshnessStatusSchema.optional(),
  })
  .refine(
    (value) => value.reviewStatus !== undefined || value.freshnessStatus !== undefined,
    "En az bir inceleme alanı gerekli.",
  );

export type UpdateEvidenceSourceRequest = z.infer<typeof updateEvidenceSourceSchema>;

export const evidenceSourceIdSchema = z.string().uuid();

export const createResearchCaptureSchema = z.object({
  runId: z.string().uuid(),
  claimId: z.string().trim().regex(/^(?:claim|red-team)-\d{3}$/),
  url: z.string().trim().url().max(2_048),
  renderMode: z.enum(["direct", "browser"]).default("direct"),
});

export type CreateResearchCaptureRequest = z.infer<typeof createResearchCaptureSchema>;

export const researchCaptureIdSchema = z.string().uuid();

export const promoteResearchCaptureSchema = z.object({
  relation: evidenceRelationSchema,
  excerpt: z.string().trim().min(1).max(4_000),
  publishedAt: z.iso.date().optional(),
  note: z.string().trim().max(1_000).default(""),
});

export type PromoteResearchCaptureRequest = z.infer<typeof promoteResearchCaptureSchema>;

export const rejectResearchCaptureSchema = z.object({
  action: z.literal("reject"),
});

export const frozenMemoryEntrySchema = z.object({
  id: z.string().uuid(),
  content: z.string().trim().min(1).max(1_000),
  evidenceState: evidenceStateSchema,
  sourceType: memorySourceTypeSchema,
});

export type FrozenMemoryEntry = z.infer<typeof frozenMemoryEntrySchema>;

export const saveMemoryEntrySchema = z.object({
  runId: z.string().uuid(),
  claimId: z.string().trim().regex(/^(?:claim|red-team)-\d{3}$/),
});

export type SaveMemoryEntryRequest = z.infer<typeof saveMemoryEntrySchema>;
export const memoryEntryIdSchema = z.string().uuid();

export const updateClaimEvidenceStateSchema = z.object({
  evidenceState: evidenceStateSchema,
});

export type UpdateClaimEvidenceStateRequest = z.infer<
  typeof updateClaimEvidenceStateSchema
>;

export const synthesisCoverageSchema = z.enum(["included", "omitted", "unresolved"]);
export type SynthesisCoverage = z.infer<typeof synthesisCoverageSchema>;

export const claimRelationKindSchema = z.enum(["supports", "contradicts", "qualifies", "different-scope"]);
export type ClaimRelationKind = z.infer<typeof claimRelationKindSchema>;
const reportClaimIdSchema = z.string().regex(/^(?:claim|red-team)-\d{3}$/);
export const updateClaimScopeSchema = z.object({ scopeNote: z.string().trim().max(500) });
export type UpdateClaimScopeRequest = z.infer<typeof updateClaimScopeSchema>;
export const saveClaimRelationSchema = z.object({
  fromClaimId: reportClaimIdSchema,
  toClaimId: reportClaimIdSchema,
  kind: claimRelationKindSchema,
  note: z.string().trim().min(1).max(500),
}).refine((value) => value.fromClaimId !== value.toClaimId, "Bir iddia kendisiyle ilişkilendirilemez.");
export type SaveClaimRelationRequest = z.infer<typeof saveClaimRelationSchema>;
export const deleteClaimRelationSchema = z.object({
  fromClaimId: reportClaimIdSchema,
  toClaimId: reportClaimIdSchema,
}).refine((value) => value.fromClaimId !== value.toClaimId, "Bir iddia kendisiyle ilişkilendirilemez.");
export type DeleteClaimRelationRequest = z.infer<typeof deleteClaimRelationSchema>;

export const updateClaimSynthesisCoverageSchema = z.object({
  synthesisCoverage: synthesisCoverageSchema,
});

export type UpdateClaimSynthesisCoverageRequest = z.infer<
  typeof updateClaimSynthesisCoverageSchema
>;

export const claimSchema = z.object({
  ...claimCore,
});

export const providerOutputSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  claims: z.array(claimSchema).min(1).max(20),
});

export type ProviderOutput = z.infer<typeof providerOutputSchema>;

export const crossReviewOutputSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  claims: z
    .array(
      z.object({
        ...claimCore,
        targetMemberId: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
        reviewStance: reviewStanceSchema,
      }),
    )
    .min(1)
    .max(30),
});

export type CrossReviewOutput = z.infer<typeof crossReviewOutputSchema>;

export const crossReviewWithRevisionOutputSchema = crossReviewOutputSchema.extend({
  selfRevisions: z.array(z.object({
    sourceClaimIndex: z.number().int().min(0).max(19),
    action: z.enum(["qualify", "withdraw"]),
    statement: z.string().trim().min(1).max(1_000),
    reason: z.string().trim().min(1).max(1_000),
  })).max(5),
});
export type CrossReviewWithRevisionOutput = z.infer<typeof crossReviewWithRevisionOutputSchema>;

export const runStatusSchema = z.enum([
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
]);

export type RunStatus = z.infer<typeof runStatusSchema>;

export const saveProviderConnectionSchema = z.object({
  id: z.string().uuid().optional(),
  provider: remoteProviderSchema,
  label: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().max(512).default(""),
  defaultModel: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().url().max(2_048).optional(),
  endpointPreset: endpointPresetSchema.default("custom"),
  reasoningProtocol: reasoningProtocolSchema.default("none"),
  structuredOutputMode: structuredOutputModeSchema.default("json-object"),
}).superRefine((connection, context) => {
  if (connection.endpointPreset === "nvidia" && (connection.provider !== "openai-compatible" || connection.baseUrl !== NVIDIA_HOSTED_BASE_URL
    || connection.reasoningProtocol !== "none" || connection.structuredOutputMode !== "prompt-only")) {
    context.addIssue({ code: "custom", message: "NVIDIA hosted bağlantısı sabit HTTPS adresi, düşünme parametresi kapalı ve yalnız istem sözleşmesi gerektirir.", path: ["endpointPreset"] });
  }
  if (connection.provider === "openai-compatible" && !connection.baseUrl) {
    context.addIssue({
      code: "custom",
      message: "OpenAI uyumlu bağlantı için temel URL gerekli.",
      path: ["baseUrl"],
    });
  }
  const localPreset = ["ollama", "vllm", "litellm"].includes(connection.endpointPreset);
  if (!connection.id && !localPreset && connection.apiKey.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Bulut sağlayıcı bağlantısı için API anahtarı gerekli.",
      path: ["apiKey"],
    });
  }
});

export type SaveProviderConnectionRequest = z.infer<typeof saveProviderConnectionSchema>;

export const catalogModelDetailSchema = z.strictObject({
  id: z.string().min(1).max(120),
  displayName: z.string().max(128).optional(),
  inputTokenLimit: z.number().int().positive().max(100_000_000).optional(),
  outputTokenLimit: z.number().int().positive().max(100_000_000).optional(),
  contextWindowTokens: z.number().int().positive().max(100_000_000).optional(),
  reasoningLevels: z.array(z.enum(["minimal", "low", "medium", "high", "xhigh", "max"])).max(6).optional(),
  thinking: z.boolean().optional(),
  reasoningParameterListed: z.literal(true).optional(),
});

export type CatalogModelDetail = z.infer<typeof catalogModelDetailSchema>;

export const modelCatalogCheckSchema = z.strictObject({
  status: z.enum(["available", "auth_failed", "unavailable", "unsupported"]),
  verification: z.enum(["authenticated_catalog", "catalog_only", "none"]),
  models: z.array(z.string().min(1).max(120)).max(300),
  details: z.array(catalogModelDetailSchema).max(300).optional(),
  checkedAt: z.iso.datetime().optional(),
  truncated: z.boolean(),
});

export type ModelCatalogCheck = z.infer<typeof modelCatalogCheckSchema>;

export const resolveProviderOperationSchema = z.object({
  action: z.enum(["discard", "authorize_retry"]),
});

export type ResolveProviderOperationRequest = z.infer<
  typeof resolveProviderOperationSchema
>;
