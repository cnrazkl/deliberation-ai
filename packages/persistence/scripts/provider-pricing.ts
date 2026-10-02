import { readFile } from "node:fs/promises";
import { priceObservationSchema } from "@deliberation-ai/contracts";
import { closeDatabase } from "../src/database";
import { listProviderPrices, recordProviderPrice } from "../src/provider-pricing";

try {
  const [action, path, extra] = process.argv.slice(2);
  if (action === "list" && !path) console.log(JSON.stringify({ snapshots: await listProviderPrices() }, null, 2));
  else if (action === "record" && path && !extra) {
    const snapshot = await recordProviderPrice(priceObservationSchema.parse(JSON.parse(await readFile(path, "utf8"))));
    console.log(JSON.stringify({ id: snapshot.id, fingerprint: snapshot.fingerprint, connectionRevision: snapshot.connectionRevision }));
  } else throw new Error("Expected list or record <local-json-file>.");
} finally {
  await closeDatabase();
}
