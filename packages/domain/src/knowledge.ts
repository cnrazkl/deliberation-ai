import { createHash } from "node:crypto";
import { knowledgeVersionExtractionSchema, knowledgeVersionOriginalSchema, type KnowledgeVersionExtraction } from "@deliberation-ai/contracts";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export type KnowledgeVersionMetadata = { id: string; sourceId: string; collectionId: string; ownerId: string;
  originalHash: string; parserVersion: string; originalBytes: number; textBytes: number; status: string };
export class KnowledgeIntegrityError extends Error { constructor() { super("Stored knowledge integrity check failed."); } }
function identity(body: { versionId: string; sourceId: string; collectionId: string; ownerId: string; originalHash: string }, row: KnowledgeVersionMetadata) {
  if (body.versionId !== row.id || body.sourceId !== row.sourceId || body.collectionId !== row.collectionId
    || body.ownerId !== row.ownerId || body.originalHash !== row.originalHash) throw new KnowledgeIntegrityError();
}
export function validateKnowledgeOriginal(value: unknown, row: KnowledgeVersionMetadata) {
  const body = knowledgeVersionOriginalSchema.parse(value); identity(body, row);
  const bytes = Buffer.from(body.dataBase64, "base64");
  const limit = body.mediaType === "application/pdf" ? 5 * 1_048_576 : body.mediaType.startsWith("image/") ? 2 * 1_048_576 : 1_048_576;
  if (!bytes.length || bytes.length !== row.originalBytes || bytes.length > limit || bytes.toString("base64") !== body.dataBase64
    || hash(bytes) !== row.originalHash || /[\\/:\x00-\x1f]/.test(body.name)) throw new KnowledgeIntegrityError();
  return body;
}
export function validateKnowledgeExtraction(value: unknown, row: KnowledgeVersionMetadata): KnowledgeVersionExtraction {
  const body = knowledgeVersionExtractionSchema.parse(value); identity(body, row);
  if (body.parserVersion !== row.parserVersion || body.status !== row.status || Buffer.byteLength(body.text, "utf8") !== row.textBytes
    || hash(body.text) !== body.textHash) throw new KnowledgeIntegrityError();
  const image = body.mediaType.startsWith("image/"), pdf = body.mediaType === "application/pdf";
  if (body.status === "complete" && (body.reason !== null || !body.text.trim() || image || !body.pages.length)
    || body.status !== "complete" && body.reason === null
    || body.status === "failed" && (body.text !== "" || body.pages.length)
    || image && (body.status !== "extraction_unverified" || body.reason !== "image_unverified" || body.text || body.pages.length)) throw new KnowledgeIntegrityError();
  let end = 0;
  for (const [index, page] of body.pages.entries()) {
    if (page.start !== (index ? end + 2 : 0) || page.end < page.start || page.end > body.text.length
      || page.textHash !== hash(body.text.slice(page.start, page.end))
      || pdf && page.page !== index + 1 || !pdf && (page.page !== null || body.pages.length !== 1)
      || body.status === "complete" && page.start === page.end
      || index && body.text.slice(end, page.start) !== "\n\n") throw new KnowledgeIntegrityError();
    end = page.end;
  }
  if (body.pages.length && end !== body.text.length) throw new KnowledgeIntegrityError();
  return body;
}
// A v8 UUID encodes bounded UTF-16 start/end/page plus a content/version checksum.
// It is a locator, not an authorization token; every read still checks current scope.
export function knowledgeExcerptLocator(versionId: string, textHash: string, start: number, end: number, page: number | null) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > 64_000 || end - start > 1_500
    || page !== null && (!Number.isInteger(page) || page < 1 || page > 100)) throw new KnowledgeIntegrityError();
  const digest = hash(JSON.stringify([versionId, textHash, start, end, page]));
  const hex = (value: number) => value.toString(16).padStart(4, "0");
  return `${hex(start)}${hex(end)}-${hex(page ?? 0)}-8${digest.slice(0, 3)}-a${digest.slice(3, 6)}-${digest.slice(6, 18)}`;
}
export function readKnowledgeExcerpt(body: KnowledgeVersionExtraction, excerptId: string) {
  const start = Number.parseInt(excerptId.slice(0, 4), 16), end = Number.parseInt(excerptId.slice(4, 8), 16);
  const number = Number.parseInt(excerptId.slice(9, 13), 16), page = number === 0 ? null : number;
  if (body.status !== "complete" || !body.pages.some((span) => span.page === page && span.start <= start && span.end >= end)
    || knowledgeExcerptLocator(body.versionId, body.textHash, start, end, page) !== excerptId) throw new KnowledgeIntegrityError();
  const text = body.text.slice(start, end); return { start, end, page, text, textHash: hash(text) };
}
