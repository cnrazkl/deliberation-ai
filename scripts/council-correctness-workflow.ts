import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assembleCorrectnessGold, compileCouncilCoverageReviewWorksheet, compileExternalCouncilIntake,
  createCouncilCoverageReviewWorksheet, prepareCouncilMeasurement,
} from "@deliberation-ai/evaluation";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".local/external-council-labeling");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const suite = read(resolve(root, "docs/evaluation/COUNCIL_EXTERNAL_SUITE.json"));
const external = compileExternalCouncilIntake(suite);
const plan = prepareCouncilMeasurement(suite);
const mode = process.argv[2];

function saveNew(path: string, value: unknown) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

try {
  if (process.argv.length !== 3) throw new Error("Kullanım: correctness:prepare veya correctness:status");
  if (mode === "prepare") {
    const files = [
      { name: "intake.json", data: external.intake },
      { name: "source-manifest.json", data: external.manifest },
      { name: "measurement-plan.json", data: plan },
      { name: "reviewer-a/worksheet.json", data: createCouncilCoverageReviewWorksheet(external.intake, "a") },
      { name: "reviewer-b/worksheet.json", data: createCouncilCoverageReviewWorksheet(external.intake, "b") },
      { name: "attestation.template.json", data: { schemaVersion: "council-review-attestation-v1", coordinatorId: "", confirmedAt: "",
        labelingInputsSha256: "", independentHumans: false, reviewedWithoutModelOutputs: false, sourceCoverageAccepted: false, rationale: "" } },
    ];
    if (files.some((file) => existsSync(resolve(output, file.name)))) throw new Error("Hazırlık dosyası zaten var; mevcut çalışma korunuyor.");
    files.forEach((file) => saveNew(resolve(output, file.name), file.data));
    console.log(`40 soru, kaynak manifesti ve iki boş insan inceleme dosyası hazır: ${output}`);
  } else if (mode === "status") {
    const readiness = { technicalPreparation: "ready", externalSources: external.manifest, renderableQuestions: plan.cases.length,
      humanReviews: "pending", adjudication: "pending", independenceAttestation: "pending", modelMeasurement: "pending",
      acceptance: "blocked" };
    try {
      const reviews = (["a", "b"] as const).map((slot) => compileCouncilCoverageReviewWorksheet(external.intake, read(resolve(output, `reviewer-${slot}/worksheet.json`))));
      if (reviews[0]!.reviewerId === reviews[1]!.reviewerId) throw new Error("Distinct humans required");
      readiness.humanReviews = "structurally_valid";
      const gold = assembleCorrectnessGold(suite, [reviews[0], reviews[1]], read(resolve(output, "compiled/adjudication.json")), read(resolve(output, "attestation.json")));
      if (gold.corpus.cases.length) { readiness.adjudication = "structurally_valid"; readiness.independenceAttestation = "recorded"; }
    } catch { /* Pending/invalid files cannot pass. Do not log reviewer/source contents. */ }
    // This offline readiness command never trusts a manually edited score JSON as proof.
    console.log(JSON.stringify(readiness, null, 2));
  } else throw new Error("Bilinmeyen doğruluk iş akışı komutu.");
} catch {
  console.error("Doğruluk hazırlığı tamamlanamadı. Komutu, dosya durumunu ve kaynak bütünlüğünü kontrol edin; mevcut dosyalar üzerine yazılmaz.");
  process.exitCode = 1;
}
