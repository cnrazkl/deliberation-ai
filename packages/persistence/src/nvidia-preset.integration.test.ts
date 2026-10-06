import { randomUUID } from "node:crypto";
import { afterAll, expect, test, vi } from "vitest";
import { NVIDIA_HOSTED_BASE_URL, defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { executeWorkerCouncil } from "../../../apps/worker/src/provider-runtime";
import { saveProviderConnection, deleteProviderConnection, loadProviderConnectionSecret, saveProviderConnectionCatalogCheck } from "./provider-connections";
import { enqueueDurableRun, executeDurableRun, PreflightMismatchError } from "./run-repository";
import { getPool, closeDatabase } from "./database";
import { closeBoss, getBoss, RUN_COUNCIL_QUEUE } from "./queue";
import { decryptJson } from "./crypto";

const settings = { provider: "openai-compatible" as const, endpointPreset: "nvidia" as const,
  label: `NVIDIA fixture ${randomUUID()}`, apiKey: "offline-nvidia-fixture", defaultModel: "vendor/manual-model",
  baseUrl: NVIDIA_HOSTED_BASE_URL, reasoningProtocol: "none" as const, structuredOutputMode: "prompt-only" as const };
afterAll(async () => { await closeBoss(); await closeDatabase(); });

test("NVIDIA secrets are encrypted, service switches require a fresh key, and stale catalogs cannot overwrite edits", async () => {
  const connection = await saveProviderConnection(settings);
  try {
    const stored = await getPool().query("SELECT secret_ciphertext FROM provider_connections WHERE id=$1", [connection.id]);
    expect(stored.rows[0].secret_ciphertext).toMatch(/^v1:/);
    expect(stored.rows[0].secret_ciphertext).not.toContain(settings.apiKey);
    const edited = await saveProviderConnection({ ...settings, id: connection.id, apiKey: "", defaultModel: "vendor/other-model" });
    expect(edited).toMatchObject({ endpointPreset: "nvidia", defaultModel: "vendor/other-model" });
    expect(await loadProviderConnectionSecret(connection.id)).toMatchObject({ revision: 2, apiKey: settings.apiKey });
    expect(await saveProviderConnectionCatalogCheck(connection.id, 1, { status: "available", verification: "catalog_only", models: ["stale-model"], truncated: false })).toBeUndefined();
    await expect(saveProviderConnection({ ...settings, id: connection.id, endpointPreset: "custom", baseUrl: "https://example.test/v1", apiKey: "" })).rejects.toThrow(/API anahtarı/);
    await saveProviderConnection({ ...settings, id: connection.id, endpointPreset: "custom", baseUrl: "https://example.test/v1", apiKey: "offline-custom-key" });
    await expect(saveProviderConnection({ ...settings, id: connection.id, apiKey: "" })).rejects.toThrow(/API anahtarı/);
  } finally { await deleteProviderConnection(connection.id); }
});

test("queued NVIDIA revision is frozen; editing it rejects execution before any network or provider receipt", async () => {
  const connection = await saveProviderConnection({ ...settings, label: `NVIDIA queued fixture ${randomUUID()}` });
  let runId: string | undefined;
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline test must not dispatch"));
  try {
    const members = defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible" as const, connectionId: connection.id, model: settings.defaultModel }));
    const input = { question: "NVIDIA kuyruk bağlantı revizyonu için yeterince uzun test sorusu", idempotencyKey: randomUUID(),
      providerMode: "remote" as const, scenario: "success" as const, reviewRounds: 0 as const, memoryEntryIds: [], members };
    await expect(enqueueDurableRun({ ...input, members: members.map((member) => ({ ...member, nvidiaConnectionRevision: 9 })) })).rejects.toBeInstanceOf(PreflightMismatchError);
    const run = await enqueueDurableRun(input); runId = run.runId;
    const stored = await getPool().query("SELECT members_ciphertext FROM runs WHERE id=$1", [runId]);
    expect(decryptJson(stored.rows[0].members_ciphertext, `run:${runId}:members`)).toEqual(members.map((member) => ({ ...member, nvidiaConnectionRevision: 1 })));
    await saveProviderConnection({ ...settings, id: connection.id, label: connection.label, apiKey: "", defaultModel: "vendor/edited-model" });
    const completed = await executeDurableRun(runId, executeWorkerCouncil);
    expect(completed?.status).toBe("failed");
    expect(network).not.toHaveBeenCalled();
    const receipts = await getPool().query("SELECT id FROM provider_operations WHERE run_id=$1", [runId]);
    expect(receipts.rows).toHaveLength(0);
  } finally {
    network.mockRestore();
    if (runId) {
      const jobs = await getPool().query<{ id: string }>("SELECT id FROM pgboss.job WHERE name=$1 AND data->>'runId'=$2", [RUN_COUNCIL_QUEUE, runId]);
      if (jobs.rows.length) await (await getBoss()).cancel(RUN_COUNCIL_QUEUE, jobs.rows.map((job) => job.id));
      await getPool().query("DELETE FROM runs WHERE id=$1", [runId]);
    }
    await deleteProviderConnection(connection.id);
  }
});
