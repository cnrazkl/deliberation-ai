import { expect, test } from "vitest";
import { inspectKnowledgeQuery } from "./knowledge";

test("counts normalized distinct tokens without silently dropping or shortening input", () => {
  expect(inspectKnowledgeQuery("İZİN izin İzin, １２ 12")).toMatchObject({ terms: ["izin", "12"], termCount: 2, valid: true });
  const twelve = Array.from({ length: 12 }, (_, index) => "word" + index).join(" ");
  expect(inspectKnowledgeQuery(twelve + " word0")).toMatchObject({ termCount: 12, valid: true });
  expect(inspectKnowledgeQuery(twelve + " extra")).toMatchObject({ termCount: 13, valid: false });
});

test("punctuation, empty and oversized queries expose public limits rather than inventing search terms", () => {
  for (const query of ["", "  ", "...?!"]) expect(inspectKnowledgeQuery(query)).toMatchObject({ termCount: 0, valid: false, message: "En az bir arama sözcüğü girin." });
  expect(inspectKnowledgeQuery("a".repeat(201))).toMatchObject({ valid: false, message: "Her arama sözcüğü en fazla 200 karakter olabilir." });
  expect(inspectKnowledgeQuery("a ".repeat(2001))).toMatchObject({ valid: false, message: "Arama en fazla 4.000 karakter olabilir." });
  expect(inspectKnowledgeQuery("a".repeat(200))).toMatchObject({ valid: true });
});
