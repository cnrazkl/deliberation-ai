import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { councilCoverageIntakeSchema } from "./council-coverage-labeling";

const candidatePath = new URL("../../../docs/evaluation/COUNCIL_CANDIDATE_INTAKE.json", import.meta.url);

describe("frozen council candidate intake", () => {
  it("has 40 source-fingerprinted bilingual questions with document-isolated splits", () => {
    const intake = councilCoverageIntakeSchema.parse(JSON.parse(readFileSync(candidatePath, "utf8")));
    expect(intake.cases).toHaveLength(40);
    expect(new Set(intake.cases.map((item) => item.question)).size).toBe(40);
    expect(new Set(intake.cases.map((item) => item.sourceId)).size).toBe(10);
    expect(intake.cases.filter((item) => item.split === "development")).toHaveLength(20);
    expect(intake.cases.filter((item) => item.split === "held_out")).toHaveLength(20);
    expect(intake.cases.filter((item) => item.language === "tr")).toHaveLength(24);
    expect(intake.cases.filter((item) => item.language === "en")).toHaveLength(12);
    expect(intake.cases.filter((item) => item.language === "mixed")).toHaveLength(4);
    expect(new Set(intake.cases.flatMap((item) => item.riskTags))).toEqual(new Set([
      "numeric", "minority", "condition", "entity", "red_team", "temporal", "negation",
    ]));
  });

  it("rejects source tampering and source-level split leakage before labeling", () => {
    const intake = councilCoverageIntakeSchema.parse(JSON.parse(readFileSync(candidatePath, "utf8")));
    const altered = structuredClone(intake);
    altered.cases[0]!.sourceText += " altered";
    expect(councilCoverageIntakeSchema.safeParse(altered).success).toBe(false);
    const leaked = structuredClone(intake);
    leaked.cases[0]!.split = "held_out";
    expect(councilCoverageIntakeSchema.safeParse(leaked).success).toBe(false);
    const misidentified = structuredClone(intake);
    misidentified.cases[1]!.sourceId = "source-alternate";
    expect(councilCoverageIntakeSchema.safeParse(misidentified).success).toBe(false);
    const repeated = structuredClone(intake);
    repeated.cases[1]!.id = repeated.cases[0]!.id;
    expect(councilCoverageIntakeSchema.safeParse(repeated).success).toBe(false);
  });
});
