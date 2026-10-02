import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { closeDatabase, getPool } from "./database";
import {
  deleteProviderConnection,
  listProviderConnections,
  loadProviderConnectionSecret,
  saveProviderConnection,
  saveProviderConnectionCatalogCheck,
} from "./provider-connections";

test("keeps a catalog check encrypted and rejects a result from an edited connection revision", async () => {
  const initial = await saveProviderConnection({
    provider: "openai-compatible",
    label: `Fixture catalog ${randomUUID()}`,
    apiKey: "",
    defaultModel: "local-model-a",
    baseUrl: "http://127.0.0.1:11434/v1",
    endpointPreset: "ollama",
    reasoningProtocol: "none",
    structuredOutputMode: "json-object",
  });
  try {
    const loaded = await loadProviderConnectionSecret(initial.id);
    expect(loaded?.revision).toBe(1);
    const check = await saveProviderConnectionCatalogCheck(initial.id, loaded!.revision, {
      status: "available", verification: "catalog_only", models: ["local-model-a"], truncated: false,
    });
    expect(check?.checkedAt).toMatch(/^\d{4}-/);
    const [listed] = (await listProviderConnections()).filter((connection) => connection.id === initial.id);
    expect(listed?.catalogCheck).toEqual(check);
    const stored = await getPool().query<{ catalog_snapshot_ciphertext: string }>(
      "SELECT catalog_snapshot_ciphertext FROM provider_connections WHERE id = $1::uuid",
      [initial.id],
    );
    expect(stored.rows[0]?.catalog_snapshot_ciphertext).toMatch(/^v1:/);
    expect(stored.rows[0]?.catalog_snapshot_ciphertext).not.toContain("local-model-a");

    const edited = await saveProviderConnection({
      id: initial.id,
      provider: "openai-compatible",
      label: initial.label,
      apiKey: "",
      defaultModel: "local-model-b",
      baseUrl: "http://127.0.0.1:11434/v1",
      endpointPreset: "ollama",
      reasoningProtocol: "none",
      structuredOutputMode: "json-object",
    });
    expect(edited.catalogCheck).toBeUndefined();
    expect((await loadProviderConnectionSecret(initial.id))?.revision).toBe(2);
    expect(await saveProviderConnectionCatalogCheck(initial.id, loaded!.revision, {
      status: "available", verification: "catalog_only", models: ["stale-model"], truncated: false,
    })).toBeUndefined();
    expect((await listProviderConnections()).find((connection) => connection.id === initial.id)?.catalogCheck).toBeUndefined();
  } finally {
    await deleteProviderConnection(initial.id);
    await closeDatabase();
  }
});
