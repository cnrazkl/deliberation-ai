import { createHash, randomUUID } from "node:crypto";
export * from "./synthesis";
export * from "./contradiction-hosted";
import { buildRoundZeroPromptPlan } from "./prompt-plan";
export { buildRiskPreflight } from "./risk-preflight";
export { assertKnowledgeInputBudget } from "./knowledge-budget";
export { freezeContinuation, validateContinuation } from "./continuation";
export { prepareContinuationCompaction, buildCompactedContinuation, validateContinuationArchive } from "./continuation-compaction";
export { RiskConfigurationError } from "@deliberation-ai/domain";
export { MissingContextError, findCriticalMissingContext } from "@deliberation-ai/domain";
export { buildRoundZeroPromptPlan, buildReviewInstructionPlan, COUNCIL_PROMPT_VERSION, type RoundZeroPromptPlan } from "./prompt-plan";
import {
  crossReviewOutputSchema,
  crossReviewWithRevisionOutputSchema,
  defaultFakeCouncilMembers,
  type CouncilMemberConfig,
  type CreateRunRequest,
  type FrozenContinuation,
  type ContinuationArchive,
  type RiskProfile,
  type RiskAssessment,
  type ReviewRoundCount,
  type ExecutionLimits,
  type CrossReviewRound,
  type PreflightDecision,
  type PromptRevisionRequest,
} from "@deliberation-ai/contracts";
import {
  agreementSourceForMember,
  assessRequestRisk,
  assertRiskConfiguration,
  findCriticalMissingContext,
  MissingContextError,
  auditPromptRevision,
  RiskConfigurationError,
  applyRiskControls,
  buildCouncilReport,
  type CouncilMemberResult,
  type CouncilReport,
  type CouncilReviewResult,
  type CrossReviewPromptPlan,
  type MemberFailure,
  type ReviewFailure,
} from "@deliberation-ai/domain";
import {
  FakeProvider,
  inputFor,
  instructionsFor,
  NormalizedProviderError,
  type FrozenInputSnapshot,
  type ProviderRequest,
  type TextProvider,
} from "@deliberation-ai/providers";

export type RunRecord = {
  knowledgePacket?: import("@deliberation-ai/contracts").KnowledgePacket | null;
  runId: string;
  idempotencyKey: string;
  requestHash: string;
  question: string;
  promptVersion: string;
  promptFingerprint: string | null;
  providerMode?: "fake" | "remote";
  reviewRounds?: ReviewRoundCount;
  executionLimits?: ExecutionLimits | null;
  riskProfile: RiskProfile;
  riskAssessment?: RiskAssessment | null;
  preflightDecision?: (PreflightDecision & { originalQuestion: string; questions: Array<{ id: string; question: string; reason: string }>; policyVersion: string }) | null;
  promptRevision?: { revision: PromptRevisionRequest; audit: ReturnType<typeof auditPromptRevision> } | null;
  snapshotId: string;
  memberCount: number;
  memoryEntryCount: number;
  attachmentCount: number;
  toolResultCount: number;
  createdAt: string;
  status: "queued" | "running" | CouncilReport["status"];
  report: CouncilReport | null;
  continuationContext?: FrozenContinuation | null;
  continuationArchive?: ContinuationArchive | null;
  followUp?: { version: "member-rerun-v1"; sourceRunId: string; rerunMemberId: string; reusedMemberIds: string[]; maximumProviderCalls: number } | null;
};

export interface RunRepository {
  findByIdempotencyKey(key: string): Promise<RunRecord | undefined>;
  findById(id: string): Promise<RunRecord | undefined>;
  save(run: RunRecord): Promise<void>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Aynı idempotency anahtarı farklı bir istekle kullanıldı.");
    this.name = "IdempotencyConflictError";
  }
}

export function resolveRunMembers(request: CreateRunRequest): CouncilMemberConfig[] {
  if (!request.members && request.providerMode !== "fake") {
    throw new Error("Uzak sağlayıcı modu açık üye yapılandırması gerektirir.");
  }
  const members = (request.members ?? defaultFakeCouncilMembers).map((member) => ({ ...member }));
  if (request.riskProfile === "high" && (request.reviewRounds < 1 || !members.some((member) => member.councilRole === "red-team"))) {
    throw new RiskConfigurationError(assessRequestRisk({ question: request.question, requestedProfile: "high" }));
  }
  return members;
}

export const hashRunRequest = (request: CreateRunRequest): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        question: request.question,
        ...(request.continuationSource ? { continuationSource: request.continuationSource } : {}),
        scenario: request.scenario,
        providerMode: request.providerMode,
        riskProfile: request.riskProfile ?? "standard",
        reviewRounds: request.reviewRounds,
        ...(request.selfRevisionEnabled ? { selfRevisionEnabled: true } : {}),
        ...(request.executionLimits ? { executionLimits: request.executionLimits } : {}),
        memoryEntryIds: request.memoryEntryIds,
        ...(request.knowledgePacket ? { knowledgePacket: request.knowledgePacket } : {}),
        toolResultIds: request.toolResultIds ?? [],
        retrieveToolContext: request.retrieveToolContext === true,
        expectedPreflightFingerprint: request.expectedPreflightFingerprint ?? null,
        ...(request.expectedRiskFingerprint ? { expectedRiskFingerprint: request.expectedRiskFingerprint } : {}),
        ...(request.previewImages ? { previewImages: request.previewImages } : {}),
        ...(request.preflightDecision ? { preflightDecision: request.preflightDecision } : {}),
        ...(request.promptRevision ? { promptRevision: request.promptRevision } : {}),
        attachments: (request.attachments ?? []).map(({ name, mimeType, sha256 }) => ({ name, mimeType, sha256 })),
        members: resolveRunMembers(request),
      }),
    )
    .digest("hex");

export async function createFakeCouncilRun(
  request: CreateRunRequest,
  repository: RunRepository,
): Promise<RunRecord> {
  if (request.continuationSource || request.knowledgePacket) throw new Error("Devam veya kaynak bağlamı kalıcı çalışma deposunda çözülmeli.");
  const requestHash = hashRunRequest(request);
  const existing = await repository.findByIdempotencyKey(request.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError();
    }
    return existing;
  }

  const runId = randomUUID();
  const snapshot: FrozenInputSnapshot = {
    snapshotId: randomUUID(),
    question: request.question,
    memoryContext: [],
  };
  const members = resolveRunMembers(request);
  const riskAssessment = assessRequestRisk({ question: request.question, requestedProfile: request.riskProfile });
  assertRiskConfiguration(riskAssessment, members, request.reviewRounds);
  const promptPlan = buildRoundZeroPromptPlan({ question: request.question, members, memoryContext: [], toolContext: [], documents: [], images: [] });
  const report = applyRiskControls(await executeFakeCouncil(
    snapshot,
    request.scenario,
    members,
    request.reviewRounds,
    request.selfRevisionEnabled === true,
  ), riskAssessment.effectiveProfile, members, request.reviewRounds);

  const run: RunRecord = {
    runId,
    idempotencyKey: request.idempotencyKey,
    requestHash,
    question: request.question,
    promptVersion: promptPlan.version,
    promptFingerprint: promptPlan.fingerprint,
    providerMode: "fake",
    reviewRounds: request.reviewRounds,
    riskProfile: riskAssessment.effectiveProfile,
    riskAssessment,
    snapshotId: snapshot.snapshotId,
    memberCount: members.length,
    memoryEntryCount: 0,
    attachmentCount: request.attachments?.length ?? 0,
    toolResultCount: 0,
    createdAt: new Date().toISOString(),
    status: report.status,
    report,
  };
  await repository.save(run);
  return run;
}

export async function executeFakeCouncil(
  snapshot: FrozenInputSnapshot,
  scenario: CreateRunRequest["scenario"],
  members: CouncilMemberConfig[] = defaultFakeCouncilMembers,
  reviewRounds: ReviewRoundCount = 1,
  selfRevisionEnabled = false,
  reusedInitialResults: CouncilMemberResult[] = [],
): Promise<CouncilReport> {
  const providers: TextProvider[] = members.map((member, index) => {
    if (member.provider !== "fake" || !member.perspective) {
      throw new Error(`Deneme konseyi üyesi geçersiz: ${member.id}`);
    }
    return new FakeProvider({
      id: member.id,
      label: member.label,
      role: member.role,
      councilRole: member.councilRole,
      perspective: member.perspective,
      fail: scenario === "member-b-fails" && index === 1,
    });
  });

  return executeCouncil(snapshot, providers, reviewRounds, members, selfRevisionEnabled, reusedInitialResults);
}

export async function executeCouncil(
  snapshot: FrozenInputSnapshot,
  providers: TextProvider[],
  reviewRounds: ReviewRoundCount = 1,
  members: CouncilMemberConfig[] = [],
  selfRevisionEnabled = false,
  reusedInitialResults: CouncilMemberResult[] = [],
): Promise<CouncilReport> {
  if (selfRevisionEnabled && reviewRounds === 0) throw new Error("Öz düzeltme için en az bir çapraz inceleme turu gerekli.");
  const agreementSources = new Map(
    members.map((member) => [member.id, agreementSourceForMember(member)]),
  );
  const reusedByMember = new Map(reusedInitialResults.map((result) => [result.memberId, result]));
  if (reusedByMember.size !== reusedInitialResults.length ||
      reusedInitialResults.some((result) => !providers.some((provider) => provider.id === result.memberId) || !result.reusedFromRunId)) {
    throw new Error("Yeniden kullanılan ilk tur sonuçları üye yapılandırmasıyla eşleşmiyor.");
  }
  const attempts = await Promise.allSettled(
    providers.map(async (provider): Promise<CouncilMemberResult> => {
      const reused = reusedByMember.get(provider.id);
      if (reused) return reused;
      const result = await provider.generate({
        memberId: provider.id,
        role: provider.role ?? "independent analyst",
        councilRole: provider.councilRole,
        input: provider.receivesAttachments
          ? snapshot
          : { ...snapshot, attachments: [], documents: [] },
        round: 0,
      });
      const agreementSource = agreementSources.get(provider.id);
      return {
        memberId: provider.id,
        label: provider.label,
        councilRole: provider.councilRole,
        ...(agreementSource ? { agreementSource } : {}),
        rawText: result.rawText,
        parsed: result.parsed,
        citations: result.metadata?.citations ?? [],
      };
    }),
  );

  const memberResults: CouncilMemberResult[] = [];
  const failures: MemberFailure[] = [];
  attempts.forEach((attempt, index) => {
    const provider = providers[index];
    if (!provider) return;
    if (attempt.status === "fulfilled") {
      memberResults.push(attempt.value);
    } else {
      const normalized =
        attempt.reason instanceof NormalizedProviderError ? attempt.reason : undefined;
      failures.push({
        memberId: provider.id,
        label: provider.label,
        councilRole: provider.councilRole,
        code: normalized?.code ?? "provider_error",
        message: attempt.reason instanceof Error ? attempt.reason.message : "Unknown provider error",
        ...(normalized?.rawText !== undefined ? { rawText: normalized.rawText } : {}),
      });
    }
  });

  const reviews: CouncilReviewResult[] = [];
  const reviewFailures: ReviewFailure[] = [];
  const reviewPromptPlans: CrossReviewPromptPlan[] = [];
  let completedRounds: ReviewRoundCount = 0;
  let stopReason: "not_requested" | "insufficient_members" | "round_limit" | "prior_round_incomplete" =
    reviewRounds === 0 ? "not_requested" : memberResults.length < 2 ? "insufficient_members" : "round_limit";
  if (reviewRounds > 0 && memberResults.length >= 2) {
    const resultByMember = new Map(memberResults.map((result) => [result.memberId, result]));
    const reviewProviders = providers.filter((provider) => resultByMember.has(provider.id));
    for (let roundNumber = 1; roundNumber <= reviewRounds; roundNumber += 1) {
      const round = roundNumber as CrossReviewRound;
      const previousReviews = round > 1 ? reviews.filter((review) => review.round === round - 1) : [];
      const reviewRequests = reviewProviders.map((provider) => {
      const peers = memberResults
        .filter((member) => member.memberId !== provider.id)
        .map((member) => ({
          memberId: member.memberId,
          label: member.label,
          councilRole: member.councilRole,
          summary: member.parsed.summary,
          claims: member.parsed.claims,
        }));
      const request: ProviderRequest = {
        memberId: provider.id,
        role: provider.role ?? "independent analyst",
        councilRole: provider.councilRole,
        input: { ...snapshot, attachments: [], documents: [] },
        round,
        reviewContext: {
          peers,
          ...(selfRevisionEnabled ? { selfRevision: { ownInitial: resultByMember.get(provider.id)!.parsed } } : {}),
          ...(round > 1 ? {
            previousRound: (round - 1) as CrossReviewRound,
            previousReviews: previousReviews.map((review) => ({
              reviewerMemberId: review.reviewerMemberId,
              reviewerLabel: review.reviewerLabel,
              reviewerCouncilRole: review.reviewerCouncilRole,
              summary: review.parsed.summary,
              claims: review.parsed.claims,
            })),
          } : {}),
        },
      };
      const instructions = instructionsFor(request);
      const input = inputFor(request);
      const peerMemberIds = peers.map((peer) => peer.memberId);
      const version = selfRevisionEnabled ? "cross-review-v3" : round === 1 ? "cross-review-v1" : "cross-review-v2";
      const fingerprint = createHash("sha256").update(JSON.stringify({
        version, ...(round > 1 ? { round } : {}), reviewerMemberId: provider.id, peerMemberIds, instructions, input,
      })).digest("hex");
      const promptPlan: CrossReviewPromptPlan = {
        version, round, reviewerMemberId: provider.id,
        reviewerLabel: provider.label, peerMemberIds, instructions, input, fingerprint,
      };
      return { provider, peers, request, promptPlan };
    });
    reviewPromptPlans.push(...reviewRequests.map(({ promptPlan }) => promptPlan));
    const reviewAttempts = await Promise.allSettled(
      reviewRequests.map(async ({ provider, peers, request, promptPlan }): Promise<CouncilReviewResult> => {
        if (round > 1 && promptPlan.input.length > 80_000) {
          throw new NormalizedProviderError("Kapanmış inceleme paketi 80.000 karakter sınırını aştı; sonraki tur gönderilmedi.", "review_packet_too_large", "known", false);
        }
        const result = await provider.generate(request);
        const revisionParsed = selfRevisionEnabled ? crossReviewWithRevisionOutputSchema.parse(result.parsed) : null;
        const parsed = revisionParsed ?? crossReviewOutputSchema.parse(result.parsed);
        if (revisionParsed) {
          const initialClaims = resultByMember.get(provider.id)!.parsed.claims;
          const seen = new Set<number>();
          for (const revision of revisionParsed.selfRevisions) {
            if (revision.sourceClaimIndex >= initialClaims.length || seen.has(revision.sourceClaimIndex) ||
                (revision.action === "withdraw" && revision.statement !== initialClaims[revision.sourceClaimIndex]!.statement) ||
                (revision.action === "qualify" && revision.statement === initialClaims[revision.sourceClaimIndex]!.statement)) {
              throw new NormalizedProviderError("Öz düzeltme önerisi özgün iddiayla eşleşmiyor.", "invalid_self_revision", "known", false, result.rawText);
            }
            seen.add(revision.sourceClaimIndex);
          }
        }
        const peerIds = new Set(peers.map((peer) => peer.memberId));
        const reviewedIds = new Set(parsed.claims.map((claim) => claim.targetMemberId));
        if (
          parsed.claims.some((claim) => !peerIds.has(claim.targetMemberId)) ||
          peers.some((peer) => !reviewedIds.has(peer.memberId))
        ) {
          throw new NormalizedProviderError(
            "Çapraz inceleme hedefleri verilen üyelerle eşleşmiyor.",
            "invalid_cross_review_targets",
            "known",
            false,
          );
        }
        return {
          round,
          reviewerMemberId: provider.id,
          reviewerLabel: provider.label,
          reviewerCouncilRole: provider.councilRole,
          rawText: result.rawText,
          parsed,
          citations: result.metadata?.citations ?? [],
        };
      }),
    );
    reviewAttempts.forEach((attempt, index) => {
      const provider = reviewProviders[index];
      if (!provider) return;
      if (attempt.status === "fulfilled") {
        reviews.push(attempt.value);
      } else {
        const normalized =
          attempt.reason instanceof NormalizedProviderError ? attempt.reason : undefined;
        reviewFailures.push({
          memberId: provider.id,
          label: provider.label,
          councilRole: provider.councilRole,
          code: normalized?.code ?? "review_provider_error",
          message:
            attempt.reason instanceof Error ? attempt.reason.message : "Unknown review error",
          round,
          ...(normalized?.rawText !== undefined ? { rawText: normalized.rawText } : {}),
        });
      }
    });
    if (reviewFailures.some((failure) => failure.round === round)) {
      stopReason = "prior_round_incomplete";
      break;
    }
    completedRounds = round;
    }
  }

  return buildCouncilReport(memberResults, failures, reviews, reviewFailures, reviewPromptPlans, {
    requestedRounds: reviewRounds,
    completedRounds,
    stopReason,
  });
}
export * from "./knowledge";
export * from "./connection-check";
