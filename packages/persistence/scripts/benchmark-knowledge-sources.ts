import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { closeDatabase } from "../src/database";
import { createKnowledgeCollection, changeKnowledgeGrant } from "../src/knowledge-scope";
import { importKnowledgeFiles, searchLocalKnowledge } from "../src/knowledge-sources";

// Called only inside the generated restore harness, never against owner data.
export async function benchmarkKnowledgeSources() {
  const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/").pathname;
  if (!/^\/da121_fixture_[a-f0-9]{32}$/.test(database)) throw new Error("Generated knowledge fixture database required.");
  const collection = await createKnowledgeCollection("Generated performance library");
  const scope = await changeKnowledgeGrant(collection.id, 1, "active");
  const text = "keyword source minority claim ".repeat(1_100).slice(0, 32_000);
  for (let start = 0; start < 30; start += 6) await importKnowledgeFiles(scope, Array.from({ length: 6 }, () => ({
    sourceId: randomUUID(), expectedVersionId: null, name: "generated.txt", mediaType: "text/plain" as const, bytes: Buffer.from(text) })));
  await closeDatabase(); global.gc?.();
  const baselineRss = process.memoryUsage().rss; let peakRss = baselineRss;
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  const cold: number[] = [], warm: number[] = [];
  try {
    for (const [measurements, reconnect] of [[cold, true], [warm, false]] as const) for (let iteration = 0; iteration < 30; iteration++) {
      if (reconnect) await closeDatabase();
      const start = performance.now();
      const result = await searchLocalKnowledge([scope], "keyword");
      if (result.inspectedSources !== 30 || result.hits.length !== 30 || result.unavailableSources) throw new Error("Benchmark corpus was not completely inspected.");
      measurements.push(performance.now() - start); peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
  } finally { clearInterval(sample); }
  const p95 = (values: number[]) => Math.ceil([...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!);
  const metrics = { sourceCount: 30, decryptedTextBytes: Buffer.byteLength(text) * 30, samplesPerMode: 30,
    coldP95Ms: p95(cold), warmP95Ms: p95(warm), baselineRssMiB: Math.ceil(baselineRss / 1_048_576),
    sampledPeakRssMiB: Math.ceil(peakRss / 1_048_576), sampledIncrementalRssMiB: Math.ceil((peakRss - baselineRss) / 1_048_576),
    platform: process.platform, arch: process.arch, node: process.version, cpu: cpus()[0]?.model ?? "unknown",
    caveat: "Synthetic repeated-source scan, not semantic quality. Cold reconnects the pool; OS/PostgreSQL caches are not purged. RSS is sampled, not a hard memory guarantee." };
  console.log(JSON.stringify(metrics));
  if (metrics.coldP95Ms > 2_000 || metrics.warmP95Ms > 2_000 || metrics.sampledIncrementalRssMiB > 256) throw new Error("Synthetic retrieval trial operating target exceeded.");
  // The source database is still dumped/restored by the harness, proving that the
  // bounded corpus is encrypted and portable rather than a persistent text index.
  return metrics;
}
