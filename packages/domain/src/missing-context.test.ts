import { describe, expect, it } from "vitest";
import { composeClarifiedQuestion, findCriticalMissingContext } from "./missing-context";

describe("critical context questions", () => {
  it("asks only bounded, relevant questions for concrete legal and medical decisions", () => {
    expect(findCriticalMissingContext("Bu sözleşmeyi feshetmeli miyim?").map((item) => item.id)).toEqual(["legal-jurisdiction", "legal-event-date"]);
    expect(findCriticalMissingContext("Can I terminate this contract in Germany on 2026-09-28?")).toEqual([]);
    expect(findCriticalMissingContext("İlaç dozunu değiştirmeli miyim?").map((item) => item.id)).toEqual(["medication-details"]);
    expect(findCriticalMissingContext("İlaç X 5 mg dozunu 35 yaşındaki biri için değiştirmeli miyim?")).toEqual([]);
    expect(findCriticalMissingContext("Türkiye'de vergi beyanını yapmalı mıyım?")[0]?.question).toBe("Hangi vergi yılı söz konusu?");
    expect(findCriticalMissingContext("Türkiye'de 2026 vergisini beyan etmeli miyim?")).toEqual([]);
    expect(findCriticalMissingContext("Renk paletlerini ve risklerini karşılaştır.")).toEqual([]);
    expect(findCriticalMissingContext("Explain the history of contract law.")).toEqual([]);
  });

  it("preserves the original and appends an explicit owner answer", () => {
    const original = "İlaç dozunu değiştirmeli miyim?";
    expect(composeClarifiedQuestion(original, "original")).toBe(original);
    expect(composeClarifiedQuestion(original, "answer", "İlaç X, 5 mg, 35 yaş.")).toContain(`${original}\n\nKullanıcının ek açıklaması:\n`);
    expect(() => composeClarifiedQuestion(original, "answer", " ")).toThrow();
    expect(() => composeClarifiedQuestion(original, "original", "override")).toThrow();
    expect(() => composeClarifiedQuestion("a".repeat(3_900), "answer", "x".repeat(200))).toThrow();
  });
});
