import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { getDatabase, closeDatabase } from "./database";
import { withOwner } from "./owner";
import { providerConnections } from "./schema";
import { saveProviderConnection, listProviderConnections, saveProviderConnectionCatalogCheck, deleteProviderConnection, ProviderConnectionRevisionConflictError } from "./provider-connections";

const settings = { provider: "openai-compatible" as const, label: "Model selections", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1",
  endpointPreset: "ollama" as const, reasoningProtocol: "none" as const, structuredOutputMode: "json-object" as const };
test("saved model preferences are owned, survive catalog writes, preserve execution revisions and reject stale settings", async () => {
  const owner = `models-${randomUUID()}`;
  await withOwner(owner, async () => {
    const empty = await saveProviderConnection({ ...settings, label: "No model yet" });
    const legacy = await saveProviderConnection({ ...settings, label: "Legacy model", defaultModel: "legacy-model" });
    const saved = await saveProviderConnection({ ...settings, selectedModels: ["model-a", "model-b"] });
    try {
      expect(empty.selectedModels).toEqual([]); expect(empty.defaultModel).toBe("");
      expect(legacy.selectedModels).toEqual(["legacy-model"]);
      const [before] = await getDatabase().select().from(providerConnections).where(eq(providerConnections.id, saved.id));
      const catalog = await saveProviderConnectionCatalogCheck(saved.id, saved.revision, {
        status: "available", verification: "catalog_only", models: ["model-a", "model-b"], truncated: false,
      });
      const preferences = await saveProviderConnection({ ...settings, id: saved.id, selectedModels: ["model-b"], expectedRevision: saved.revision });
      expect(preferences.selectedModels).toEqual(["model-b"]); expect(preferences.revision).toBe(saved.revision);
      expect(preferences.catalogCheck).toEqual(catalog);
      await saveProviderConnectionCatalogCheck(saved.id, saved.revision, { status: "unavailable", verification: "none", models: [], truncated: false });
      expect((await listProviderConnections()).find(item => item.id === saved.id)?.selectedModels).toEqual(["model-b"]);
      const edited = await saveProviderConnection({ ...settings, id: saved.id, baseUrl: "http://127.0.0.1:11435/v1", selectedModels: ["model-b"], expectedRevision: saved.revision });
      expect(edited.revision).toBe(saved.revision + 1); expect(edited.catalogCheck).toBeUndefined();
      await expect(saveProviderConnection({ ...settings, id: saved.id, selectedModels: ["stale-model"], expectedRevision: saved.revision })).rejects.toBeInstanceOf(ProviderConnectionRevisionConflictError);
      await withOwner(`foreign-${randomUUID()}`, async () => {
        expect((await listProviderConnections()).some(item => item.id === saved.id)).toBe(false);
        await expect(saveProviderConnection({ ...settings, id: saved.id, selectedModels: ["foreign-model"] })).rejects.toThrow("not found");
      });
      const [after] = await getDatabase().select().from(providerConnections).where(eq(providerConnections.id, saved.id));
      expect(after!.secretCiphertext).toBe(before!.secretCiphertext); expect(after!.selectedModels).toEqual(["model-b"]);
      const cleared = await saveProviderConnection({ ...settings, id: saved.id, baseUrl: edited.baseUrl, selectedModels: [], expectedRevision: edited.revision });
      expect(cleared.selectedModels).toEqual([]); expect(cleared.defaultModel).toBe("");
    } finally { for (const item of [saved, empty, legacy]) await deleteProviderConnection(item.id); }
  });
  await closeDatabase();
});
