import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareReviewRoundComparison } from "@deliberation-ai/evaluation";
import { closeDatabase } from "../src/database";
import { inspectStoredReviewRoundComparison } from "../src/review-round-comparison";

const root = resolve(import.meta.dirname, "../../..");
const output = resolve(root, ".local/review-round-comparison/plan.json");
const suite = JSON.parse(readFileSync(resolve(root, "docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"), "utf8")) as unknown;
const mode = process.argv[2];

try {
  if (process.argv.length !== 3) throw new Error("Expected prepare or status");
  if (mode === "prepare") {
    if (existsSync(output)) throw new Error("Plan already exists");
    mkdirSync(resolve(output, ".."), { recursive: true });
    const plan = prepareReviewRoundComparison(suite);
    writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(`Karşılaştırma planı hazır: ${output}. Yalnız uygun tur hücrelerine çalışma kimlikleri girilebilir; model çağrısı yapılmadı.`);
  } else if (mode === "status") {
    const plan = JSON.parse(readFileSync(output, "utf8")) as unknown;
    console.log(JSON.stringify(await inspectStoredReviewRoundComparison(suite, plan), null, 2));
  } else throw new Error("Unknown mode");
} catch {
  console.error("İnceleme karşılaştırması hazırlanamadı veya doğrulanamadı. Kaynak paketi, plan, çalışma kimlikleri ve sabit koşulları kontrol edin; mevcut dosya değiştirilmez.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
