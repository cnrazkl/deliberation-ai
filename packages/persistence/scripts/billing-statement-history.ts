import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { billingStatementChangeSchema, billingStatementSchema } from "@deliberation-ai/contracts";
import { closeDatabase } from "../src/database";
import { getStatementHistory, listStatementHeads, previewStatementVersion, recordStatementVersion } from "../src/billing-statement-history";

try {
  const [action, inputPath, evidencePath, extra] = process.argv.slice(2);
  if (action === "list" && !inputPath) console.log(JSON.stringify({ statements: await listStatementHeads() }, null, 2));
  else if (action === "show" && inputPath && !evidencePath) {
    const history = await getStatementHistory(billingStatementSchema.shape.connectionId.parse(inputPath));
    if (!history) throw new Error("Owned statement version was not found.");
    console.log(JSON.stringify(history, null, 2));
  } else if (["preview", "record"].includes(action ?? "") && inputPath && evidencePath && !extra) {
    if ((await stat(inputPath)).size > 1_100_000 || (await stat(evidencePath)).size > 20_000_000) throw new Error("Statement input exceeds size limit.");
    const input = billingStatementChangeSchema.parse(JSON.parse(await readFile(inputPath, "utf8")) as unknown);
    const digest = createHash("sha256").update(await readFile(evidencePath)).digest("hex");
    const result = action === "preview" ? { writes: false, ...await previewStatementVersion(input, digest) } : await recordStatementVersion(input, digest);
    console.log(JSON.stringify(result, null, 2));
  } else throw new Error("Expected list, show <version-id>, preview <json> <evidence> or record <json> <evidence>.");
} catch {
  console.error("Statement history command failed. Check the owned history, reviewed version, packet and evidence digest.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
