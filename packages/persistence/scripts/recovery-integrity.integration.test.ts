import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Client } from "pg";
import { defaultFakeCouncilMembers, type PrivateBranchBody } from "@deliberation-ai/contracts";
import { encryptJson } from "../src/crypto";
import { getBoss, closeBoss } from "../src/queue";
import { closeDatabase } from "../src/database";
import { snapshotRecoveryDatabase, requireMatchingRecovery, inspectRecoveryWork, parkRestoredQueue } from "./recovery-integrity";

beforeAll(async () => { await getBoss(); await closeBoss(); });
afterAll(async () => { await closeBoss(); await closeDatabase(); });

test("real-schema fingerprints preserve timezone equality and reject changed receipt bytes or constraints", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  let created = false;
  try {
    const database = (await client.query("SELECT current_database() AS name")).rows[0].name as string;
    if (!/^da_it_[a-f0-9]{16}$/u.test(database)) throw new Error("Recovery test requires a generated database.");
    await client.query("CREATE TABLE public.recovery_integrity_fixture (id uuid PRIMARY KEY, receipt text NOT NULL, at timestamptz NOT NULL, revision integer CHECK((revision between 1 and 65) AND (revision<>2 AND revision<>3)))"); created = true;
    await client.query("INSERT INTO public.recovery_integrity_fixture VALUES ($1,'generated ciphertext','2026-01-01T12:00:00Z',1)", [randomUUID()]);
    await client.query("SET TimeZone='Europe/Istanbul'"); const before = await snapshotRecoveryDatabase(client);
    await client.query("SET TimeZone='UTC'"); requireMatchingRecovery(before, await snapshotRecoveryDatabase(client));
    await client.query("ALTER TABLE public.recovery_integrity_fixture DROP CONSTRAINT recovery_integrity_fixture_revision_check");
    await client.query("ALTER TABLE public.recovery_integrity_fixture ADD CONSTRAINT recovery_integrity_fixture_revision_check CHECK(revision>=1 AND revision<=65 AND revision<>2 AND revision<>3)");
    requireMatchingRecovery(before, await snapshotRecoveryDatabase(client));
    await client.query("UPDATE public.recovery_integrity_fixture SET receipt='changed generated receipt'");
    const changed = await snapshotRecoveryDatabase(client); expect(() => requireMatchingRecovery(before, changed, true)).toThrow("reconciliation");
    await client.query("UPDATE public.recovery_integrity_fixture SET receipt='generated ciphertext'");
    requireMatchingRecovery(before, await snapshotRecoveryDatabase(client));
    await client.query("ALTER TABLE public.recovery_integrity_fixture ADD CONSTRAINT changed_guard CHECK(revision<10)");
    const changedSchema = await snapshotRecoveryDatabase(client); expect(() => requireMatchingRecovery(before, changedSchema)).toThrow("reconciliation");
  } finally {
    if (created) await client.query("DROP TABLE public.recovery_integrity_fixture");
    await client.end();
  }
});

test("terminal unsubmitted history is separate while submitted or unknown attempts still block recovery", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL }), id = randomUUID(); await client.connect();
  try {
    const before = await inspectRecoveryWork(client);
    await client.query(`INSERT INTO runs(id,owner_id,idempotency_key,request_hash,question,snapshot_id,status)
      VALUES ($1::uuid,'generated-recovery-owner',$1::text,'generated','generated recovery fixture',$2::uuid,'queued')`, [id, randomUUID()]);
    for (const status of ["prepared", "retry_authorized", "submitted", "outcome_unknown"]) {
      await client.query(`INSERT INTO provider_operations(id,run_id,member_id,provider,model,status,request_fingerprint,submitted_at)
        VALUES ($1::uuid,$2::uuid,$1::text,'fake','generated',$3::text,'generated',CASE WHEN $3::text IN ('submitted','outcome_unknown') THEN now() ELSE NULL END)`, [randomUUID(), id, status]);
    }
    expect((await inspectRecoveryWork(client)).councilUnsettled).toBe(before.councilUnsettled + 4);
    await client.query("UPDATE runs SET status='completed' WHERE id=$1", [id]);
    const terminal = await inspectRecoveryWork(client);
    expect(terminal.councilUnsettled).toBe(before.councilUnsettled + 2);
    expect(terminal.councilHistoricalUnsubmitted).toBe(before.councilHistoricalUnsubmitted + 2);
  } finally { await client.query("DELETE FROM runs WHERE id=$1", [id]); await client.end(); }
});

test("actual queue inspection rejects unacknowledged parking without changing retained records", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    const before = await snapshotRecoveryDatabase(client);
    const work = await inspectRecoveryWork(client);
    expect(work.privateJobsWithoutReceipt).toBeGreaterThanOrEqual(0);
    expect(work.councilHistoricalUnsubmitted).toBeGreaterThanOrEqual(0);
    await expect(parkRestoredQueue(client, false)).rejects.toThrow("acknowledgement");
    requireMatchingRecovery(before, await snapshotRecoveryDatabase(client));
  } finally { await client.end(); }
});

test("authenticates copied origins and retained deletion audits without charging or dispatching copied receipts", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  const conversation = randomUUID(), source = randomUUID(), origin = randomUUID(), copy = randomUUID(), operation = randomUUID(), message = randomUUID(), creation = randomUUID(), now = new Date().toISOString();
  const body: PrivateBranchBody = { version: "private-branch-drafts-v1", forkedFrom: null,
    seed: { version: "selected-member-private-seed-v1", conversationId: conversation, sourceRunId: source, sourceStateVersion: 1, sourceRiskProfile: "standard", sourcePromptVersion: "fixture", sourcePromptFingerprint: null,
      member: defaultFakeCouncilMembers[0]!, question: "SENSITIVE SYNTHETIC QUESTION", rawText: "SYNTHETIC RAW", reusedFromRunId: null },
    messages: [{ id: message, kind: "owner-draft", text: "Synthetic draft", createdAt: now, originBranchId: origin, acceptedRevision: 2 }],
    deliveries: [{ id: operation, messageId: message, originBranchId: origin, status: "outcome_unknown", fingerprint: "a".repeat(64), connectionId: randomUUID(), connectionFingerprint: "b".repeat(64),
      request: { version: "private-text-v1", model: "fixture", maxOutputTokens: 128, messages: Array.from({ length: 4 }, () => ({ role: "user" as const, content: "Synthetic request" })) }, createdAt: now, submittedAt: now, finishedAt: null, errorCode: null, result: null }] };
  try {
    await client.query("BEGIN"); const baseline = await inspectRecoveryWork(client);
    await client.query("INSERT INTO conversations(id,owner_id,anchor_run_id,origin) VALUES($1,'recovery-fixture',$2,'native')", [conversation, source]);
    for (const id of [origin, copy]) {
      const value = id === origin ? body : { ...body, forkedFrom: { branchId: origin, revision: 2, messageCount: 1 } };
      await client.query(`INSERT INTO conversation_private_branches(id,owner_id,conversation_id,source_run_id,source_member_id,parent_branch_id,request_id,request_hash,revision,message_count,body_ciphertext)
        VALUES($1,'recovery-fixture',$2,$3,$4,$5,$6,'fixture',$7,1,$8)`, [id, conversation, source, body.seed.member.id, id === origin ? null : origin, id === origin ? creation : randomUUID(), id === origin ? 2 : 1, encryptJson(value, `private-branch:${id}:body`)]);
    }
    for (const id of [origin, copy, randomUUID()]) await client.query("INSERT INTO pgboss.job(name,data) VALUES('private-text-delivery',$1::jsonb)", [JSON.stringify({ branchId: id, operationId: operation })]);
    const live = await inspectRecoveryWork(client);
    expect(live.privatePending).toBe(baseline.privatePending + 1); expect(live.privateCopies).toBe(baseline.privateCopies + 1);
    expect(live.privateJobsWithLiveReceipt).toBe(baseline.privateJobsWithLiveReceipt + 1);
    expect(live.privateJobsTargetingCopy).toBe(baseline.privateJobsTargetingCopy + 1);
    expect(live.privateJobsWithoutReceipt).toBe(baseline.privateJobsWithoutReceipt + 1);
    const audit = { version: "private-branch-deletion-audit-v1", branchId: origin, conversationId: conversation, creationRequestId: creation, sourceRunId: source, parentBranchId: null, deletedAt: now,
      fingerprint: "c".repeat(64), messageCount: 1, receipts: [{ operationId: operation, originBranchId: origin, connectionId: body.deliveries![0]!.connectionId, status: "discarded", createdAt: now, submittedAt: now, finishedAt: now, usage: null }] };
    await client.query("DELETE FROM conversation_private_branches WHERE id=$1", [origin]);
    await client.query("INSERT INTO private_branch_deletions(id,owner_id,conversation_id,request_id,audit_ciphertext,deleted_at) VALUES($1,'recovery-fixture',$2,$3,$4,$5)", [origin, conversation, creation, encryptJson(audit, `private-branch-deletion:${origin}:audit`), now]);
    const retained = await inspectRecoveryWork(client);
    expect(retained.privatePending).toBe(baseline.privatePending);
    expect(retained.privateJobsWithDeletedReceipt).toBe(baseline.privateJobsWithDeletedReceipt + 1);
    expect(retained.privateCopyOriginMissing).toBe(baseline.privateCopyOriginMissing);
    expect(JSON.stringify(retained)).not.toContain("SENSITIVE");
    await client.query("UPDATE private_branch_deletions SET audit_ciphertext=$1 WHERE id=$2", [encryptJson(audit, "wrong-context"), origin]);
    await expect(inspectRecoveryWork(client)).rejects.toThrow();
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
