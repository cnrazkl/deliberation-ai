import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { eq, inArray } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { KnowledgeAccessError } from "@deliberation-ai/application";
import { inspectKnowledgeEvaluationPlan, knowledgeFixtureNames, summarizeKnowledgeBenchmark, type KnowledgeBenchmarkSample } from "@deliberation-ai/evaluation";
import { createKnowledgeCollection, createKnowledgeConversation, changeKnowledgeGrant, setConversationKnowledge } from "./knowledge-scope";
import { importKnowledgeFiles, exportKnowledgeVersion, KnowledgeCapacityError } from "./knowledge-sources";
import { prepareKnowledgePacket, KnowledgePacketStaleError } from "./knowledge-packets";
import { closeDatabase, getDatabase } from "./database";
import * as s from "./schema";

test("measures frozen questions through encrypted preparation and exact citation read-back", async () => {
  // Refuse owner data before any write, including accidentally unisolated invocation.
  if (!/^\/da_it_[a-f0-9]{16}$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Benchmark requires the disposable database runner.");
  const root = resolve(import.meta.dirname, "../../..");
  const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const { intake, status } = inspectKnowledgeEvaluationPlan(
    JSON.parse(readFileSync(resolve(root, "docs/evaluation/KNOWLEDGE_EVALUATION_PLAN.json"), "utf8")),
    readFileSync(resolve(root, "docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"), "utf8"),
    readFileSync(resolve(root, "docs/evaluation/KNOWLEDGE_EVALUATION.md"), "utf8"),
    Object.fromEntries(knowledgeFixtureNames.map((name) => [name, digest(readFileSync(resolve(root, "docs/evaluation/knowledge-fixtures", name)))])),
    JSON.parse(readFileSync(resolve(root, "docs/evaluation/KNOWLEDGE_CONTRACT_APPROVAL.json"), "utf8")),
  );
  const bundles = [...new Map(intake.cases.map((item) => [item.sourceId, item.sourceText])).entries()];
  const files = bundles.map(([id, text]) => ({ sourceId: randomUUID(), expectedVersionId: null, name: id + ".txt", mediaType: "text/plain" as const, bytes: Buffer.from(text) }));
  const sourceVersions: Array<{ fixtureId: string; sourceId: string; versionId: string; originalHash: string; parserVersion: string }> = [];
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed in local measurement"));
  let collectionId: string | undefined, conversationId: string | undefined;
  try {
    const collection = await createKnowledgeCollection("Frozen DA-126 source bundles"); collectionId = collection.id;
    const scope = await changeKnowledgeGrant(collection.id, 1, "active");
    for (let offset = 0; offset < files.length; offset += 6) {
      const imported = await importKnowledgeFiles(scope, files.slice(offset, offset + 6));
      expect(imported.every((source) => source.status === "complete")).toBe(true);
      for (const source of imported) sourceVersions.push({ fixtureId: source.name, sourceId: source.sourceId,
        versionId: source.versionId, originalHash: source.originalHash, parserVersion: source.parserVersion });
    }
    conversationId = (await createKnowledgeConversation()).conversationId;
    const revision = await setConversationKnowledge(conversationId, null, { topic: "Frozen measurement scope", scopes: [scope] });
    const baselineRssBytes = process.memoryUsage().rss;
    let sampledMaxRssBytes = baselineRssBytes;
    const samples: KnowledgeBenchmarkSample[] = [];
    for (const phase of ["new-pool", "reused-pool"] as const) for (const item of intake.cases) {
      if (phase === "new-pool") await closeDatabase();
      const started = performance.now();
      let packet;
      try {
        // Fresh identity exercises preparation, not idempotent receipt replay.
        packet = await prepareKnowledgePacket({ id: randomUUID(), conversationId, selectionRevision: revision!, query: item.question, allowWithoutEvidence: true });
      } catch (error) {
        samples.push({ caseId: item.id, phase, durationMs: performance.now() - started, status: "failed",
          excerptCount: null, excerptCharacters: null, checkedCitations: null, omissions: null, packetFingerprint: null,
          failureClass: error instanceof KnowledgeAccessError ? "access" : error instanceof KnowledgeCapacityError ? "capacity"
            : error instanceof KnowledgePacketStaleError ? "stale" : error instanceof Error && error.name === "ZodError" ? "validation" : "other" });
        sampledMaxRssBytes = Math.max(sampledMaxRssBytes, process.memoryUsage().rss);
        continue;
      }
      const durationMs = performance.now() - started;
      for (const excerpt of packet.excerpts) {
        const original = await exportKnowledgeVersion(excerpt.source.scope, excerpt.source.sourceId, excerpt.source.versionId);
        const imported = files.find((file) => file.sourceId === excerpt.source.sourceId)!;
        expect(digest(imported.bytes)).toBe(original.original.originalHash);
        expect(Buffer.from(original.original.dataBase64, "base64")).toEqual(imported.bytes);
        expect(original.extraction.text.slice(excerpt.start, excerpt.end)).toBe(excerpt.text);
        expect(digest(excerpt.text)).toBe(excerpt.textHash);
        expect(original.extraction.textHash).toBe(excerpt.source.textHash);
      }
      samples.push({ caseId: item.id, phase, durationMs, status: "prepared", excerptCount: packet.excerpts.length,
        excerptCharacters: packet.excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0),
        checkedCitations: packet.excerpts.length, omissions: packet.omissions.length, packetFingerprint: packet.fingerprint, failureClass: null });
      sampledMaxRssBytes = Math.max(sampledMaxRssBytes, process.memoryUsage().rss);
    }
    expect(network).not.toHaveBeenCalled();
    const report = summarizeKnowledgeBenchmark({ schemaVersion: "knowledge-local-benchmark-v1", planSha256: status.planSha256,
      caseIds: intake.cases.map((item) => item.id), baselineCharacters: bundles.reduce((sum, [, text]) => sum + text.length, 0),
      sourceBundleCount: bundles.length, baselineRssBytes, sampledMaxRssBytes, samples });
    expect(report.samples).toHaveLength(80);
    expect(report.phases.every((phase) => phase.attempts === 40)).toBe(true);
    expect(report.samples.filter((sample) => sample.status === "failed").every((sample) => sample.failureClass === "access")).toBe(true);
    expect(report.releaseAcceptance).toBe("blocked");
    // Source-derived exact-token controls prove round-trip mechanics only, never retrieval recall.
    let positiveControlCitations = 0;
    for (let index = 0; index < bundles.length; index++) {
      const query = bundles[index]![1].match(/[\p{L}\p{N}_]+/u)![0];
      const packet = await prepareKnowledgePacket({ id: randomUUID(), conversationId, selectionRevision: revision!, query, allowWithoutEvidence: false });
      expect(packet.excerpts.some((excerpt) => excerpt.source.sourceId === files[index]!.sourceId)).toBe(true);
      for (const excerpt of packet.excerpts) {
        const original = await exportKnowledgeVersion(excerpt.source.scope, excerpt.source.sourceId, excerpt.source.versionId);
        const imported = files.find((file) => file.sourceId === excerpt.source.sourceId)!;
        expect(digest(imported.bytes)).toBe(original.original.originalHash);
        expect(Buffer.from(original.original.dataBase64, "base64")).toEqual(imported.bytes);
        expect(original.extraction.text.slice(excerpt.start, excerpt.end)).toBe(excerpt.text);
        expect(digest(excerpt.text)).toBe(excerpt.textHash);
        expect(original.extraction.textHash).toBe(excerpt.source.textHash);
        expect(original.extraction.pages.some((page) => page.page === excerpt.page && page.start <= excerpt.start && page.end >= excerpt.end)).toBe(true);
        positiveControlCitations++;
      }
    }
    expect(network).not.toHaveBeenCalled();
    if (process.env.DELIBERATION_KNOWLEDGE_BENCHMARK === "1") {
      const implementationFiles = ["packages/evaluation/src/knowledge-benchmark.ts", "packages/persistence/src/knowledge-benchmark.integration.test.ts",
        "packages/persistence/src/knowledge-packets.ts", "packages/persistence/src/knowledge-sources.ts", "packages/domain/src/knowledge.ts"];
      const implementationDigests = Object.fromEntries(implementationFiles.map((path) => [path, digest(readFileSync(resolve(root, path)))]));
      const output = resolve(root, ".local/knowledge-evaluation/measurements"); mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, "local-" + Date.now() + "-" + randomUUID() + ".json"), JSON.stringify({ ...report,
        sourceVersions, implementationDigests, queryPolicy: "unchanged-frozen-question-as-query",
        measuredAt: new Date().toISOString(), positiveControls: { attempts: bundles.length, checkedCitations: positiveControlCitations, policy: "source-first-token-mechanical-only" },
        runtime: { platform: process.platform, arch: process.arch, node: process.version },
      }, null, 2) + "\n", { flag: "wx" });
      console.log(JSON.stringify({ planSha256: report.planSha256, sourceBundleCount: report.sourceBundleCount,
        baselineCharacters: report.baselineCharacters, phases: report.phases, sampledRssIncreaseBytes: report.sampledRssIncreaseBytes,
        emptyPackets: report.samples.filter((sample) => sample.excerptCount === 0).length,
        failureClasses: report.samples.filter((sample) => sample.status === "failed").map((sample) => ({ caseId: sample.caseId, phase: sample.phase, failureClass: sample.failureClass })),
        releaseAcceptance: report.releaseAcceptance }));
    }
  } finally {
    network.mockRestore();
    if (conversationId) {
      await getDatabase().delete(s.knowledgePreparations).where(eq(s.knowledgePreparations.conversationId, conversationId));
      await getDatabase().delete(s.conversationKnowledgeSelections).where(eq(s.conversationKnowledgeSelections.conversationId, conversationId));
      await getDatabase().delete(s.conversationKnowledge).where(eq(s.conversationKnowledge.conversationId, conversationId));
      await getDatabase().delete(s.conversations).where(eq(s.conversations.id, conversationId));
    }
    if (collectionId) {
      await getDatabase().delete(s.knowledgeSourceVersions).where(inArray(s.knowledgeSourceVersions.sourceId, files.map((file) => file.sourceId)));
      await getDatabase().delete(s.knowledgeSources).where(eq(s.knowledgeSources.collectionId, collectionId));
      await getDatabase().delete(s.knowledgeGrants).where(eq(s.knowledgeGrants.collectionId, collectionId));
      await getDatabase().delete(s.knowledgeCollections).where(eq(s.knowledgeCollections.id, collectionId));
    }
    await closeDatabase();
  }
}, 120_000);
