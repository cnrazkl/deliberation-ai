import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileCouncilCoverageAdjudicationWorksheet,
  compileCouncilCoverageReviewWorksheet,
  createCouncilCoverageAdjudicationWorksheet,
  createCouncilCoverageReviewWorksheet,
  compileExternalCouncilIntake,
} from "@deliberation-ai/evaluation";

const root = resolve(import.meta.dirname, "..");
const external = process.argv.includes("--external");
const args = process.argv.slice(2).filter((arg) => arg !== "--external");
if (process.argv.filter((arg) => arg === "--external").length > 1) throw new Error("Yinelenen seçenek.");
const intakePath = resolve(root, external ? "docs/evaluation/COUNCIL_EXTERNAL_SUITE.json" : "docs/evaluation/COUNCIL_CANDIDATE_INTAKE.json");
const outputRoot = resolve(root, external ? ".local/external-council-labeling" : ".local/council-labeling");

function saveNew(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function loadCompiledReviews(): [unknown, unknown] {
  const paths = (["a", "b"] as const).map((slot) => resolve(outputRoot, `compiled/review-${slot}.json`));
  if (paths.some((path) => !existsSync(path))) {
    throw new Error("Önce iki insan incelemesini bitirip pnpm labeling:compile çalıştırın.");
  }
  return [
    JSON.parse(readFileSync(paths[0]!, "utf8")) as unknown,
    JSON.parse(readFileSync(paths[1]!, "utf8")) as unknown,
  ];
}

function main(): void {
  const source: unknown = JSON.parse(readFileSync(intakePath, "utf8"));
  const intake = external ? compileExternalCouncilIntake(source).intake : source;
  const mode = args[0];
  if (mode === "prepare" && args.length === 1) {
    const targets = ["a", "b"] as const;
    const paths = targets.map((slot) => resolve(outputRoot, `reviewer-${slot}/worksheet.json`));
    if (paths.some(existsSync)) throw new Error("İncelemeci dosyası zaten var; mevcut çalışmayı korumak için üzerine yazılmadı.");
    targets.forEach((slot, index) => saveNew(paths[index]!, createCouncilCoverageReviewWorksheet(intake, slot)));
    console.log("İki ayrı boş inceleme dosyası oluşturuldu:");
    paths.forEach((path) => console.log(path));
  } else if (mode === "compile" && args.length === 1) {
    const worksheets = (["a", "b"] as const).map((slot) => {
      const path = resolve(outputRoot, `reviewer-${slot}/worksheet.json`);
      const input: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (typeof input !== "object" || input === null || !("slot" in input) || input.slot !== slot) {
        throw new Error(`İncelemeci dosyası yanlış yuvaya ait: ${slot}`);
      }
      return compileCouncilCoverageReviewWorksheet(intake, input);
    });
    if (worksheets[0]!.reviewerId === worksheets[1]!.reviewerId) {
      throw new Error("İki incelemeci kimliği farklı olmalı.");
    }
    const paths = (["a", "b"] as const).map((slot) => resolve(outputRoot, `compiled/review-${slot}.json`));
    if (paths.some(existsSync)) throw new Error("Derlenmiş inceleme dosyası zaten var; mevcut çalışmanın üzerine yazılmadı.");
    worksheets.forEach((worksheet, index) => saveNew(paths[index]!, worksheet));
    console.log("İki yapısal olarak geçerli inceleme dosyası oluşturuldu:");
    paths.forEach((path) => console.log(path));
  } else if (mode === "adjudication-prepare" && args.length === 1) {
    const reviews = loadCompiledReviews();
    const path = resolve(outputRoot, "adjudicator/worksheet.json");
    if (existsSync(path)) throw new Error("Uyuşmazlık çalışma dosyası zaten var; üzerine yazılmadı.");
    saveNew(path, createCouncilCoverageAdjudicationWorksheet(intake, reviews));
    console.log(`Boş uyuşmazlık çalışma dosyası oluşturuldu: ${path}`);
  } else if (mode === "adjudication-compile" && args.length === 1) {
    const reviews = loadCompiledReviews();
    const worksheetPath = resolve(outputRoot, "adjudicator/worksheet.json");
    if (!existsSync(worksheetPath)) throw new Error("Önce pnpm labeling:adjudication:prepare çalıştırın.");
    const worksheet: unknown = JSON.parse(readFileSync(worksheetPath, "utf8"));
    const result = compileCouncilCoverageAdjudicationWorksheet(intake, reviews, worksheet);
    const files = [
      { path: resolve(outputRoot, "compiled/adjudication.json"), value: result.adjudication },
      { path: resolve(outputRoot, "compiled/corpus.json"), value: result.corpus },
      { path: resolve(outputRoot, "compiled/manifest.json"), value: {
        schemaVersion: "council-coverage-labeling-manifest-v1",
        corpusSha256: result.manifestSha256,
        labelingInputsSha256: result.labelingManifestSha256,
      } },
    ];
    if (files.some(({ path }) => existsSync(path))) {
      throw new Error("Derlenmiş uyuşmazlık/korpus dosyası zaten var; üzerine yazılmadı.");
    }
    files.forEach(({ path, value }) => saveNew(path, value));
    console.log("Uyuşmazlık kaydı, kaynak korpusu ve özetleri oluşturuldu:");
    files.forEach(({ path }) => console.log(path));
  } else {
    throw new Error("Kullanım: pnpm labeling:prepare | labeling:compile | labeling:adjudication:prepare | labeling:adjudication:compile");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
