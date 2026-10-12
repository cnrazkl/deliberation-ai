import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { getDatabase, closeDatabase } from "./database";
import { withOwner } from "./owner";
import { encryptJson } from "./crypto";
import { providerConnections, councilTemplates, runs, providerOperations } from "./schema";
import { saveProviderConnection, previewProviderConnectionDeletion, deleteProviderConnection } from "./provider-connections";
import { saveCouncilTemplate } from "./council-templates";
import { assertSelectedProviderMembers, ProviderConnectionImpactError, ProviderMemberUnavailableError } from "./provider-connection-impact";
const settings = { provider: "openai-compatible" as const, label: "Impact fixture", apiKey: "", baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "ollama" as const, reasoningProtocol: "none" as const, structuredOutputMode: "json-object" as const, selectedModels: ["model-a", "model-b"] };
async function fixture(work: (connection: Awaited<ReturnType<typeof saveProviderConnection>>, members: typeof defaultFakeCouncilMembers) => Promise<void>) {
  const owner = `impact-${randomUUID()}`;
  await withOwner(owner, async () => {
    const connection = await saveProviderConnection(settings);
    const members = defaultFakeCouncilMembers.map(member => ({ ...member, provider: "openai-compatible" as const, model: "model-a", connectionId: connection.id }));
    try { await work(connection, members); }
    finally {
      await getDatabase().delete(runs).where(eq(runs.ownerId, owner));
      await getDatabase().delete(councilTemplates).where(eq(councilTemplates.ownerId, owner));
      await getDatabase().delete(providerConnections).where(eq(providerConnections.ownerId, owner));
    }
  });
}
afterAll(closeDatabase);
test("model removal reviews saved templates and historical runs, preserves frozen records and blocks new use", async () => fixture(async (connection, members) => {
  const template = await saveCouncilTemplate({ requestId: randomUUID(), name: "Saved impact council", description: "", members: members.map(member => ({ ...member, connectionId: member.connectionId!.toUpperCase() })) });
  const runId = randomUUID(); await getDatabase().insert(runs).values({ id: runId, ownerId: (await import("./owner")).getOwnerId(), idempotencyKey: randomUUID(), requestHash: "fixture", question: "[encrypted]", snapshotId: randomUUID(), status: "completed", membersCiphertext: encryptJson(members, `run:${runId}:members`) });
  const request = { ...settings, id: connection.id, selectedModels: ["model-b"] };
  let impact!: ProviderConnectionImpactError;
  try { await saveProviderConnection(request); } catch (error) { expect(error).toBeInstanceOf(ProviderConnectionImpactError); impact = error as ProviderConnectionImpactError; }
  expect(impact.impact.references.map(reference => reference.kind)).toEqual(expect.arrayContaining(["Konsey Şablonu", "Müzakere Çalışması"])); expect(impact.impact.eligible).toBe(true);
  const saved = await saveProviderConnection({ ...request, impactFingerprint: impact.impact.fingerprint }); expect(saved.selectedModels).toEqual(["model-b"]);
  await expect(getDatabase().transaction(tx => assertSelectedProviderMembers(tx, members))).rejects.toBeInstanceOf(ProviderMemberUnavailableError);
  await expect(saveCouncilTemplate({ id: template.id, name: template.name, description: "", members })).rejects.toBeInstanceOf(ProviderMemberUnavailableError);
  const [retained] = await getDatabase().select().from(runs).where(eq(runs.id, runId)); expect(retained!.membersCiphertext).toBeDefined();
  await withOwner(`foreign-${randomUUID()}`, async () => expect(await previewProviderConnectionDeletion(connection.id)).toBeUndefined());
}));
test("active and unresolved operations block changes; a changed dependency invalidates prior confirmation", async () => fixture(async (connection, members) => {
  const runId = randomUUID(); await getDatabase().insert(runs).values({ id: runId, ownerId: (await import("./owner")).getOwnerId(), idempotencyKey: randomUUID(), requestHash: "fixture", question: "[encrypted]", snapshotId: randomUUID(), status: "running", membersCiphertext: encryptJson(members, `run:${runId}:members`) });
  const request = { ...settings, id: connection.id, apiKey: "synthetic replacement" };
  await expect(saveProviderConnection(request)).rejects.toMatchObject({ impact: { eligible: false } });
  await getDatabase().update(runs).set({ status: "failed" }).where(eq(runs.id, runId));
  const operationId = randomUUID(); await getDatabase().insert(providerOperations).values({ id: operationId, runId, memberId: members[0]!.id, provider: "openai-compatible", model: "model-a", status: "outcome_unknown", requestFingerprint: "fixture" });
  expect((await previewProviderConnectionDeletion(connection.id))!.eligible).toBe(false);
  await getDatabase().update(providerOperations).set({ status: "discarded" }).where(eq(providerOperations.id, operationId));
  const preview = (await previewProviderConnectionDeletion(connection.id))!; expect(preview.eligible).toBe(true);
  await saveCouncilTemplate({ requestId: randomUUID(), name: "New dependency", description: "", members });
  await expect(deleteProviderConnection(connection.id, preview.fingerprint)).rejects.toBeInstanceOf(ProviderConnectionImpactError);
  const fresh = (await previewProviderConnectionDeletion(connection.id))!;
  expect(await deleteProviderConnection(connection.id, fresh.fingerprint)).toBe(true);
}));
test("queued binding creation and model removal serialize without losing active dependencies", async () => fixture(async (connection, members) => {
  let release!: () => void, locked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { locked = resolve; });
  const runId = randomUUID();
  const create = getDatabase().transaction(async tx => {
    await assertSelectedProviderMembers(tx, members); locked(); await gate;
    await tx.insert(runs).values({ id: runId, ownerId: (await import("./owner")).getOwnerId(), idempotencyKey: randomUUID(), requestHash: "fixture", question: "[encrypted]", snapshotId: randomUUID(), status: "queued", membersCiphertext: encryptJson(members, `run:${runId}:members`) });
  });
  await acquired; let done = false;
  const removal = saveProviderConnection({ ...settings, id: connection.id, selectedModels: ["model-b"] }).then(() => { done = true; }, error => { done = true; return error as unknown; });
  try { await new Promise(resolve => setTimeout(resolve, 100)); expect(done).toBe(false); }
  finally { release(); }
  await create; expect(await removal).toBeInstanceOf(ProviderConnectionImpactError);
}));
test("a consumed retry grant does not block connection changes after its later attempt closes", async () => fixture(async (connection, members) => {
  const runId = randomUUID(), operation = randomUUID();
  await getDatabase().insert(runs).values({ id: runId, ownerId: (await import("./owner")).getOwnerId(), idempotencyKey: randomUUID(), requestHash: "fixture", snapshotId: randomUUID(), question: "[encrypted]", status: "failed", membersCiphertext: encryptJson(members, `run:${runId}:members`) });
  await getDatabase().insert(providerOperations).values([
    { id: operation, runId, memberId: members[0]!.id, provider: "openai-compatible", model: "model-a", status: "retry_authorized", attempt: 1, requestFingerprint: "fixture" },
    { id: randomUUID(), runId, memberId: members[0]!.id, provider: "openai-compatible", model: "model-a", status: "discarded", attempt: 2, requestFingerprint: "fixture" },
  ]);
  const impact = (await previewProviderConnectionDeletion(connection.id))!;
  expect(impact.eligible).toBe(true); expect(impact.references.some(item => item.kind === "Sağlayıcı İşlemi")).toBe(false);
  await getDatabase().update(providerOperations).set({ status: "outcome_unknown" }).where(eq(providerOperations.id, operation));
  expect((await previewProviderConnectionDeletion(connection.id))!.eligible).toBe(false);
}));
