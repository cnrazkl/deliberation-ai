import { expect, test } from "vitest";
import type { RunRecord } from "@deliberation-ai/application";
import type { exportConversation } from "@deliberation-ai/persistence";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { createRunExport } from "./run-export";
import { createConversationMarkdown, createSynthesisMarkdown, markdownBlock, MarkdownExportSizeError } from "./markdown-export";

const run: RunRecord = {
  runId: "00000000-0000-4000-8000-000000000001", createdAt: "2026-10-03T00:00:00.000Z",
  question: "Türkçe soru **korunur**", status: "completed", riskProfile: "standard", memberCount: 2,
  promptVersion: "council-v1", promptFingerprint: null, idempotencyKey: "hidden-intent", requestHash: "hidden-request", snapshotId: "hidden-snapshot",
  memoryEntryCount: 0, attachmentCount: 0, toolResultCount: 0,
  report: { status: "completed", qualityNotice: "Doğruluk onayı yok", sharedClaims: [], distinctClaims: [], redTeamChallenges: [],
    memberResults: [], failures: [], reviews: [], reviewFailures: [] },
};
function conversation(): NonNullable<Awaited<ReturnType<typeof exportConversation>>> {
  return {
    schemaVersion: "deliberationai-conversation-export-v1", exportedAt: run.createdAt,
    conversation: { conversationId: run.runId, anchorRunId: run.runId, createdAt: run.createdAt, origin: "legacy-reconstructed", runs: [], unavailableSourceRunIds: ["missing-source"] },
    scope: "Generated snapshot scope", privateBranches: [], privateBranchDeletions: [], runDeletions: [], knowledgeSelection: null,
    runs: [{ runId: run.runId, availability: "available", payload: { ...createRunExport(run), providerMode: "fake", reviewRounds: 0, executionLimits: null, followUp: null } },
      { runId: "missing-run", availability: "unavailable", payload: null }],
  };
}
test("synthesis keeps every coverage group, minority quote and provenance without modifying the source", () => {
  const exported = createRunExport(run);
  for (const [index, coverage] of (["included", "unresolved", "omitted"] as const).entries()) {
    exported.report.distinctClaims.push({ claimId: `claim-${index}`, statement: `Azınlık ${coverage}`, kinds: ["objection"], disposition: "represented_as_disputed",
      evidenceState: "unsupported", synthesisCoverage: coverage, scopeNote: "İnsan kapsam notu", occurrences: [{ occurrenceId: `occurrence-${index}`,
        memberId: "member-a", memberLabel: "Üye A", councilRole: "analyst", statement: `Özgün ${coverage}`, quote: `Alıntı ${coverage}`, kind: "objection" }] });
  }
  const before = JSON.stringify(exported);
  const md = createSynthesisMarkdown(exported);
  for (const coverage of ["included", "unresolved", "omitted"]) expect(md).toContain(`Azınlık ${coverage}`);
  expect(md).toContain("### Dışarıda"); expect(md).toContain("Alıntı omitted"); expect(md).toContain("Üye A");
  expect(md).toContain("yeni bir model sentezi değildir"); expect(md).toContain(run.question);
  expect(JSON.stringify(exported)).toBe(before);
  expect(md).not.toContain("hidden-intent"); expect(md).not.toContain("hidden-request");
  exported.report.distinctClaims.length = 0;
});
test("conversation retains unavailable sources, history archives, failures and raw reviews", () => {
  const value = conversation();
  const payload = value.runs[0]!.payload!;
  payload.report = { ...run.report!, memberResults: [{ memberId: "member-a", label: "Üye A", councilRole: "analyst", rawText: "Ham ilk yanıt", parsed: { summary: "Özet", claims: [] }, citations: [], reusedFromRunId: "copied-source" }],
    failures: [{ memberId: "member-b", label: "Üye B", code: "invalid_output", message: "Hata", rawText: "Bozuk yanıt" }],
    reviews: [{ round: 1, reviewerMemberId: "member-a", reviewerLabel: "Üye A", reviewerCouncilRole: "analyst", rawText: "Ham inceleme", parsed: { summary: "İnceleme", claims: [] }, citations: [] }] };
  const md = createConversationMarkdown(value);
  for (const text of ["Ham ilk yanıt", "Ham inceleme", "Bozuk yanıt", "copied-source", "missing-source", "missing-run", "İçerik erişilemiyor"]) expect(md).toContain(text);
  expect(md).not.toContain("hidden-snapshot");
  payload.report = null; payload.status = "running";
  expect(createConversationMarkdown(value)).toContain("Rapor henüz mevcut değil");
});
test("private owner drafts, seed and source provenance remain visible", () => {
  const value = conversation();
  value.privateBranches = [{ id: run.runId, conversationId: run.runId, sourceRunId: run.runId, sourceMemberId: "member-a", parentBranchId: null, revision: 2, messageCount: 1,
    createdAt: run.createdAt, updatedAt: run.createdAt, body: { version: "private-branch-drafts-v1", forkedFrom: null,
      seed: { version: "selected-member-private-seed-v1", conversationId: run.runId, sourceRunId: run.runId, sourceStateVersion: 1,
        sourceRiskProfile: "standard", sourcePromptVersion: "council-v1", sourcePromptFingerprint: null, member: defaultFakeCouncilMembers[0]!, question: "Özel kaynak soru", rawText: "Özel başlangıç yanıtı", reusedFromRunId: null },
      messages: [{ id: run.runId, kind: "owner-draft", text: "Gönderilmemiş özel taslak", createdAt: run.createdAt, originBranchId: run.runId, acceptedRevision: 2 }] } }];
  const md = createConversationMarkdown(value);
  expect(md).toContain("Özel kaynak soru"); expect(md).toContain("Özel başlangıç yanıtı"); expect(md).toContain("Gönderilmemiş özel taslak");
});
test("knowledge topic and revoked grant provenance remain inspectable in Markdown", () => {
  const value = conversation();
  value.knowledgeSelection = { version: "conversation-knowledge-v1", revision: run.runId, topic: "Retained topic ``` <script>",
    grants: [{ scope: { ownerId: "local-owner", accountId: "local", collectionId: run.runId, grantId: run.runId, grantRevision: 2 }, available: false }] };
  const md = createConversationMarkdown(value);
  expect(md).toContain("Retained topic ``` <script>"); expect(md).toContain('"available": false'); expect(md).toContain('"grantRevision": 2');
});
test("arbitrary saved fences and HTML stay inside literal text blocks", () => {
  const text = "```\n# injected\n``````\n<script>alert(1)</script>\nTürkçe";
  const block = markdownBlock(text);
  expect(block).toBe(`\`\`\`\`\`\`\`text\n${text}\n\`\`\`\`\`\`\`\n`);
});
test("oversized Markdown is rejected rather than truncated", () => {
  const exported = createRunExport(run);
  exported.question = "x".repeat(32 * 1024 * 1024);
  expect(() => createSynthesisMarkdown(exported)).toThrow(MarkdownExportSizeError);
});
