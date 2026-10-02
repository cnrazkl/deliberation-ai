import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assembleCorrectnessGold, compileCouncilAssessmentWorksheet, createCouncilAssessmentWorksheet,
  evaluateCouncilCorrectness, sha256,
} from "@deliberation-ai/evaluation";
import { closeDatabase } from "../src/database";
import { loadStoredCouncilMeasurementRuns } from "../src/council-coverage-evaluation";

const root = resolve(import.meta.dirname, "../../..");
const labeling = resolve(root, ".local/external-council-labeling");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const readLabel = (path: string) => read(resolve(labeling, path));
const mode = process.argv[2];
const measurementName = process.argv[3];

function saveNew(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

try {
  if (process.argv.length !== 4 || !measurementName || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(measurementName)) {
    throw new Error("Name required");
  }
  const output = resolve(labeling, "measurements", measurementName);
  const gold = assembleCorrectnessGold(read(resolve(root, "docs/evaluation/COUNCIL_EXTERNAL_SUITE.json")),
    [readLabel("compiled/review-a.json"), readLabel("compiled/review-b.json")], readLabel("compiled/adjudication.json"), readLabel("attestation.json"));
  if (mode === "prepare") {
    mkdirSync(output, { recursive: true });
    saveNew(resolve(output, "run-map.json"), { schemaVersion: "council-measurement-run-map-v1", corpusSha256: gold.manifestSha256,
      cases: gold.corpus.cases.map((item) => ({ caseId: item.id, runId: null })) });
    console.log("Boş run haritası hazır. Kaynak içeren sabit sorularla çalıştırılan run kimliklerini girin; bu komut model çağırmaz.");
  } else if (mode === "review" || mode === "score") {
    const target = resolve(output, mode === "review" ? "assessment-worksheet.json" : "result.json");
    if (existsSync(target)) throw new Error("Output exists");
    const loaded = await loadStoredCouncilMeasurementRuns(gold.corpus, read(resolve(output, "run-map.json")));
    if (mode === "review") {
      saveNew(target, createCouncilAssessmentWorksheet(gold.corpus, loaded.reports));
      console.log("İnsan sonuç inceleme dosyası hazır; rapor metinleri yerel dosyada açık metin bulunur.");
    } else {
      const assessment = compileCouncilAssessmentWorksheet(gold.corpus, loaded.reports, read(resolve(output, "assessment-worksheet.json")));
      const result = evaluateCouncilCorrectness(gold.corpus, assessment, loaded.reports);
      saveNew(target, { ...result, corpusSha256: gold.manifestSha256, labelingInputsSha256: gold.labelingManifestSha256,
        suiteSha256: gold.external.manifest.suiteSha256, assessmentSha256: sha256(JSON.stringify(assessment)),
        attestationSha256: sha256(JSON.stringify(gold.attestation)), observations: loaded.observations,
        configurationSha256: loaded.configurationSha256, measuredAt: new Date().toISOString() });
      console.log(`Kabul sonucu: ${result.status}. Ölçüm yalnız bu kaynak kümesi ve kayıtlı model ayarları içindir.`);
      if (result.status !== "passed") process.exitCode = 2;
    }
  } else throw new Error("Unknown mode");
} catch {
  console.error("Ölçüm kapısı geçilemedi. Bağımsız inceleme, onay, run haritası, sabit kaynak/istem ve çalışma dosyalarını kontrol edin. Mevcut sonuç üzerine yazılmaz.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
