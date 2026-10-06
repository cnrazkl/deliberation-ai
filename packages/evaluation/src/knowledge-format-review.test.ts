import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createKnowledgeFormatWorksheet, compileKnowledgeFormatReview, compileKnowledgeFormatReviewPair } from "./knowledge-format-review";
import { sha256 } from "./external-council-intake";
import { fileURLToPath } from "node:url";
import { verifyKnowledgeExtractionSnapshot } from "../../../scripts/knowledge-extraction-snapshot";

const plan = JSON.parse(readFileSync(new URL("../../../docs/evaluation/KNOWLEDGE_EVALUATION_PLAN.json", import.meta.url), "utf8"));
const extractionText = readFileSync(new URL("../../../docs/evaluation/KNOWLEDGE_EXTRACTION_SNAPSHOT.json", import.meta.url), "utf8");
// Synthetic declarations exercise validation only; these are not human labels.
function filled(slot: "a" | "b" = "a") {
  const form = createKnowledgeFormatWorksheet(plan, slot);
  return { ...form, reviewerId: `synthetic-${slot}`, cases: form.cases.map((item) => {
    const verified = item.fixture === "selectable-sun.pdf" || item.fixture === "support-table.pdf";
    return { ...item, originalInspected: true, extractionVerified: verified, noAnswerRequired: !verified,
      rationale: "Synthetic validation fixture only.", claims: verified ? [{ statement: "Synthetic test assertion.", critical: true,
        evidenceQuotes: [{ page: 1, text: item.fixture === "selectable-sun.pdf" ? "25 Earth days." : "v1 Yürürlükteki sentetik örnek 4 saat" }] }] : [] };
  }) };
}
describe("format review compilation", () => {
  it("verifies retained extraction against the actual frozen binary files", async () => {
    await expect(verifyKnowledgeExtractionSnapshot(fileURLToPath(new URL("../../../", import.meta.url)), extractionText)).resolves.toMatchObject({
      version: "knowledge-format-extraction-v1",
    });
  });
  it("rejects invented extraction even if the attacker recomputes every text hash", async () => {
    const changed = JSON.parse(extractionText);
    const fixture = changed.fixtures[0];
    fixture.text = "invented replacement"; fixture.textHash = sha256(fixture.text);
    fixture.pages[0].end = fixture.text.length; fixture.pages[0].textHash = fixture.textHash;
    await expect(verifyKnowledgeExtractionSnapshot(fileURLToPath(new URL("../../../", import.meta.url)), JSON.stringify(changed))).rejects.toThrow("Frozen knowledge extraction changed");
  });
  it("creates blank forms and refuses them without invented decisions", () => {
    const blank = createKnowledgeFormatWorksheet(plan, "a");
    expect(blank.cases).toHaveLength(8);
    expect(blank.cases.every((item) => item.originalInspected === null && item.extractionVerified === null)).toBe(true);
    expect(() => compileKnowledgeFormatReview(plan, extractionText, blank)).toThrow();
  });
  it("binds exact page excerpts while leaving all acceptance gates open", () => {
    const result = compileKnowledgeFormatReview(plan, extractionText, filled());
    expect(result).toMatchObject({ releaseAcceptance: "blocked", humanIndependence: "not_attested", adjudication: "not_assessed",
      extractionFileSha256: sha256(extractionText) });
    const quote = result.cases[0]!.claims[0]!.evidence[0]!;
    const source = JSON.parse(extractionText).fixtures[0];
    expect(source.text.slice(quote.start, quote.end)).toBe(quote.text);
    expect(quote.fixtureSha256).toBe(source.originalHash);
    expect(quote.page).toBe(1);
    expect(result.cases.filter((item) => item.noAnswerRequired)).toHaveLength(4);
  });
  it.each(["question", "fixtureSha256", "language", "id"] as const)("rejects changed frozen %s", (field) => {
    const form = filled();
    Object.assign(form.cases[0]!, { [field]: "changed" });
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
  });
  it("rejects replacement plan identities and duplicate/missing cases", () => {
    const form = filled();
    expect(() => compileKnowledgeFormatReview(plan, extractionText, { ...form, planSha256: "0".repeat(64) })).toThrow();
    form.cases[1] = structuredClone(form.cases[0]!);
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
    form.cases.pop();
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
  });
  it("requires original inspection and coherent abstention", () => {
    const form = filled();
    form.cases[0]!.originalInspected = false;
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
    form.cases[0]!.originalInspected = true;
    form.cases[0]!.extractionVerified = false;
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
    form.cases[0]!.claims = [];
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
    form.cases[0]!.noAnswerRequired = true;
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).not.toThrow();
  });
  it("never promotes unsupported scanned/image extraction", () => {
    const form = filled();
    form.cases[4]!.extractionVerified = true;
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
    form.cases[4]!.extractionVerified = false;
    form.cases[4]!.noAnswerRequired = false;
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
  });
  it("rejects missing pages, altered quotes and ambiguous page matches", () => {
    const form = filled();
    const quote = form.cases[0]!.claims[0]!.evidenceQuotes[0]!;
    quote.page = 2;
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
    quote.page = 1; quote.text = "invented quotation";
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
    quote.text = "the";
    expect(() => compileKnowledgeFormatReview(plan, extractionText, form)).toThrow();
  });
  it.each(["originalHash", "textHash", "page", "start", "end", "mediaType"])("rejects altered extraction %s", (field) => {
    const extraction = JSON.parse(extractionText);
    const fixture = extraction.fixtures[0];
    if (field === "page" || field === "start" || field === "end") fixture.pages[0][field] = 999;
    else fixture[field] = field === "mediaType" ? "image/png" : "0".repeat(64);
    expect(() => compileKnowledgeFormatReview(plan, JSON.stringify(extraction), filled())).toThrow();
  });
  it("requires distinct declared identities and original slots without claiming independence", () => {
    const a = filled("a"), b = filled("b");
    expect(compileKnowledgeFormatReviewPair(plan, extractionText, [a, b])).toHaveLength(2);
    b.reviewerId = a.reviewerId;
    expect(() => compileKnowledgeFormatReviewPair(plan, extractionText, [a, b])).toThrow();
    expect(() => compileKnowledgeFormatReviewPair(plan, extractionText, [filled("b"), filled("a")])).toThrow();
  });
});
