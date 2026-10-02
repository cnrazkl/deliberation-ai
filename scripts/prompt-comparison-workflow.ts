import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compilePromptDriftAdjudication, compilePromptDriftWorksheet, createPromptDriftAdjudication,
  createPromptDriftWorksheet, preparePromptComparison,
} from "@deliberation-ai/evaluation";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".local/prompt-comparison");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const plan = preparePromptComparison(read(resolve(root, "docs/evaluation/COUNCIL_EXTERNAL_SUITE.json")));
const mode = process.argv[2];

function saveNew(path: string, value: unknown) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function savedPlan() {
  const saved = read(resolve(output, "plan.json"));
  if (JSON.stringify(saved) !== JSON.stringify(plan)) throw new Error("Frozen plan changed");
  return plan;
}

function reviews() {
  const frozen = savedPlan();
  const a = compilePromptDriftWorksheet(frozen, read(resolve(output, "reviewer-a/worksheet.json")));
  const b = compilePromptDriftWorksheet(frozen, read(resolve(output, "reviewer-b/worksheet.json")));
  // This also checks distinct reviewer ids, slots and the frozen plan.
  createPromptDriftAdjudication(frozen, a, b);
  return { frozen, a, b };
}

try {
  if (process.argv.length !== 3) throw new Error("One mode required");
  if (mode === "prepare") {
    const files = [
      { name: "plan.json", data: plan },
      { name: "reviewer-a/worksheet.json", data: createPromptDriftWorksheet(plan, "a") },
      { name: "reviewer-b/worksheet.json", data: createPromptDriftWorksheet(plan, "b") },
    ];
    if (files.some((file) => existsSync(resolve(output, file.name)))) throw new Error("Files already exist");
    files.forEach((file) => saveNew(resolve(output, file.name), file.data));
    console.log(`40 dondurulmuş özgün/adayı istem çifti ve iki boş inceleme dosyası hazır: ${output}`);
  } else if (mode === "adjudication-prepare") {
    const { frozen, a, b } = reviews();
    saveNew(resolve(output, "adjudicator/worksheet.json"), createPromptDriftAdjudication(frozen, a, b));
    console.log("Üçüncü bağımsız incelemeci için boş uzlaştırma dosyası hazır.");
  } else if (mode === "adjudication-compile") {
    const { frozen, a, b } = reviews();
    const result = compilePromptDriftAdjudication(frozen, a, b, read(resolve(output, "adjudicator/worksheet.json")));
    saveNew(resolve(output, "compiled/adjudication.json"), result);
    console.log(`Anlamsal inceleme yapısal olarak doğrulandı; durum=${result.semanticStatus}; çözümlenmeyen=${result.unresolvedCount}. Bu bir doğruluk ölçümü değildir.`);
  } else if (mode === "status") {
    let reviewStatus = "pending";
    let adjudicationStatus = "pending";
    if (existsSync(resolve(output, "plan.json"))) {
      try {
        savedPlan();
        const rawA = read(resolve(output, "reviewer-a/worksheet.json"));
        const rawB = read(resolve(output, "reviewer-b/worksheet.json"));
        const blankA = JSON.stringify(rawA) === JSON.stringify(createPromptDriftWorksheet(plan, "a"));
        const blankB = JSON.stringify(rawB) === JSON.stringify(createPromptDriftWorksheet(plan, "b"));
        if (blankA && blankB) {
          reviewStatus = "pending";
        } else if (blankA || blankB) {
          compilePromptDriftWorksheet(plan, blankA ? rawB : rawA);
          reviewStatus = "partially_filled";
        } else {
          const { frozen, a, b } = reviews();
          reviewStatus = "structurally_valid";
          try {
            const result = compilePromptDriftAdjudication(frozen, a, b, read(resolve(output, "adjudicator/worksheet.json")));
            adjudicationStatus = result.semanticStatus;
          } catch { adjudicationStatus = "pending_or_invalid"; }
        }
      } catch { reviewStatus = "pending_or_invalid"; }
    }
    console.log(JSON.stringify({ planPrepared: existsSync(resolve(output, "plan.json")), pairedCases: plan.cases.length,
      independentReviews: reviewStatus, adjudication: adjudicationStatus,
      pairedModelRuns: "pending", humanOutputJudgments: "pending", measuredAccuracy: null, acceptance: "blocked" }, null, 2));
  } else throw new Error("Unknown mode");
} catch {
  console.error("İstem karşılaştırması tamamlanamadı. Dosya durumunu ve dondurulmuş planı kontrol edin; mevcut dosyalar üzerine yazılmaz.");
  process.exitCode = 1;
}
