import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { knowledgePdfWorkerPath } from "./knowledge-pdf-worker-path.cjs";
import { version as pdfJsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";

export const KNOWLEDGE_FILE_LIMITS = { batchFiles: 6, batchBytes: 12 * 1_048_576, textBytes: 1_048_576,
  pdfBytes: 5 * 1_048_576, imageBytes: 2 * 1_048_576, characters: 64_000, pdfTimeoutMs: 10_000 } as const;
export type KnowledgeFile = { name: string; mediaType: "text/plain" | "text/markdown" | "application/pdf" | "image/png" | "image/jpeg"; bytes: Uint8Array };
export type KnowledgeExtraction = { parserVersion: string; status: "complete" | "extraction_unverified" | "failed";
  reason: "missing_text_pages" | "image_unverified" | "empty_text" | "invalid_pdf" | "active_content" | "page_limit" | "character_limit" | "timeout" | "parser_unavailable" | null;
  text: string; pages: { page: number | null; start: number; end: number }[] };
export class KnowledgeFileError extends Error { constructor() { super("Selected knowledge files are unsupported or exceed the intake limits."); } }
export const knowledgeDigest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export function knowledgeParserVersion(type: KnowledgeFile["mediaType"]) {
  return type === "application/pdf" ? `knowledge-pdf-v1/pdfjs-${pdfJsVersion}`
    : type.startsWith("image/") ? "knowledge-image-original-v1" : "knowledge-utf8-v1";
}
export function validateKnowledgeFiles(files: readonly KnowledgeFile[]): void {
  if (!files.length || files.length > 6) throw new KnowledgeFileError();
  let total = 0;
  for (const file of files) {
    if (!file.name || file.name.length > 200 || /[\\/:\x00-\x1f]/.test(file.name) || file.name === "." || file.name === ".."
      || !(file.bytes instanceof Uint8Array) || !file.bytes.byteLength) throw new KnowledgeFileError();
    const type = file.mediaType;
    const limit = type === "application/pdf" ? KNOWLEDGE_FILE_LIMITS.pdfBytes
      : type === "image/png" || type === "image/jpeg" ? KNOWLEDGE_FILE_LIMITS.imageBytes : KNOWLEDGE_FILE_LIMITS.textBytes;
    if (file.bytes.byteLength > limit || (total += file.bytes.byteLength) > KNOWLEDGE_FILE_LIMITS.batchBytes) throw new KnowledgeFileError();
    const bytes = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
    if (type === "application/pdf") {
      if (!/\.pdf$/i.test(file.name) || bytes.toString("ascii", 0, 5) !== "%PDF-") throw new KnowledgeFileError();
    } else if (type === "image/png") {
      if (!/\.png$/i.test(file.name) || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new KnowledgeFileError();
    } else if (type === "image/jpeg") {
      if (!/\.jpe?g$/i.test(file.name) || !bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) throw new KnowledgeFileError();
    } else if (type === "text/plain" || type === "text/markdown") {
      if (!(type === "text/plain" ? /\.txt$/i : /\.(?:md|markdown)$/i).test(file.name)) throw new KnowledgeFileError();
      let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new KnowledgeFileError(); }
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || /^\s*(?:<!doctype\s+html|<html\b|<svg\b|<\?xml)/i.test(text)) throw new KnowledgeFileError();
    } else throw new KnowledgeFileError();
  }
}
export async function extractKnowledgeFile(file: KnowledgeFile, deadlineMs: number = KNOWLEDGE_FILE_LIMITS.pdfTimeoutMs): Promise<KnowledgeExtraction> {
  validateKnowledgeFiles([file]);
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 10_000) throw new KnowledgeFileError();
  if (file.mediaType.startsWith("image/")) return { parserVersion: "knowledge-image-original-v1", status: "extraction_unverified", reason: "image_unverified", text: "", pages: [] };
  if (file.mediaType !== "application/pdf") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes).replace(/\r\n?/g, "\n");
    const failed = text.length > 64_000;
    return { parserVersion: "knowledge-utf8-v1", status: failed ? "failed" : text.trim() ? "complete" : "extraction_unverified",
      reason: failed ? "character_limit" : text.trim() ? null : "empty_text", text: failed ? "" : text,
      pages: failed ? [] : [{ page: null, start: 0, end: text.length }] };
  }
  return new Promise((resolve) => {
    const worker = spawn(process.execPath, ["--max-old-space-size=192", knowledgePdfWorkerPath],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
        env: { NODE_ENV: "production", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } });
    const chunks: Buffer[] = []; let outputBytes = 0, forced: "timeout" | "invalid_pdf" | undefined;
    const timer = setTimeout(() => { forced = "timeout"; worker.kill("SIGKILL"); }, deadlineMs);
    const failed = (): KnowledgeExtraction => ({ parserVersion: knowledgeParserVersion(file.mediaType), status: "failed", reason: forced === "timeout" ? "timeout" : "parser_unavailable", text: "", pages: [] });
    worker.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 512 * 1_024) { forced = "invalid_pdf"; worker.kill("SIGKILL"); } else chunks.push(chunk);
    });
    worker.stdin.on("error", () => undefined);
    worker.on("error", () => { clearTimeout(timer); resolve(failed()); });
    worker.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || forced) return resolve(failed());
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as KnowledgeExtraction;
        if (value.parserVersion !== knowledgeParserVersion(file.mediaType) || !["complete", "extraction_unverified", "failed"].includes(value.status)
          || typeof value.text !== "string" || value.text.length > 64_000 || !Array.isArray(value.pages) || value.pages.length > 100) return resolve(failed());
        resolve(value);
      } catch { resolve(failed()); }
    });
    worker.stdin.end(Buffer.from(file.bytes));
  });
}
