import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractKnowledgeFile, knowledgeDigest, type KnowledgeFile } from "../packages/retrieval/src/knowledge-files";

export async function createKnowledgeExtractionSnapshot(root: string) {
  const files: [string, KnowledgeFile["mediaType"]][] = [
    ["selectable-sun.pdf", "application/pdf"], ["support-table.pdf", "application/pdf"],
    ["scanned-support.pdf", "application/pdf"], ["ambiguous-support.png", "image/png"],
  ];
  const fixtures = [];
  for (const [name, mediaType] of files) {
    const bytes = await readFile(resolve(root, "docs/evaluation/knowledge-fixtures", name));
    const result = await extractKnowledgeFile({ name, mediaType, bytes });
    fixtures.push({ name, mediaType, originalHash: knowledgeDigest(bytes), ...result, textHash: knowledgeDigest(result.text),
      pages: result.pages.map((page) => ({ ...page, textHash: knowledgeDigest(result.text.slice(page.start, page.end)) })) });
  }
  return { version: "knowledge-format-extraction-v1", scope: "Mechanical extraction only; independent format/citation quality labels remain pending.", fixtures };
}

export async function verifyKnowledgeExtractionSnapshot(root: string, retainedText: string) {
  const snapshot = await createKnowledgeExtractionSnapshot(root);
  if (JSON.stringify(JSON.parse(retainedText)) !== JSON.stringify(snapshot)) {
    throw new Error("Frozen knowledge extraction changed; explicit parser/format review is required.");
  }
  return snapshot;
}
