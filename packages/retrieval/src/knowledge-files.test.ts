import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { extractKnowledgeFile, KnowledgeFileError, validateKnowledgeFiles, type KnowledgeFile } from "./knowledge-files";
const fixture = (name: string) => readFile(new URL(`../../../docs/evaluation/knowledge-fixtures/${name}`, import.meta.url));
const text = (content: string): KnowledgeFile => ({ name: "selected.txt", mediaType: "text/plain", bytes: Buffer.from(content) });
test("strict individual byte intake refuses paths, disguised HTML/binary, unsupported formats and invalid UTF-8", () => {
  for (const file of [{ ...text("safe"), name: "C:\\private.txt" }, { ...text("safe"), name: "../private.txt" },
    text("<html>active page</html>"), text("\0binary"), { ...text("safe"), bytes: Buffer.from([0xff]) },
    { ...text("safe"), name: "archive.zip" }, { ...text("safe"), mediaType: "application/pdf" as const }]) {
    expect(() => validateKnowledgeFiles([file])).toThrow(KnowledgeFileError);
  }
});
test("all batch count and byte limits apply before extraction", () => {
  expect(() => validateKnowledgeFiles([])).toThrow();
  expect(() => validateKnowledgeFiles(Array.from({ length: 7 }, () => text("safe")))).toThrow();
  expect(() => validateKnowledgeFiles([text("x".repeat(1_048_577))])).toThrow();
  const pdf: KnowledgeFile = { name: "selected.pdf", mediaType: "application/pdf", bytes: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(5 * 1_048_576 - 5)]) };
  expect(() => validateKnowledgeFiles([pdf, pdf, pdf])).toThrow();
});
test("UTF-8 original normalization is explicit and character overflow retains no partial extraction", async () => {
  expect(await extractKnowledgeFile(text("Türkçe İ\r\nAzınlık\rkanıt"))).toMatchObject({ status: "complete", text: "Türkçe İ\nAzınlık\nkanıt", pages: [{ page: null, start: 0 }] });
  expect(await extractKnowledgeFile(text("x".repeat(64_001)))).toMatchObject({ status: "failed", reason: "character_limit", text: "", pages: [] });
  expect(await extractKnowledgeFile(text(" "))).toMatchObject({ status: "extraction_unverified", reason: "empty_text" });
});
test("selectable PDF extraction preserves ordered page spans and parser provenance", async () => {
  const parsed = await extractKnowledgeFile({ name: "selected.pdf", mediaType: "application/pdf", bytes: await fixture("selectable-sun.pdf") });
  expect(parsed.status).toBe("complete"); expect(parsed.parserVersion).toMatch(/^knowledge-pdf-v1\/pdfjs-/);
  expect(parsed.pages).toHaveLength(1); expect(parsed.pages[0]).toEqual({ page: 1, start: 0, end: parsed.text.length });
  expect(parsed.text).toContain("Sun");
});
test("scanned PDF and image originals abstain rather than inventing evidence", async () => {
  expect(await extractKnowledgeFile({ name: "scan.pdf", mediaType: "application/pdf", bytes: await fixture("scanned-support.pdf") }))
    .toMatchObject({ status: "extraction_unverified", reason: "missing_text_pages" });
  expect(await extractKnowledgeFile({ name: "image.png", mediaType: "image/png", bytes: await fixture("ambiguous-support.png") }))
    .toMatchObject({ status: "extraction_unverified", reason: "image_unverified", text: "", pages: [] });
});
test("invalid and active PDF content returns fixed failure codes without raw error details", async () => {
  expect(await extractKnowledgeFile({ name: "invalid.pdf", mediaType: "application/pdf", bytes: Buffer.from("%PDF-invalid") }))
    .toMatchObject({ status: "failed", reason: "invalid_pdf", text: "", pages: [] });
  const bytes = Buffer.concat([await fixture("selectable-sun.pdf"), Buffer.from("\n/JavaScript secret-script")]);
  const result = await extractKnowledgeFile({ name: "active.pdf", mediaType: "application/pdf", bytes });
  expect(result).toMatchObject({ status: "failed", reason: "active_content", text: "", pages: [] });
  expect(JSON.stringify(result)).not.toContain("secret-script");
});
test("hard parser deadline kills a real child and yields no partial extraction", async () => {
  const result = await extractKnowledgeFile({ name: "deadline.pdf", mediaType: "application/pdf", bytes: await fixture("selectable-sun.pdf") }, 1);
  expect(result).toMatchObject({ status: "failed", reason: "timeout", text: "", pages: [] });
});
