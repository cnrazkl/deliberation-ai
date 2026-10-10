import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { type ConnectionCheckExecution } from "@deliberation-ai/application";
import { MAX_GENERATION_CHECKS } from "@deliberation-ai/contracts";
import { getPool, closeDatabase } from "./database";
import { acknowledgeConnectionGenerationCheck, ConnectionCheckConflictError, reviewConnectionGenerationCheck, runConnectionGenerationCheck, runConnectionChatCheck } from "./connection-generation-check";
import { deleteProviderConnection, saveProviderConnection, saveProviderConnectionCatalogCheck, loadProviderConnectionSecret } from "./provider-connections";
const settings = { provider: "openai-compatible" as const, apiKey: "", defaultModel: "local-check", baseUrl: "http://127.0.0.1:11434/v1",
  endpointPreset: "ollama" as const, reasoningProtocol: "none" as const, structuredOutputMode: "json-object" as const };
const success: ConnectionCheckExecution = { status: "succeeded", failure: null, returnedModel: "local-check", remoteResponseId: "fixture",
  inputTokens: 10, outputTokens: 20, httpStatus: null };
const failed: ConnectionCheckExecution = { ...success, status: "failed", failure: "rejected" };

test("chat review binds message and revision, encrypts replies and durably replays without resending", async () => {
  const initial = await saveProviderConnection({ ...settings, label: `Chat fixture ${randomUUID()}` });
  const message = "PRIVATE CHAT QUESTION", reply = "PRIVATE CHAT REPLY";
  try {
    const preview = (await reviewConnectionGenerationCheck(initial.id, "local-check", message))!;
    const request = { action: "send", requestId: randomUUID(), model: preview.model, message, fingerprint: preview.fingerprint, acknowledge: true };
    const execute = vi.fn(async () => ({ ...success, reply, replyTruncated: false }));
    const check = (await runConnectionChatCheck(initial.id, request, execute))!;
    expect(check).toMatchObject({ kind: "chat", message, reply, status: "succeeded" });
    expect(await runConnectionChatCheck(initial.id, request, execute)).toEqual(check); expect(execute).toHaveBeenCalledTimes(1);
    await expect(runConnectionChatCheck(initial.id, { ...request, message: "Changed" }, execute)).rejects.toBeInstanceOf(ConnectionCheckConflictError);
    await expect(runConnectionGenerationCheck(initial.id, { requestId: request.requestId, model: request.model, fingerprint: request.fingerprint, acknowledge: true }, execute)).rejects.toBeInstanceOf(ConnectionCheckConflictError);
    const row = (await getPool().query<{ catalog_snapshot_ciphertext: string }>("SELECT catalog_snapshot_ciphertext FROM provider_connections WHERE id=$1", [initial.id])).rows[0]!;
    expect(row.catalog_snapshot_ciphertext).not.toContain(message); expect(row.catalog_snapshot_ciphertext).not.toContain(reply);
    expect((await reviewConnectionGenerationCheck(initial.id))!.observations.generationChecks[0]?.reply).toBe(reply);
    await saveProviderConnection({ ...settings, id: initial.id, label: initial.label, apiKey: "replacement" });
    await expect(runConnectionChatCheck(initial.id, { ...request, requestId: randomUUID() }, execute)).rejects.toBeInstanceOf(ConnectionCheckConflictError);
    expect(execute).toHaveBeenCalledTimes(1);
  } finally { await deleteProviderConnection(initial.id); await closeDatabase(); }
});

test("fences concurrent/lost-response submissions and preserves historical results across edits/catalog writes", async () => {
  const initial = await saveProviderConnection({ ...settings, label: `Generation fixture ${randomUUID()}` });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const execute = vi.fn(async () => { await gate; return success; });
  try {
    const preview = (await reviewConnectionGenerationCheck(initial.id))!;
    expect(JSON.stringify(preview)).not.toContain("apiKey");
    const request = { requestId: randomUUID(), model: preview.model, fingerprint: preview.fingerprint, acknowledge: true };
    const first = runConnectionGenerationCheck(initial.id.toUpperCase(), { ...request, requestId: request.requestId.toUpperCase() }, execute);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect((await runConnectionGenerationCheck(initial.id, request, execute))?.status).toBe("submitted");
    await expect(deleteProviderConnection(initial.id)).rejects.toThrow("doğrulanmamış");
    await expect(runConnectionGenerationCheck(initial.id, { ...request, requestId: randomUUID(), acknowledgeUnknown: true }, execute)).rejects.toBeInstanceOf(ConnectionCheckConflictError);
    const updated = await saveProviderConnection({ ...settings, id: initial.id, label: initial.label, defaultModel: "local-other" });
    await saveProviderConnectionCatalogCheck(initial.id.toUpperCase(), updated.revision, { status: "available", verification: "catalog_only", models: ["local-other"], truncated: false });
    release();
    expect((await first)?.status).toBe("succeeded");
    expect((await runConnectionGenerationCheck(initial.id, request, execute))?.revision).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(runConnectionGenerationCheck(initial.id, { ...request, model: "different" }, execute)).rejects.toBeInstanceOf(ConnectionCheckConflictError);
    await expect(runConnectionGenerationCheck(initial.id, { ...request, requestId: randomUUID() }, execute)).rejects.toBeInstanceOf(ConnectionCheckConflictError);
    const reviewed = (await reviewConnectionGenerationCheck(initial.id))!;
    expect(reviewed.observations.latestCatalog?.models).toEqual(["local-other"]);
    expect(reviewed.observations.generationChecks[0]?.status).toBe("succeeded");
    const encrypted = (await getPool().query("SELECT catalog_snapshot_ciphertext FROM provider_connections WHERE id=$1", [initial.id])).rows[0].catalog_snapshot_ciphertext as string;
    expect(encrypted).toMatch(/^v1:/u); expect(encrypted).not.toContain("local-check");
    // Another owner's record never appears in review or submission.
    await getPool().query("UPDATE provider_connections SET owner_id='foreign-fixture' WHERE id=$1", [initial.id]);
    expect(await reviewConnectionGenerationCheck(initial.id)).toBeUndefined();
    expect(await runConnectionGenerationCheck(initial.id, request, execute)).toBeUndefined();
    await getPool().query("UPDATE provider_connections SET owner_id='local-owner' WHERE id=$1", [initial.id]);
  } finally { release(); await getPool().query("UPDATE provider_connections SET owner_id=$2 WHERE id=$1", [initial.id, (await import("./owner")).LOCAL_OWNER_ID]); await deleteProviderConnection(initial.id); await closeDatabase(); }
});

test("keeps unknown outcomes blocked until separately acknowledged without another API call", async () => {
  const initial = await saveProviderConnection({ ...settings, label: `Unknown fixture ${randomUUID()}` });
  const execute = vi.fn(async (): Promise<ConnectionCheckExecution> => { throw new Error("SENSITIVE PROVIDER MESSAGE"); });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const preview = (await reviewConnectionGenerationCheck(initial.id))!;
    const request = { requestId: randomUUID(), model: preview.model, fingerprint: preview.fingerprint, acknowledge: true };
    const result = (await runConnectionGenerationCheck(initial.id, request, execute))!;
    expect(result.status).toBe("outcome_unknown"); expect(JSON.stringify(result)).not.toContain("SENSITIVE");
    expect((await runConnectionGenerationCheck(initial.id, request, execute))?.status).toBe("outcome_unknown");
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(acknowledgeConnectionGenerationCheck(initial.id, { id: result.id, fingerprint: result.fingerprint, acknowledgeUnknown: true })).rejects.toBeInstanceOf(ConnectionCheckConflictError);
    vi.setSystemTime(Date.now() + 55_000);
    await expect(runConnectionGenerationCheck(initial.id, { ...request, requestId: randomUUID() }, execute)).rejects.toBeInstanceOf(ConnectionCheckConflictError);
    const acknowledged = (await acknowledgeConnectionGenerationCheck(initial.id, { id: result.id, fingerprint: result.fingerprint, acknowledgeUnknown: true }))!;
    expect(acknowledged.status).toBe("outcome_unknown"); expect(acknowledged.acknowledgedAt).not.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await runConnectionGenerationCheck(initial.id, { ...request, requestId: randomUUID() }, async () => failed))?.status).toBe("failed");
  } finally { vi.useRealTimers(); await deleteProviderConnection(initial.id); await closeDatabase(); }
});

test("never evicts generation identities at capacity and bounds catalog history explicitly", async () => {
  const initial = await saveProviderConnection({ ...settings, label: `Capacity fixture ${randomUUID()}` });
  try {
    const preview = (await reviewConnectionGenerationCheck(initial.id))!;
    const firstId = randomUUID();
    const request = { requestId: firstId, model: preview.model, fingerprint: preview.fingerprint, acknowledge: true };
    const execute = vi.fn(async () => ({ ...failed, outputTokens: 700 }));
    for (let index = 0; index < MAX_GENERATION_CHECKS; index++) await runConnectionGenerationCheck(initial.id, { ...request, requestId: index ? randomUUID() : firstId }, execute);
    await expect(runConnectionGenerationCheck(initial.id, { ...request, requestId: randomUUID() }, execute)).rejects.toBeInstanceOf(ConnectionCheckConflictError);
    expect((await runConnectionGenerationCheck(initial.id, request, execute))?.status).toBe("failed");
    expect(execute).toHaveBeenCalledTimes(MAX_GENERATION_CHECKS);
    for (let index = 0; index < 12; index++) await saveProviderConnectionCatalogCheck(initial.id, (await loadProviderConnectionSecret(initial.id))!.revision,
      { status: "available", verification: "catalog_only", models: [`model-${index}`], truncated: false });
    const observations = (await reviewConnectionGenerationCheck(initial.id))!.observations;
    expect(observations.catalogHistory).toHaveLength(10); expect(observations.catalogDropped).toBe(2);
    expect(observations.generationChecks[0]?.id).toBe(firstId);
    expect(observations.generationChecks[0]?.outputCapExceeded).toBe(true);
  } finally { await deleteProviderConnection(initial.id); await closeDatabase(); }
});
