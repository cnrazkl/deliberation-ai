import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContradictionLabelWorksheet, createContradictionAdjudicationWorksheet,
  compileContradictionAdjudicationWorksheet, planContradictionReview, sha256 } from "@deliberation-ai/evaluation";
import { closeDatabase } from "../src/database";
import { findDurableRunById } from "../src/run-repository";

const [mode, name, runId] = process.argv.slice(2);
const root = resolve(import.meta.dirname, "../../../.local/contradiction-labeling");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const save = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

try {
  if (process.argv.length !== 5 || !name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) || !runId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(runId)) throw new Error("Invalid arguments");
  const run = await findDurableRunById(runId);
  if (!run?.report || !["completed", "partially_completed"].includes(run.status)) throw new Error("Terminal report required");
  const plan = planContradictionReview(run.report, { maxPairs: 40,
    sourceSetSha256: sha256("No external evidence: textual pair comparison only"), evaluatorVersion: "unconfigured-shadow-v1" });
  const directory = resolve(root, name);
  mkdirSync(directory, { recursive: true });
  const file = (name: string) => resolve(directory, name);
  if (mode === "prepare") {
    const targets = ["snapshot.json", "reviewer-a.json", "reviewer-b.json"];
    if (targets.some((target) => existsSync(file(target)))) throw new Error("Existing files");
    save(file("snapshot.json"), { runId, plan });
    save(file("reviewer-a.json"), createContradictionLabelWorksheet(plan));
    save(file("reviewer-b.json"), createContradictionLabelWorksheet(plan));
    console.log("İki boş çelişki inceleme dosyası hazır; iddialar bu yerel dosyalarda açık metindir.");
  } else {
    if (JSON.stringify(read(file("snapshot.json"))) !== JSON.stringify({ runId, plan })) throw new Error("Changed snapshot");
    const reviews: [unknown, unknown] = [read(file("reviewer-a.json")), read(file("reviewer-b.json"))];
    if (mode === "adjudication-prepare") save(file("adjudicator.json"), createContradictionAdjudicationWorksheet(plan, reviews));
    else if (mode === "adjudication-compile") save(file("gold.json"), compileContradictionAdjudicationWorksheet(plan, reviews, read(file("adjudicator.json"))));
    else throw new Error("Invalid mode");
    console.log("Çelişki etiketleme adımı tamamlandı; hiçbir model çağrılmadı veya rapor değiştirilmedi.");
  }
} catch {
  console.error("Çelişki etiketleme tamamlanamadı. Komut, yerel run, bağımsız incelemeler ve değişmemiş snapshot gerekli; mevcut dosyalar üzerine yazılmaz.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
