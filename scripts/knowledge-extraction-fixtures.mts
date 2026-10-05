import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractKnowledgeFile, knowledgeDigest, type KnowledgeFile } from "../packages/retrieval/src/knowledge-files";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "docs/evaluation/KNOWLEDGE_EXTRACTION_SNAPSHOT.json");
const files: [string, KnowledgeFile["mediaType"]][] = [["selectable-sun.pdf", "application/pdf"], ["support-table.pdf", "application/pdf"],
  ["scanned-support.pdf", "application/pdf"], ["ambiguous-support.png", "image/png"]];
const fixtures = [];
for (const [name, mediaType] of files) {
  const bytes = await readFile(resolve(root, "docs/evaluation/knowledge-fixtures", name));
  const result = await extractKnowledgeFile({ name, mediaType, bytes });
  fixtures.push({ name, mediaType, originalHash: knowledgeDigest(bytes), ...result, textHash: knowledgeDigest(result.text),
    pages: result.pages.map((page) => ({ ...page, textHash: knowledgeDigest(result.text.slice(page.start, page.end)) })) });
}
const snapshot = { version: "knowledge-format-extraction-v1", scope: "Mechanical extraction only; independent format/citation quality labels remain pending.", fixtures };
const mode = process.argv[2] ?? "verify";
if (mode === "prepare") await writeFile(destination, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
else if (mode === "verify") {
  const retained = JSON.parse(await readFile(destination, "utf8")) as unknown;
  if (JSON.stringify(retained) !== JSON.stringify(snapshot)) throw new Error("Frozen knowledge extraction changed; explicit parser/format review is required.");
} else throw new Error("Choose prepare or verify.");
console.log(`Knowledge extraction ${mode}: ${fixtures.length} fixtures; no human labels or quality acceptance.`);
