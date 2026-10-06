import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileExternalCouncilIntake } from "./external-council-intake";
import { createCouncilCoverageReviewWorksheet, compileCouncilCoverageReviewWorksheet, createCouncilCoverageAdjudicationWorksheet } from "./council-coverage-labeling";
import { createKnowledgeFormatWorksheet } from "./knowledge-format-review";
import { createKnowledgeFormatAdjudicationWorksheet } from "./knowledge-format-adjudication";
import { createKnowledgeReviewAttestationWorksheet, compileKnowledgeReviewAttestationWorksheet } from "./knowledge-review-attestation";
import { inspectKnowledgeReviewReadiness } from "./knowledge-review-readiness";

const read = (name: string) => readFileSync(new URL(`../../../docs/evaluation/${name}`, import.meta.url), "utf8");
const plan = JSON.parse(read("KNOWLEDGE_EVALUATION_PLAN.json"));
const intake = compileExternalCouncilIntake(JSON.parse(read("COUNCIL_EXTERNAL_SUITE.json"))).intake;
const extraction = read("KNOWLEDGE_EXTRACTION_SNAPSHOT.json");
// Synthetic declarations only, never written to real human review files.
function evidence() {
  const textReviews = (["a", "b"] as const).map((slot) => {
    const form = createCouncilCoverageReviewWorksheet(intake, slot);
    form.reviewerId = `synthetic-${slot}`;
    form.cases.forEach((item) => { item.claims = [{ statement: "Synthetic assertion only.", critical: true, evidenceQuotes: [item.sourceText] }]; });
    return form;
  });
  const textAdjudication = createCouncilCoverageAdjudicationWorksheet(intake,
    textReviews.map((form) => compileCouncilCoverageReviewWorksheet(intake, form)));
  textAdjudication.adjudicatorId = "synthetic-third";
  textAdjudication.cases.forEach((item) => { item.goldClaims = [{ statement: "Synthetic resolved assertion.", critical: true,
    evidenceQuotes: [item.sourceText], reviewRefs: item.reviewClaims.map((claim) => ({ reviewerId: claim.reviewerId, claimId: claim.id })) }]; });
  const formatReviews = (["a", "b"] as const).map((slot) => {
    const form = createKnowledgeFormatWorksheet(plan, slot);
    return { ...form, reviewerId: `synthetic-${slot}`, cases: form.cases.map((item) => {
      const verified = item.fixture === "selectable-sun.pdf" || item.fixture === "support-table.pdf";
      return { ...item, originalInspected: true, extractionVerified: verified, noAnswerRequired: !verified,
        rationale: "Synthetic rationale for compiler validation.", claims: verified ? [{ statement: "Synthetic format assertion.", critical: true,
          evidenceQuotes: [{ page: 1, text: item.fixture === "selectable-sun.pdf" ? "25 Earth days." : "v1 Yürürlükteki sentetik örnek 4 saat" }] }] : [] };
    }) };
  });
  const formatPair = [formatReviews[0]!, formatReviews[1]!] as const;
  const formatAdjudication = { ...createKnowledgeFormatAdjudicationWorksheet(plan, extraction, formatPair),
    adjudicatorId: "synthetic-third", cases: structuredClone(formatPair[0].cases) };
  return { textReviews: [textReviews[0]!, textReviews[1]!] as const, textAdjudication,
    formatReviews: formatPair, formatAdjudication };
}
function complete(inputs = evidence()) {
  return { ...createKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs), coordinatorId: "synthetic-coordinator",
    reviewedAt: "2026-10-06T11:00:00.000Z", independenceConfirmed: true, coverageAdequate: true,
    limitationsAcknowledged: true, rationale: "Synthetic attestation, not independent human acceptance." };
}
describe("frozen human review coordinator declarations", () => {
  it("reports missing, invalid and dependency-blocked evidence without leaking content", () => {
    const inputs = evidence();
    inputs.textReviews[0].reviewerId = "";
    const result = inspectKnowledgeReviewReadiness(plan, intake, extraction, { ...inputs, formatAdjudication: undefined });
    expect(result.gates).toMatchObject({ textReviewerA: "invalid", textReviewerB: "validated", textReviewPair: "blocked",
      textAdjudication: "blocked", formatAdjudication: "missing", coordinator: "missing" });
    expect(JSON.stringify(result)).not.toContain("synthetic");
    expect(JSON.stringify(result)).not.toContain("Synthetic");
  });
  it("validates complete declarations while retaining negative decisions and blocked release", () => {
    const inputs = evidence();
    const result = inspectKnowledgeReviewReadiness(plan, intake, extraction,
      { ...inputs, coordinator: { ...complete(inputs), coverageAdequate: false } });
    expect(Object.values(result.gates).every((state) => state === "validated")).toBe(true);
    expect(result).toMatchObject({ coverage: "not_accepted", humanIndependence: "human_declared", releaseAcceptance: "blocked" });
  });
  it("does not trust a stale coordinator or duplicate reviewer identity", () => {
    const inputs = evidence(), coordinator = complete(inputs);
    inputs.textAdjudication.cases[0]!.goldClaims[0]!.statement += " changed";
    expect(inspectKnowledgeReviewReadiness(plan, intake, extraction, { ...inputs, coordinator }).gates.coordinator).toBe("invalid");
    inputs.textReviews[1].reviewerId = inputs.textReviews[0].reviewerId;
    expect(inspectKnowledgeReviewReadiness(plan, intake, extraction, inputs).gates.textReviewPair).toBe("invalid");
  });
  it("treats malformed inputs as invalid rather than missing", () => {
    const inputs = evidence();
    expect(inspectKnowledgeReviewReadiness(plan, intake, extraction, { ...inputs, textReviews: [null, undefined] }).gates)
      .toMatchObject({ textReviewerA: "invalid", textReviewerB: "missing" });
  });
  it("requires both completed review/adjudication tracks and leaves decisions blank", () => {
    const inputs = evidence(), before = JSON.stringify(inputs);
    const form = createKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs);
    expect(form.bindings).toMatchObject({ textCaseCount: 40, formatCaseCount: 8 });
    expect(form).toMatchObject({ coordinatorId: "", reviewedAt: null, independenceConfirmed: null, coverageAdequate: null });
    expect(() => compileKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs, form)).toThrow();
    expect(JSON.stringify(inputs)).toBe(before);
    inputs.textReviews[0].reviewerId = "";
    expect(() => createKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs)).toThrow();
  });
  it("records declared decisions without certifying gold, models or release", () => {
    const inputs = evidence(), result = compileKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs, complete(inputs));
    expect(result).toMatchObject({ humanIndependence: "human_declared", coverage: "human_declared",
      goldAcceptance: "requires_owner_review", modelMeasurements: "not_assessed", releaseAcceptance: "blocked" });
  });
  it("retains negative human declarations as blockers", () => {
    const inputs = evidence();
    const form = { ...complete(inputs), independenceConfirmed: false, coverageAdequate: false };
    expect(compileKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs, form)).toMatchObject({
      humanIndependence: "not_attested", coverage: "not_accepted", releaseAcceptance: "blocked" });
  });
  it.each(["text", "format"])("refuses stale %s adjudication bindings", (track) => {
    const inputs = evidence(), form = complete(inputs);
    if (track === "text") inputs.textAdjudication.cases[0]!.goldClaims[0]!.statement += " changed";
    else inputs.formatAdjudication.cases[0]!.rationale += " changed";
    expect(() => compileKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs, form)).toThrow();
  });
  it("rejects replaced bindings or hidden participants", () => {
    const inputs = evidence(), form = complete(inputs);
    form.bindings.participants.textReviewers[0] = "replacement";
    expect(() => compileKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs, form)).toThrow();
    expect(() => compileKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs,
      { ...complete(inputs), bindingSha256: "0".repeat(64) })).toThrow();
  });
  it("binds exact extraction bytes and rejects swapped text slots", () => {
    const inputs = evidence(), form = complete(inputs);
    expect(() => compileKnowledgeReviewAttestationWorksheet(plan, intake, `${extraction}\n`, inputs, form)).toThrow();
    expect(() => createKnowledgeReviewAttestationWorksheet(plan, intake, extraction,
      { ...inputs, textReviews: [inputs.textReviews[1], inputs.textReviews[0]] })).toThrow();
  });
  it("rejects a different source intake even with the same case identities", () => {
    const changed = structuredClone(intake); changed.description += " changed";
    expect(() => createKnowledgeReviewAttestationWorksheet(plan, changed, extraction, evidence())).toThrow("Text intake differs");
  });
  it.each(["coordinatorId", "reviewedAt", "rationale", "limitationsAcknowledged"])("requires explicit %s", (field) => {
    const inputs = evidence();
    expect(() => compileKnowledgeReviewAttestationWorksheet(plan, intake, extraction, inputs,
      { ...complete(inputs), [field]: field === "limitationsAcknowledged" ? false : "" })).toThrow();
  });
});
