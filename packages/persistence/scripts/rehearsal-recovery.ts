import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { closeDatabase } from "../src/database";
import { provisionLocalRoot, registerLocalUser } from "../src/local-auth";
import { saveProviderConnection } from "../src/provider-connections";
import { withStudyOwner } from "../src/study-owner";
import { auditRestoredAccounts } from "./backup-account-audit";
import { auditRestoredEncryption } from "./backup-encryption-audit";
import { requireMatchingRecovery, snapshotRecoveryDatabase } from "./recovery-integrity";

// Only synthetic databases inside this rehearsal's own Docker network are accepted.
// Native Windows backup tooling remains separately required in its ordinary suite.
const source = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
const clients: Client[] = [];
try {
  assert.equal(source.hostname,"db");
  assert.match(source.pathname,/^\/deliberation_recovery_[a-f0-9]{12}$/u);
  const mode = process.argv[2];
  if (mode === "seed") {
    await provisionLocalRoot(randomBytes(24).toString("base64url"));
    const user = await registerLocalUser({ username: `recovery_${randomBytes(6).toString("hex")}`,password: randomBytes(24).toString("base64url") });
    await withStudyOwner(user.ownerId, () => saveProviderConnection({ provider: "openai",label: "Synthetic restore fixture",
      apiKey: `synthetic-${randomBytes(24).toString("hex")}`,defaultModel: "fixture-model",endpointPreset: "custom",
      reasoningProtocol: "none",structuredOutputMode: "json-schema" }));
    console.log(JSON.stringify({ status: "seeded",providerCalls: 0 }));
  } else if (mode === "compare") {
    const restoredName = process.env.REHEARSAL_RESTORE_DB_NAME;
    assert.match(restoredName ?? "",/^deliberation_restored_[a-f0-9]{12}$/u);
    assert.equal(restoredName?.slice(-12),source.pathname.slice(-12));
    const restored = new URL(source); restored.pathname=`/${restoredName}`;
    for (const url of [source,restored]) {
      const client = new Client({ connectionString: url.toString() }); clients.push(client); await client.connect();
    }
    const snapshots = [];
    for (const client of clients) snapshots.push(await snapshotRecoveryDatabase(client));
    requireMatchingRecovery(snapshots[0]!,snapshots[1]!);
    const accounts = await auditRestoredAccounts(clients[1]!);
    assert.equal(accounts?.users,2); assert.equal(accounts?.roots,1);
    const encryption = await auditRestoredEncryption(clients[1]!);
    assert.ok(encryption.rows > 0 && encryption.decryptedValues > 0);
    console.log(JSON.stringify({ status: "passed",providerCalls: 0,tables: Object.keys(snapshots[0]!.tables).length,
      fingerprint: snapshots[0]!.fingerprint,accounts,encryption }));
  } else throw new Error("Expected seed or compare.");
} catch {
  console.error("Isolated synthetic archive recovery failed; no existing database is a valid target.");
  process.exitCode=1;
} finally {
  for (const client of clients) await client.end();
  await closeDatabase();
}
