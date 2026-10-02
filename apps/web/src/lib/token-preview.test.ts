import { describe, expect, it } from "vitest";
import type { CouncilMemberConfig } from "@deliberation-ai/contracts";
import { estimateTokenPreview } from "./token-preview";
import { buildCompactedContinuation, freezeContinuation, prepareContinuationCompaction } from "@deliberation-ai/application";

const members: CouncilMemberConfig[] = [
  { id: "openai-a", label: "A", role: "Analist", provider: "openai", model: "gpt-test", reasoningLevel: "default", webSearchMode: "off", councilRole: "analyst", receiveAttachments: true },
  { id: "claude-b", label: "B", role: "Red-team", provider: "anthropic", model: "claude-test", reasoningLevel: "default", webSearchMode: "off", councilRole: "red-team", receiveAttachments: false },
];

const base = { question: "Bu kararın riskleri nelerdir?", members, images: [], documents: [], memoryContext: [], toolContext: [] };

describe("local preflight token estimate", () => {
  it("counts only the compacted provider input, leaving the original archival text out of all member estimates", () => {
    const sourceRunId = "00000000-0000-4000-8000-000000000001";
    const material = { sourceRunId, sourceRiskProfile: "standard" as const, content: JSON.stringify({ sourceRunId, question: base.question, status: "completed", promptVersion: "council-v1", promptFingerprint: "a".repeat(64), report: { raw: "PRIVATE_ARCHIVE_SENTINEL ".repeat(1000) }, continuationContext: null }) };
    const original = estimateTokenPreview({ ...base, continuationContext: freezeContinuation(material) });
    const { context } = buildCompactedContinuation(prepareContinuationCompaction(material), { version: "manual-continuation-compaction-v1", summary: "An owner-written summary with explicit uncertainty.", reviewed: true });
    const compacted = estimateTokenPreview({ ...base, continuationContext: context });
    expect(compacted.totalTokens).toBeLessThan(original.totalTokens);
    expect(compacted.promptPlan!.members.every((member) => !member.userInput.includes("PRIVATE_ARCHIVE_SENTINEL"))).toBe(true);
    expect(compacted.promptPlan!.fingerprint).not.toBe(original.promptPlan!.fingerprint);
  });
  it("counts the entire continuation for each member even when attachment delivery is disabled", () => {
    const continuationContext = freezeContinuation({ sourceRunId: "00000000-0000-4000-8000-000000000001", sourceRiskProfile: "standard", content: "A complete prior minority report and raw responses. ".repeat(100) });
    const without = estimateTokenPreview(base);
    const withHistory = estimateTokenPreview({ ...base, continuationContext });
    expect(withHistory.contextEntryCount).toBe(1);
    expect(withHistory.questionTokens).toBe(without.questionTokens);
    for (let index = 0; index < members.length; index += 1) {
      expect(withHistory.members[index]!.textTokens).toBeGreaterThan(without.members[index]!.textTokens);
      expect(JSON.parse(withHistory.promptPlan!.members[index]!.userInput).continuationContext).toEqual(continuationContext);
    }
  });
  it("adds the exact round-zero prompt for each member and changes with the question", () => {
    const initial = estimateTokenPreview({ ...base, images: [] });
    const longer = estimateTokenPreview({ ...base, question: `${base.question} Ek varsayımları ayrıntılarıyla değerlendir.`, images: [] });
    expect(initial.totalTokens).toBe(initial.members.reduce((sum, member) => sum + member.totalTokens, 0));
    expect(longer.totalTokens).toBeGreaterThan(initial.totalTokens);
    expect(initial.members[0]?.textTokens).not.toBe(initial.members[1]?.textTokens);
    expect(initial.questionTokens).toBeGreaterThan(0);
    expect(initial.promptPlan?.version).toBe("council-v1");
    expect(initial.promptPlan?.members[0]?.instructions).toContain("Bu görevdeki uzmanlık odağın: Analist");
    expect(initial.promptPlan?.members[0]?.userInput).toBe(base.question);
    expect(initial.promptPlan?.members[1]?.instructions).toContain("Bu çalışmada red-team üyesisin");
    expect(longer.promptPlan?.fingerprint).not.toBe(initial.promptPlan?.fingerprint);
    expect(estimateTokenPreview({ ...base, question: "", images: [] })).toMatchObject({ questionTokens: 0, totalTokens: 0, promptPlan: null });
  });

  it("counts images only for opted-in members and shared context for all", () => {
    const images = Array.from({ length: 6 }, (_, index) => ({ mimeType: "image/png" as const, sha256: index.toString(16).padStart(64, "0"), width: 768, height: 768 }));
    const without = estimateTokenPreview({ ...base, images: [] });
    const withImages = estimateTokenPreview({ ...base, images });
    expect(withImages.members[0]?.imageTokens).toBeGreaterThan(0);
    expect(withImages.members[1]?.imageTokens).toBe(0);
    expect(withImages.members[1]?.totalTokens).toBe(without.members[1]?.totalTokens);
    expect(withImages.promptPlan?.fingerprint).not.toBe(without.promptPlan?.fingerprint);
    expect(withImages.promptPlan?.members[0]?.imageCount).toBe(6);
    expect(withImages.promptPlan?.members[1]?.imageCount).toBe(0);
    const withMemory = estimateTokenPreview({ ...base, images, memoryContext: [{ id: "entry", content: "Bu kararın geçmiş kayıtlarında özellikle tedarik riski vurgulanmıştı.", evidenceState: "unsupported", sourceType: "analyst-claim" }] });
    expect(withMemory.contextEntryCount).toBe(1);
    expect(withMemory.textTokens).toBeGreaterThan(withImages.textTokens);
  });

  it("includes prepared PDF text only for members allowed to receive attachments", () => {
    const documents = [{ name: "karar.pdf", sha256: "a".repeat(64), content: "[Sayfa 1]\nSözleşmenin fesih koşulu açıkça yazılıdır." }];
    const without = estimateTokenPreview(base);
    const withDocument = estimateTokenPreview({ ...base, documents });
    expect(withDocument.documentTokens).toBeGreaterThan(0);
    expect(withDocument.members[0]?.totalTokens).toBeGreaterThan(without.members[0]?.totalTokens ?? 0);
    expect(withDocument.members[1]?.documentTokens).toBe(0);
    expect(withDocument.members[1]?.totalTokens).toBe(without.members[1]?.totalTokens);
    expect(withDocument.promptPlan?.members[0]?.userInput).toContain("Sözleşmenin fesih koşulu");
    expect(withDocument.promptPlan?.members[1]?.userInput).not.toContain("Sözleşmenin fesih koşulu");
    expect(withDocument.promptPlan?.fingerprint).not.toBe(without.promptPlan?.fingerprint);
    expect(withDocument.riskPreflight?.assessment).toMatchObject({ effectiveProfile: "high", signals: [{ category: "legal", sources: ["document"] }] });
    const withheld = estimateTokenPreview({ ...base, documents, members: members.map((member) => ({ ...member, receiveAttachments: false })) });
    expect(withheld.riskPreflight?.assessment.effectiveProfile).toBe("standard");
  });

  it("binds the risk preview to controls and explicit preference without rewriting the question", () => {
    const initial = estimateTokenPreview(base);
    const high = estimateTokenPreview({ ...base, riskProfile: "high" });
    const noReview = estimateTokenPreview({ ...base, reviewRounds: 0 });
    expect(high.riskPreflight?.fingerprint).not.toBe(initial.riskPreflight?.fingerprint);
    expect(noReview.riskPreflight?.fingerprint).not.toBe(initial.riskPreflight?.fingerprint);
    expect(high.promptPlan?.fingerprint).toBe(initial.promptPlan?.fingerprint);
    expect(high.promptPlan?.members[0]?.userInput).toBe(base.question);
  });
});
