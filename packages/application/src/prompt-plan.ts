import { createHash } from "node:crypto";
import type { CouncilMemberConfig, FrozenMemoryEntry, FrozenToolContext, FrozenContinuation } from "@deliberation-ai/contracts";
import { inputFor, instructionsFor, type ProviderRequest } from "@deliberation-ai/providers";
import type { KnowledgePacket } from "@deliberation-ai/contracts";

export const COUNCIL_PROMPT_VERSION = "council-v1";

export type RoundZeroPromptPlan = {
  version: string;
  fingerprint: string;
  members: Array<{
    id: string;
    label: string;
    provider: CouncilMemberConfig["provider"];
    connectionId?: string;
    model: string;
    reasoningLevel: CouncilMemberConfig["reasoningLevel"];
    webSearchMode: CouncilMemberConfig["webSearchMode"];
    councilRole: CouncilMemberConfig["councilRole"];
    instructions: string;
    userInput: string;
    imageCount: number;
    documentCount: number;
  }>;
};

export function buildRoundZeroPromptPlan(input: {
  question: string;
  knowledgePacket?: KnowledgePacket | null | undefined;
  continuationContext?: FrozenContinuation | null | undefined;
  members: CouncilMemberConfig[];
  memoryContext: FrozenMemoryEntry[];
  toolContext: FrozenToolContext[];
  documents: Array<{ name: string; sha256: string; content: string }>;
  images: Array<{ mimeType: string; sha256: string }>;
}): RoundZeroPromptPlan {
  const members = input.members.map((member) => {
    const documents = member.receiveAttachments ? input.documents : [];
    const images = member.receiveAttachments ? input.images : [];
    const request: ProviderRequest = {
      memberId: member.id,
      role: member.role,
      councilRole: member.councilRole,
      round: 0,
      input: {
        snapshotId: "prompt-plan",
        question: input.question,
        knowledgePacket: input.knowledgePacket,
        continuationContext: input.continuationContext,
        memoryContext: input.memoryContext,
        toolContext: input.toolContext,
        documents,
      },
    };
    return {
      id: member.id,
      label: member.label,
      provider: member.provider,
      ...(member.connectionId ? { connectionId: member.connectionId } : {}),
      model: member.model,
      reasoningLevel: member.reasoningLevel,
      webSearchMode: member.webSearchMode,
      councilRole: member.councilRole,
      instructions: instructionsFor(request),
      userInput: inputFor(request),
      imageCount: images.length,
      documentCount: documents.length,
      imageDigests: images.map(({ mimeType, sha256 }) => ({ mimeType, sha256 })),
    };
  });
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ version: input.knowledgePacket ? "council-knowledge-v1" : COUNCIL_PROMPT_VERSION, members }))
    .digest("hex");
  return {
    version: input.knowledgePacket ? "council-knowledge-v1" : COUNCIL_PROMPT_VERSION,
    fingerprint,
    members: members.map(({ imageDigests: _imageDigests, ...member }) => member),
  };
}
