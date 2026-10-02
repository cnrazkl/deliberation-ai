import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { billingPaymentSchema, billingPaymentEvidenceManifestSchema } from "@deliberation-ai/contracts";
import { closeDatabase } from "../src/database";
import { inspectOwnedBillingPayment } from "../src/billing-payment";

async function boundedJson(path: string, limit: number): Promise<unknown> {
  if (!isAbsolute(path)) throw new Error("Expected absolute JSON path.");
  const info = await stat(path);
  if (!info.isFile() || info.size > limit) throw new Error("Invalid JSON file.");
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error("JSON file exceeds size limit.");
  return JSON.parse(bytes.toString("utf8")) as unknown;
}
async function hashEvidence(path: string): Promise<{ digest: string; bytes: number }> {
  if (!isAbsolute(path)) throw new Error("Expected absolute evidence path.");
  const info = await stat(path);
  if (!info.isFile() || info.size > 20_000_000) throw new Error("Invalid evidence file.");
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += (chunk as Buffer).length;
    if (bytes > 20_000_000) throw new Error("Evidence exceeds size limit.");
    hash.update(chunk as Buffer);
  }
  return { digest: hash.digest("hex"), bytes };
}

try {
  const [inputPath, invoicePath, manifestPath, extra] = process.argv.slice(2);
  if (!inputPath || !invoicePath || !manifestPath || extra) throw new Error("Expected payment packet, invoice and evidence manifest.");
  const input = billingPaymentSchema.parse(await boundedJson(inputPath, 250_000));
  const manifest = billingPaymentEvidenceManifestSchema.parse(await boundedJson(manifestPath, 200_000));
  const ids = new Set(input.entries.map((entry) => entry.entryId)); const digests = new Map<string, string>();
  // Validate the whole manifest before reading any referenced source.
  const manifestIds = new Set<string>();
  for (const file of manifest.files) {
    if (!ids.has(file.entryId) || manifestIds.has(file.entryId) || !isAbsolute(file.path)) throw new Error("Unexpected or duplicated evidence entry.");
    manifestIds.add(file.entryId);
  }
  // One statement document can support several distinct transaction lines; hash its bytes only once.
  const paths = [...new Set(manifest.files.map((file) => file.path))];
  let plannedBytes = 0;
  for (const path of paths) {
    const info = await stat(path); plannedBytes += info.size;
    if (!info.isFile() || info.size > 20_000_000 || plannedBytes > 100_000_000) throw new Error("Payment evidence exceeds limits.");
  }
  const invoice = await hashEvidence(invoicePath); let evidenceBytes = 0; const hashes = new Map<string, string>();
  for (const path of paths) {
    const selected = path === invoicePath ? invoice : await hashEvidence(path); evidenceBytes += selected.bytes;
    if (evidenceBytes > 100_000_000) throw new Error("Payment evidence exceeds limits.");
    hashes.set(path, selected.digest);
  }
  for (const file of manifest.files) digests.set(file.entryId, hashes.get(file.path)!);
  const report = await inspectOwnedBillingPayment(input, invoice.digest, digests);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "incomplete") process.exitCode = 2;
} catch {
  console.error("Payment inspection failed. Check the packet, source files, review date and owned invoice history.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
