import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { billingAccountSchema } from "@deliberation-ai/contracts";
import { closeDatabase } from "../src/database";
import { inspectOwnedBillingAccount } from "../src/billing-account";

try {
  const [inputPath, evidencePath, extra] = process.argv.slice(2);
  if (!inputPath || !evidencePath || extra) throw new Error("Expected account JSON and evidence paths.");
  if ((await stat(inputPath)).size > 200_000 || (await stat(evidencePath)).size > 20_000_000) throw new Error("Account file exceeds size limit.");
  const inputBytes = await readFile(inputPath, "utf8"); const evidenceBytes = await readFile(evidencePath);
  if (Buffer.byteLength(inputBytes, "utf8") > 200_000 || evidenceBytes.length > 20_000_000) throw new Error("Account file exceeds size limit.");
  const input = billingAccountSchema.parse(JSON.parse(inputBytes) as unknown);
  const report = await inspectOwnedBillingAccount(input, createHash("sha256").update(evidenceBytes).digest("hex"));
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "incomplete") process.exitCode = 2;
} catch {
  console.error("Account inspection failed. Check the packet, evidence digest, review date and owned statement history.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
