import { randomBytes, randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { provisionLocalRoot, registerLocalUser, loginLocalUser, readLocalSession, logoutLocalUser, listLocalUsers, selectLocalUserScope, changeLocalPassword } from "./local-auth";
import { closeDatabase, getDatabase } from "./database";
import { closeBoss } from "./queue";
import { withOwner, LOCAL_OWNER_ID, getOwnerId } from "./owner";
import { localUsers, localSessions, runs } from "./schema";
import { saveProviderConnection, listProviderConnections, loadProviderConnectionSecret, deleteProviderConnection } from "./provider-connections";
import { saveDecisionConnection, listDecisionConnections } from "./decision-connections";
import { saveMcpConnection, listMcpConnections, discoverMcpTools } from "./mcp-connections";
import { enqueueDurableRun, executeDurableRun, findDurableRunById, cancelDurableRun, listDurableRuns } from "./run-repository";
import { withWorkerOwner } from "./worker-owner";
import { listMemoryEntries, saveMemoryEntry } from "./memory-entries";
import { createKnowledgeCollection, exportKnowledgeCollection, listKnowledgeCollections, changeKnowledgeGrant, authorizeKnowledgeScope } from "./knowledge-scope";
import { createLocalSchedule, updateLocalSchedule, listLocalSchedules } from "./local-schedules";
import { dispatchAllUserSchedules } from "./worker-owner";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { readHostQuiescence } from "./host-quiescence";
import { auditRestoredAccounts } from "../scripts/backup-account-audit";
import { Client } from "pg";

const password = randomBytes(24).toString("base64url");
let root: Awaited<ReturnType<typeof provisionLocalRoot>>;
let alice: typeof root, bob: typeof root;
beforeAll(async () => {
  root = await provisionLocalRoot(password);
  alice = await registerLocalUser({ username: `a_${randomBytes(8).toString("hex")}`, displayName: "Alice", password });
  bob = await registerLocalUser({ username: `b_${randomBytes(8).toString("hex")}`, displayName: "Bob", password });
});
afterAll(async () => { await closeBoss(); await closeDatabase(); });
test("root preserves the legacy owner, and registration cannot inject privileges or reuse a normalized name", async () => {
  expect(root.ownerId).toBe(LOCAL_OWNER_ID); expect(alice.ownerId).not.toBe(bob.ownerId);
  await expect(registerLocalUser({ username: "root", displayName: "Pretender", password })).rejects.toMatchObject({ status: 400 });
  await expect(registerLocalUser({ username: "new_user", displayName: "Pretender", password, role: "root" })).rejects.toMatchObject({ status: 400 });
  await expect(registerLocalUser({ username: alice.username.toUpperCase(), displayName: "Duplicate", password })).rejects.toMatchObject({ status: 409 });
  await expect(provisionLocalRoot(`${password}wrong`)).rejects.toMatchObject({ status: 409 });
  const [stored] = await getDatabase().select().from(localUsers).where(eq(localUsers.id, alice.id));
  expect(stored?.passwordHash).toMatch(/^scrypt-v1:/u); expect(stored?.passwordHash).not.toContain(password);
});
test("only root lists accounts or selects another user's complete workspace", async () => {
  const a = await loginLocalUser({ username: alice.username, password });
  const admin = await loginLocalUser({ username: root.username, password });
  await expect(listLocalUsers(a.token)).rejects.toMatchObject({ status: 403 });
  await expect(selectLocalUserScope(a.token, bob.id)).rejects.toMatchObject({ status: 403 });
  expect((await listLocalUsers(admin.token)).map(u => u.id)).toContain(bob.id);
  expect((await selectLocalUserScope(admin.token, bob.id)).scope.ownerId).toBe(bob.ownerId);
  expect((await readLocalSession(admin.token))?.user.role).toBe("root");
  expect((await readLocalSession(admin.token))?.scope.id).toBe(bob.id);
  expect(JSON.stringify(await listLocalUsers(admin.token))).not.toContain("passwordHash");
  await logoutLocalUser(a.token); await logoutLocalUser(admin.token);
});
test("tokens are hashed, revoked on logout, expired, and all sessions end on password change", async () => {
  const first = await loginLocalUser({ username: bob.username, password }), second = await loginLocalUser({ username: bob.username, password });
  const hash = createHash("sha256").update(first.token).digest("hex");
  const [stored] = await getDatabase().select().from(localSessions).where(eq(localSessions.tokenHash, hash));
  expect(stored?.tokenHash).not.toBe(first.token); expect(await readLocalSession(first.token)).not.toBeNull();
  await getDatabase().update(localSessions).set({ expiresAt: new Date(0) }).where(eq(localSessions.tokenHash, hash));
  expect(await readLocalSession(first.token)).toBeNull();
  const third = await loginLocalUser({ username: bob.username, password });
  await logoutLocalUser(third.token); expect(await readLocalSession(third.token)).toBeNull();
  const changed = await changeLocalPassword(second.token, { currentPassword: password, password: `${password}-new` });
  expect(await readLocalSession(second.token)).toBeNull(); expect(await readLocalSession(changed.token)).not.toBeNull();
  await expect(loginLocalUser({ username: bob.username, password })).rejects.toMatchObject({ status: 401 });
  await expect(loginLocalUser({ username: "missing-user", password })).rejects.toMatchObject({ status: 401 });
});
test("identical connection labels stay separate; foreign IDs cannot read, update, delete or call APIs", async () => {
  const connections = await Promise.all([alice, bob].map(user => withOwner(user.ownerId, async () => {
    const provider = await saveProviderConnection({ provider: "openai", label: "Same label", defaultModel: "offline-fixture", apiKey: `fixture-${user.id}`,
      endpointPreset: "custom", reasoningProtocol: "openai", structuredOutputMode: "json-schema" });
    await saveDecisionConnection({ label: "Same label", defaultModel: "test", apiKey: `decision-${user.id}` });
    const mcp = await saveMcpConnection({ label: "Same label", endpoint: "http://127.0.0.1:9876/mcp" });
    return { provider, mcp };
  })));
  const a = connections[0]!, b = connections[1]!;
  expect(a.provider.id).not.toBe(b.provider.id);
  await withOwner(alice.ownerId, async () => {
    expect((await listProviderConnections()).map(c => c.id)).toEqual([a.provider.id]);
    expect((await listDecisionConnections()).length).toBe(1); expect((await listMcpConnections()).map(c => c.id)).toEqual([a.mcp.id]);
    expect((await loadProviderConnectionSecret(a.provider.id))?.apiKey).toBe(`fixture-${alice.id}`);
    expect(await loadProviderConnectionSecret(b.provider.id)).toBeUndefined();
    expect(await deleteProviderConnection(b.provider.id)).toBe(false);
    expect(await discoverMcpTools(b.mcp.id)).toBeUndefined(); // no network connection to the foreign endpoint
    await expect(saveProviderConnection({ ...b.provider, id: b.provider.id, apiKey: "overwrite" })).rejects.toThrow("not found");
  });
  expect((await withOwner(bob.ownerId, () => loadProviderConnectionSecret(b.provider.id)))?.apiKey).toBe(`fixture-${bob.id}`);
});
test("worker derives new-user scope from persisted runs, isolating runs, claims and memory", async () => {
  const input = { question: "Offline membership integration question about scoped claims", idempotencyKey: randomUUID(), scenario: "success" as const, providerMode: "fake" as const, reviewRounds: 0 as const, memoryEntryIds: [] };
  const results = await Promise.all([alice, bob].map(user => withOwner(user.ownerId, () => enqueueDurableRun(input))));
  const a = results[0]!, b = results[1]!;
  expect(a.runId).not.toBe(b.runId);
  await expect(withOwner(bob.ownerId, () => cancelDurableRun(a.runId))).resolves.toBeUndefined();
  expect(await withOwner(bob.ownerId, () => findDurableRunById(a.runId))).toBeUndefined();
  const finished = await withWorkerOwner("run", a.runId, async () => { expect(getOwnerId()).toBe(alice.ownerId); return executeDurableRun(a.runId); });
  expect(finished?.status).toBe("completed");
  expect(await withWorkerOwner("run", randomUUID(), async () => { throw new Error("missing must not execute"); })).toBeUndefined();
  const [stored] = await getDatabase().select().from(runs).where(eq(runs.id, a.runId)); expect(stored?.ownerId).toBe(alice.ownerId);
  const claim = finished?.report?.sharedClaims[0] ?? finished?.report?.distinctClaims[0]; expect(claim).toBeDefined();
  if (claim) {
    expect(await withOwner(bob.ownerId, () => saveMemoryEntry({ runId: a.runId, claimId: claim.claimId }))).toBeUndefined();
    expect(await withOwner(alice.ownerId, () => saveMemoryEntry({ runId: a.runId, claimId: claim.claimId }))).toBeDefined();
    expect(await withOwner(bob.ownerId, () => listMemoryEntries())).toEqual([]);
  }
  expect((await withOwner(alice.ownerId, () => listDurableRuns()))?.runs.map(r => r.runId)).toEqual([a.runId]);
});
test("knowledge grants and schedule dispatch remain bound to their individual owners", async () => {
  const collection = await withOwner(alice.ownerId, () => createKnowledgeCollection("Alice sources"));
  await withOwner(bob.ownerId, async () => {
    expect(await exportKnowledgeCollection(collection.id)).toBeUndefined();
    await expect(changeKnowledgeGrant(collection.id, collection.grantRevision, "active")).rejects.toThrow();
    expect((await listKnowledgeCollections()).items).toEqual([]);
  });
  const active = await withOwner(alice.ownerId, () => changeKnowledgeGrant(collection.id, collection.grantRevision, "active"));
  const scope = { ownerId: alice.ownerId, accountId: "local" as const, collectionId: collection.id, grantId: collection.grantId, grantRevision: active.grantRevision };
  expect(await withOwner(alice.ownerId, () => authorizeKnowledgeScope(scope))).toBe(true);
  expect(await withOwner(bob.ownerId, () => authorizeKnowledgeScope(scope))).toBe(false);
  const schedules = await Promise.all([alice, bob].map(user => withOwner(user.ownerId, async () => {
    const schedule = await createLocalSchedule({ name: "Each owner's schedule", question: "An offline schedule question for membership verification", members: defaultFakeCouncilMembers,
      providerMode: "fake", riskProfile: "standard", reviewRounds: 0, cadence: "daily", nextRunAt: new Date(Date.now() - 1000).toISOString() });
    await updateLocalSchedule(schedule.id, { status: "active" }); return schedule;
  })));
  expect(await withOwner(bob.ownerId, () => updateLocalSchedule(schedules[0]!.id, { status: "paused" }))).toBeUndefined();
  const result = await dispatchAllUserSchedules(); expect(result).toEqual({ dispatched: 2, failed: 0 });
  for (const user of [alice, bob]) await withOwner(user.ownerId, async () => {
    const [schedule] = await listLocalSchedules(); expect(schedule?.lastRunId).toBeTruthy();
    const [stored] = await getDatabase().select().from(runs).where(eq(runs.id, schedule!.lastRunId!)); expect(stored?.ownerId).toBe(user.ownerId);
    await updateLocalSchedule(schedule!.id, { status: "paused" });
  });
  expect((await readHostQuiescence()).activeRuns).toBeGreaterThan(0); // host sees users outside legacy root
});
test("restore audit checks credential formats and rejects corrupted user session scopes", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    expect(await auditRestoredAccounts(client)).toMatchObject({ users: 3, roots: 1 });
    await client.query("BEGIN");
    const tokenHash = randomBytes(32).toString("hex");
    await client.query("INSERT INTO local_sessions(token_hash,user_id,scope_user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [tokenHash, alice.id, bob.id]);
    await expect(auditRestoredAccounts(client)).rejects.toThrow("scope invalid");
    await client.query("ROLLBACK");
    expect(await auditRestoredAccounts(client)).toMatchObject({ users: 3, roots: 1 });
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
