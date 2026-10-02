import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { providerBillingSchema, providerBillingChangeSchema, providerBillingReallocationSchema } from "@deliberation-ai/contracts";
import { closeDatabase } from "../src/database";
import { getProviderBilling, listProviderBilling, previewProviderBilling, recordProviderBilling, previewProviderBillingChange, recordProviderBillingChange } from "../src/provider-billing";
import { previewBillingReallocation, recordBillingReallocation } from "../src/billing-reallocations";

try {
  const [action, inputPath, evidencePath, extra] = process.argv.slice(2);
  if (action === "list" && !inputPath) console.log(JSON.stringify({ records: await listProviderBilling() }, null, 2));
  else if (action === "show" && inputPath && !evidencePath) {
    const record = await getProviderBilling(providerBillingSchema.shape.operationId.parse(inputPath));
    if (!record) throw new Error("Owned billing record was not found.");
    console.log(JSON.stringify(record, null, 2));
  }
  else if (["preview", "record", "change-preview", "change-record", "reallocate-preview", "reallocate-record"].includes(action ?? "") && inputPath && evidencePath && !extra) {
    if ((await stat(inputPath)).size > 64_000 || (await stat(evidencePath)).size > 20_000_000) throw new Error("Billing input exceeds the local size limit.");
    const json: unknown = JSON.parse(await readFile(inputPath, "utf8"));
    const digest = createHash("sha256").update(await readFile(evidencePath)).digest("hex");
    const result = action === "reallocate-preview" ? await previewBillingReallocation(providerBillingReallocationSchema.parse(json), digest)
      : action === "reallocate-record" ? await recordBillingReallocation(providerBillingReallocationSchema.parse(json), digest)
      : action === "change-preview" ? await previewProviderBillingChange(providerBillingChangeSchema.parse(json), digest)
      : action === "change-record" ? await recordProviderBillingChange(providerBillingChangeSchema.parse(json), digest)
        : action === "preview" ? await previewProviderBilling(providerBillingSchema.parse(json), digest) : await recordProviderBilling(providerBillingSchema.parse(json), digest);
    console.log(JSON.stringify(action?.endsWith("preview") ? { checked: true, writes: false, ...result } : result, null, 2));
  } else throw new Error("Expected list, preview <json> <evidence>, or record <json> <evidence>.");
} catch {
  console.error("Billing command failed. Check the JSON, evidence digest, owned receipt match and existing immutable records.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
