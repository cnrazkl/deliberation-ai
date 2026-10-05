import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { knowledgeExcerptLocator, readKnowledgeExcerpt, validateKnowledgeExtraction, validateKnowledgeOriginal } from "./knowledge";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const text = "İnsan kaynağı: iki görüş; azınlık korunur.", id = randomUUID();
  const metadata = { id, sourceId: randomUUID(), collectionId: randomUUID(), ownerId: "local-owner", originalHash: hash(text),
    parserVersion: "knowledge-utf8-v1", originalBytes: Buffer.byteLength(text), textBytes: Buffer.byteLength(text), status: "complete" };
  const identity = { versionId: id, sourceId: metadata.sourceId, collectionId: metadata.collectionId, ownerId: metadata.ownerId };
  const original = { ...identity, name: "source.txt", mediaType: "text/plain", originalHash: metadata.originalHash, dataBase64: Buffer.from(text).toString("base64") };
  const body = { ...identity, ...original, parserVersion: metadata.parserVersion, status: "complete", reason: null,
    text, textHash: hash(text), pages: [{ page: null, start: 0, end: text.length, textHash: hash(text) }] };
  const { dataBase64: _data, ...extracted } = body;
  return { metadata, original, body: extracted };
}
test("original bytes and extracted spans authenticate source/version/owner/collection identities", () => {
  const value = fixture(); expect(validateKnowledgeOriginal(value.original, value.metadata)).toEqual(value.original);
  const body = validateKnowledgeExtraction(value.body, value.metadata);
  for (const changed of [{ ...value.metadata, sourceId: randomUUID() }, { ...value.metadata, ownerId: "foreign" },
    { ...value.metadata, collectionId: randomUUID() }, { ...value.metadata, originalBytes: 1 }]) {
    expect(() => validateKnowledgeOriginal(value.original, changed)).toThrow();
  }
  expect(body.text).toContain("azınlık");
  expect(() => validateKnowledgeExtraction({ ...value.body, text: "tampered" }, value.metadata)).toThrow();
  expect(() => validateKnowledgeExtraction({ ...value.body, pages: [{ ...body.pages[0]!, start: 1 }] }, value.metadata)).toThrow();
});
test("content-bound v8 excerpt locators round-trip exact spans and reject substitution", () => {
  const value = fixture(), body = validateKnowledgeExtraction(value.body, value.metadata);
  const id = knowledgeExcerptLocator(body.versionId, body.textHash, 0, body.text.length, null);
  expect(readKnowledgeExcerpt(body, id)).toEqual({ start: 0, end: body.text.length, page: null, text: body.text, textHash: body.textHash });
  expect(() => readKnowledgeExcerpt({ ...body, versionId: randomUUID() }, id)).toThrow();
  expect(() => readKnowledgeExcerpt(body, id.replace(/^0000/, "0001"))).toThrow();
  expect(() => knowledgeExcerptLocator(body.versionId, body.textHash, 0, 1_501, null)).toThrow();
  expect(() => readKnowledgeExcerpt({ ...body, status: "extraction_unverified" }, id)).toThrow();
});
