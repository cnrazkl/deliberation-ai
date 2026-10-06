import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createKnowledgeFormatWorksheet } from "./knowledge-format-review";
import { createKnowledgeFormatAdjudicationWorksheet, compileKnowledgeFormatAdjudicationWorksheet } from "./knowledge-format-adjudication";

const plan = JSON.parse(readFileSync(new URL("../../../docs/evaluation/KNOWLEDGE_EVALUATION_PLAN.json", import.meta.url), "utf8"));
const extraction = readFileSync(new URL("../../../docs/evaluation/KNOWLEDGE_EXTRACTION_SNAPSHOT.json", import.meta.url), "utf8");
// Deliberately synthetic, never a human review or accepted gold fixture.
function review(slot: "a" | "b") {
  const blank = createKnowledgeFormatWorksheet(plan, slot);
  return { ...blank, reviewerId: `synthetic-${slot}`, cases: blank.cases.map((item) => {
    const verified = item.fixture === "selectable-sun.pdf" || item.fixture === "support-table.pdf";
    return { ...item, originalInspected: true, extractionVerified: verified, noAnswerRequired: !verified,
      rationale: "Synthetic reviewer rationale only.", claims: verified ? [{ statement: `Synthetic assertion ${slot}.`, critical: slot === "a",
        evidenceQuotes: [{ page: 1, text: item.fixture === "selectable-sun.pdf" ? "25 Earth days." : "v1 Yürürlükteki sentetik örnek 4 saat" }] }] : [] };
  }) };
}
const reviews = () => [review("a"), review("b")] as const;
function completed(inputs = reviews()) {
  const blank = createKnowledgeFormatAdjudicationWorksheet(plan, extraction, inputs);
  return { ...blank, adjudicatorId: "synthetic-third", cases: review("a").cases.map((item) => ({ ...item,
    rationale: "Synthetic third-person resolution rationale.",
  })) };
}
const compile = (form: unknown, inputs = reviews(), snapshot = extraction) =>
  compileKnowledgeFormatAdjudicationWorksheet(plan, snapshot, inputs, form);

describe("source-bound format adjudication declarations", () => {
  it("shows disagreements and originals but leaves every human decision blank", () => {
    const inputs = reviews(), before = JSON.stringify(inputs);
    const form = createKnowledgeFormatAdjudicationWorksheet(plan, extraction, inputs);
    expect(form.disagreementCaseIds).toHaveLength(4);
    expect(form.reviews[0]!.cases[0]!.claims[0]!.critical).toBe(true);
    expect(form.reviews[1]!.cases[0]!.claims[0]!.critical).toBe(false);
    expect(form.adjudicatorId).toBe("");
    expect(form.cases.every((item) => item.originalInspected === null && item.claims.length === 0)).toBe(true);
    expect(() => compile(form, inputs)).toThrow();
    expect(JSON.stringify(inputs)).toBe(before);
  });
  it("retains conflicting original claims beside an independently entered final decision", () => {
    const form = completed();
    form.cases[0]!.claims = [];
    form.cases[0]!.noAnswerRequired = true;
    const result = compile(form);
    expect(result.reviews[0]!.cases[0]!.claims).toHaveLength(1);
    expect(result.reviews[1]!.cases[0]!.claims).toHaveLength(1);
    expect(result.cases[0]!.claims).toEqual([]);
    expect(result).toMatchObject({ adjudication: "human_declared", humanIndependence: "not_attested",
      goldAcceptance: "not_assessed", releaseAcceptance: "blocked" });
    expect(result.adjudicationWorksheetSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(["synthetic-a", "synthetic-b", "   "])("rejects non-third adjudicator identity %s", (id) => {
    expect(() => compile({ ...completed(), adjudicatorId: id })).toThrow();
  });
  it("requires completed, distinct original reviews before preparing any adjudication", () => {
    expect(() => createKnowledgeFormatAdjudicationWorksheet(plan, extraction,
      [createKnowledgeFormatWorksheet(plan, "a"), review("b")])).toThrow();
    expect(() => createKnowledgeFormatAdjudicationWorksheet(plan, extraction, [review("b"), review("a")])).toThrow();
  });
  it("rejects stale reviews even if fixture quotes still match", () => {
    const inputs = reviews(), form = completed(inputs);
    inputs[0].cases[0]!.claims[0]!.critical = false;
    expect(() => compile(form, inputs)).toThrow("inputs changed");
  });
  it.each(["planSha256", "extractionFileSha256"] as const)("rejects substituted %s", (key) => {
    expect(() => compile({ ...completed(), [key]: "0".repeat(64) })).toThrow();
  });
  it("rejects modified original snapshots, digest bindings and hidden disagreements", () => {
    const form = completed();
    form.reviews[0]!.cases[0]!.claims[0]!.statement = "Rewritten original";
    expect(() => compile(form)).toThrow("inputs changed");
    expect(() => compile({ ...completed(), reviewSha256: ["0".repeat(64), "0".repeat(64)] })).toThrow();
    expect(() => compile({ ...completed(), disagreementCaseIds: [] })).toThrow();
  });
  it("rejects missing, duplicate or changed final case identities", () => {
    const form = completed(); form.cases.pop();
    expect(() => compile(form)).toThrow();
    const duplicate = completed(); duplicate.cases[1] = structuredClone(duplicate.cases[0]!);
    expect(() => compile(duplicate)).toThrow();
    const changed = completed(); changed.cases[0]!.question += " changed";
    expect(() => compile(changed)).toThrow();
  });
  it("requires third-person original inspection and a rationale even when reviews agree", () => {
    const form = completed(); form.cases[4]!.rationale = "";
    expect(() => compile(form)).toThrow();
    form.cases[4]!.rationale = "Synthetic resolution rationale.";
    form.cases[4]!.originalInspected = false;
    expect(() => compile(form)).toThrow();
  });
  it("cannot fabricate final quotes or promote unsupported extraction", () => {
    const form = completed(); form.cases[0]!.claims[0]!.evidenceQuotes[0]!.text = "Invented quote";
    expect(() => compile(form)).toThrow();
    const unsupported = completed(); unsupported.cases[4]!.extractionVerified = true;
    expect(() => compile(unsupported)).toThrow();
  });
  it("binds exact extraction bytes as well as original case hashes", () => {
    expect(() => compile(completed(), reviews(), `${extraction}\n`)).toThrow("inputs changed");
  });
});
