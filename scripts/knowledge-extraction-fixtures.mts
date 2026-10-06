import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createKnowledgeExtractionSnapshot, verifyKnowledgeExtractionSnapshot } from "./knowledge-extraction-snapshot";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "docs/evaluation/KNOWLEDGE_EXTRACTION_SNAPSHOT.json");
const mode = process.argv[2] ?? "verify";
if (mode === "prepare") {
  const snapshot = await createKnowledgeExtractionSnapshot(root);
  await writeFile(destination, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
} else if (mode === "verify") await verifyKnowledgeExtractionSnapshot(root, await readFile(destination, "utf8"));
else throw new Error("Choose prepare or verify.");
console.log(`Knowledge extraction ${mode}: 4 fixtures; no human labels or quality acceptance.`);
