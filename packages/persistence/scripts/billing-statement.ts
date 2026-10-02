import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { billingStatementSchema } from "@deliberation-ai/contracts";
import { closeDatabase } from "../src/database";
import { inspectOwnedBillingStatement } from "../src/billing-statement";

try {
  const [inputPath, evidencePath, extra] = process.argv.slice(2);
  if (!inputPath || !evidencePath || extra) throw new Error("Expected statement JSON and evidence paths.");
  if ((await stat(inputPath)).size > 1_000_000 || (await stat(evidencePath)).size > 20_000_000) throw new Error("Statement file exceeds size limit.");
  const input = billingStatementSchema.parse(JSON.parse(await readFile(inputPath, "utf8")) as unknown);
  const digest = createHash("sha256").update(await readFile(evidencePath)).digest("hex");
  const report = await inspectOwnedBillingStatement(input, digest);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "incomplete") process.exitCode = 2;
} catch {
  console.error("Statement inspection failed. Check the packet, evidence digest, review date and owned billing history.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
