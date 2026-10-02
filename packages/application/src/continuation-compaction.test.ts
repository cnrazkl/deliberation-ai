import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { manualContinuationCompactionSchema, MAX_CONTINUATION_ARCHIVE_BYTES } from "@deliberation-ai/contracts";
import { assessRequestRisk } from "@deliberation-ai/domain";
import { inputFor } from "@deliberation-ai/providers";
import { buildCompactedContinuation, prepareContinuationCompaction, validateContinuationArchive } from "./continuation-compaction";
import { freezeContinuation } from "./continuation";

function material(raw = "Original minority position that must remain inspectable") {
  const sourceRunId = randomUUID();
  return { sourceRunId, sourceRiskProfile: "standard" as const, content: JSON.stringify({
    sourceRunId, question: "Which alternatives should we compare?", status: "completed",
    promptVersion: "council-v1", promptFingerprint: "a".repeat(64),
    report: { raw, minority: raw, reviews: [] }, continuationContext: null,
  }) };
}
const choice = { version: "manual-continuation-compaction-v1" as const, summary: "The owner keeps uncertainty and the alternative in a reviewed summary.", reviewed: true as const };

test("compacts an oversized source explicitly, keeps its question and omissions, archives raw text and sends only reviewed text", () => {
  const source = material("PRIVATE_RAW_MINORITY ".repeat(20_000));
  expect(() => freezeContinuation(source)).toThrow("256 KiB");
  const packet = prepareContinuationCompaction(source);
  const { context, archive } = buildCompactedContinuation(packet, choice);
  expect(context.version).toBe("run-continuation-v2");
  const content = JSON.parse(context.content) as { source: { question: string }; ownerSummary: string; omissions: unknown };
  expect(content.source.question).toBe(packet.sourceQuestion);
  expect(content.ownerSummary).toBe(choice.summary);
  expect(content.omissions).toEqual(packet.omissions);
  expect(packet.omissions.map((item) => item.section)).toEqual(["report"]);
  expect(archive.packet.originalContent).toBe(source.content);
  expect(validateContinuationArchive(archive, context)).toEqual(archive);
  for (const round of [0, 1] as const) {
    const rendered = inputFor({ memberId: "member-a", role: "Analyst", councilRole: "analyst", round, input: { snapshotId: "local", question: "A new independent question", continuationContext: context } });
    expect(rendered).toContain(choice.summary);
    expect(rendered).not.toContain("PRIVATE_RAW_MINORITY");
    expect(rendered).toContain("tam rapor değildir");
  }
});

test("retains original risk despite a neutral summary and respects explicit high source risk", () => {
  const packet = prepareContinuationCompaction(material("insulin dosage is uncertain"));
  const { context } = buildCompactedContinuation(packet, choice);
  expect(context.content).not.toContain("insulin dosage");
  expect(context.sourceRiskProfile).toBe("high");
  expect(assessRequestRisk({ question: "Neutral new question", continuationContext: context }).effectiveProfile).toBe("high");
  expect(buildCompactedContinuation(prepareContinuationCompaction({ ...material(), sourceRiskProfile: "high" }), choice).context.sourceRiskProfile).toBe("high");
});

test("rejects archive, omission, summary or delivered-context substitution", () => {
  const { context, archive } = buildCompactedContinuation(prepareContinuationCompaction(material()), choice);
  expect(() => validateContinuationArchive({ ...archive, selection: { ...choice, summary: "A different reviewed summary" } }, context)).toThrow();
  expect(() => validateContinuationArchive({ ...archive, packet: { ...archive.packet, omissions: [] } }, context)).toThrow();
  expect(() => validateContinuationArchive({ ...archive, packet: { ...archive.packet, sourceSha256: "b".repeat(64) } }, context)).toThrow();
  expect(() => validateContinuationArchive(archive, freezeContinuation({ ...material(), content: "A different input" }))).toThrow();
  expect(manualContinuationCompactionSchema.safeParse({ ...choice, reviewed: false }).success).toBe(false);
  expect(manualContinuationCompactionSchema.safeParse({ ...choice, summary: " ", extra: true }).success).toBe(false);
});

test("carries a private archive through full-context descendants without reinserting raw text, then binds it into later compaction", () => {
  const { context, archive } = buildCompactedContinuation(prepareContinuationCompaction(material("PRIVATE_ANCESTOR_RAW")), choice);
  const next = material("A new report");
  const source = JSON.parse(next.content) as Record<string, unknown>;
  source.continuationContext = context;
  const full = freezeContinuation({ ...next, content: JSON.stringify(source) });
  expect(full.content).not.toContain("PRIVATE_ANCESTOR_RAW");
  expect(validateContinuationArchive(archive, full)).toEqual(archive);
  const packet = prepareContinuationCompaction({ ...next, content: JSON.stringify({ ...source, earlierCompactionArchive: archive }) });
  expect(packet.omissions.map((item) => item.section)).toEqual(["report", "earlier-context", "earlier-archive"]);
  const compacted = buildCompactedContinuation(packet, choice);
  expect(compacted.context.content).not.toContain("PRIVATE_ANCESTOR_RAW");
  expect(compacted.archive.packet.originalContent).toContain("PRIVATE_ANCESTOR_RAW");
  expect(validateContinuationArchive(compacted.archive, compacted.context)).toEqual(compacted.archive);
});

test("refuses excessive original UTF-8 archives without making a truncated packet", () => {
  const source = material("ç".repeat(600_000));
  expect(source.content.length).toBeLessThan(MAX_CONTINUATION_ARCHIVE_BYTES);
  expect(() => prepareContinuationCompaction(source)).toThrow("2 MiB");
});
