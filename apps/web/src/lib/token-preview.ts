import type { CouncilMemberConfig, FrozenContinuation, FrozenMemoryEntry, FrozenToolContext, RemoteProvider, RiskProfile, ReviewRoundCount } from "@deliberation-ai/contracts";
import { buildRoundZeroPromptPlan, buildRiskPreflight, findCriticalMissingContext, type RoundZeroPromptPlan } from "@deliberation-ai/application";
import { getEncoding } from "js-tiktoken";

export type PreviewImage = { mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; sha256: string; width: number; height: number };
export type PreviewDocument = { name: string; sha256: string; content: string };
export type TokenPreviewMember = { id: string; label: string; model: string; provider: CouncilMemberConfig["provider"]; textTokens: number; imageTokens: number; documentTokens: number; totalTokens: number };
export type TokenPreview = { totalTokens: number; questionTokens: number; textTokens: number; imageTokens: number; documentTokens: number; members: TokenPreviewMember[]; imageCount: number; documentCount: number; contextEntryCount: number; promptPlan: RoundZeroPromptPlan | null; riskPreflight: ReturnType<typeof buildRiskPreflight> | null; missingContextQuestions?: ReturnType<typeof findCriticalMissingContext> };

const encoding = getEncoding("o200k_base");

function imageTokens(image: PreviewImage, provider: RemoteProvider): number {
  // Providers may resize, crop or patch images differently. These are local planning estimates.
  const pixels = image.width * image.height;
  if (provider === "anthropic") return Math.max(1, Math.ceil(Math.min(pixels, 1_568 * 1_568) / (28 * 28)));
  if (provider === "google") return Math.max(258, Math.ceil(pixels / (768 * 768)) * 258);
  return Math.max(1, Math.ceil(Math.min(pixels, 2_048 * 2_048) / (32 * 32) * 1.62));
}

export function estimateTokenPreview(input: {
  question: string;
  continuationContext?: FrozenContinuation | null | undefined;
  members: CouncilMemberConfig[];
  images: PreviewImage[];
  documents: PreviewDocument[];
  memoryContext: FrozenMemoryEntry[];
  toolContext: FrozenToolContext[];
  riskProfile?: RiskProfile;
  reviewRounds?: ReviewRoundCount;
}): TokenPreview {
  if (!input.question.trim() && input.images.length === 0 && input.documents.length === 0) {
    return { totalTokens: 0, questionTokens: 0, textTokens: 0, imageTokens: 0, documentTokens: 0, members: [], imageCount: 0, documentCount: 0, contextEntryCount: 0, promptPlan: null, riskPreflight: null };
  }
  const promptPlan = buildRoundZeroPromptPlan({
    question: input.question,
    continuationContext: input.continuationContext,
    members: input.members,
    memoryContext: input.memoryContext,
    toolContext: input.toolContext,
    documents: input.documents,
    images: input.images.map(({ mimeType, sha256 }) => ({ mimeType, sha256 })),
  });
  const members = input.members.map((member): TokenPreviewMember => {
    const prompt = promptPlan.members.find((item) => item.id === member.id)!;
    const textTokens = encoding.encode(prompt.instructions).length + encoding.encode(prompt.userInput).length;
    const memberImages = member.provider !== "fake" && member.receiveAttachments ? input.images : [];
    const imageTokenCount = member.provider === "fake" ? 0 : memberImages.reduce((sum, image) => sum + imageTokens(image, member.provider as RemoteProvider), 0);
    const memberDocumentTokens = member.receiveAttachments
      ? input.documents.reduce((sum, document) => sum + encoding.encode(`${document.name}\n${document.content}`).length, 0)
      : 0;
    return { id: member.id, label: member.label, model: member.model, provider: member.provider, textTokens, imageTokens: imageTokenCount, documentTokens: memberDocumentTokens, totalTokens: textTokens + imageTokenCount };
  });
  return {
    totalTokens: members.reduce((sum, member) => sum + member.totalTokens, 0),
    questionTokens: encoding.encode(input.question.trim()).length,
    textTokens: members.reduce((sum, member) => sum + member.textTokens, 0),
    imageTokens: members.reduce((sum, member) => sum + member.imageTokens, 0),
    documentTokens: Math.max(0, ...members.map((member) => member.documentTokens)),
    members,
    imageCount: input.images.length,
    documentCount: input.documents.length,
    contextEntryCount: input.memoryContext.length + input.toolContext.length + (input.continuationContext ? 1 : 0),
    promptPlan,
    riskPreflight: buildRiskPreflight({
      question: input.question, requestedProfile: input.riskProfile,
      continuationContext: input.continuationContext,
      documents: input.members.some((member) => member.receiveAttachments) ? input.documents : [],
      imageCount: input.members.some((member) => member.receiveAttachments) ? input.images.length : 0,
      memoryContext: input.memoryContext, toolContext: input.toolContext,
      promptFingerprint: promptPlan.fingerprint, reviewRounds: input.reviewRounds ?? 1,
    }),
    missingContextQuestions: findCriticalMissingContext(input.question),
  };
}
