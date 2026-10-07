import { randomUUID } from "node:crypto";
import type {
  ModelCatalogCheck,
  RemoteProvider,
  SaveProviderConnectionRequest,
} from "@deliberation-ai/contracts";
import { MAX_CATALOG_HISTORY, modelCatalogCheckSchema, saveProviderConnectionSchema } from "@deliberation-ai/contracts";
import { and, eq } from "drizzle-orm";
import { encryptText, decryptText } from "./crypto";
import { readProviderObservations, encryptProviderObservations } from "./provider-observations";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { providerConnections } from "./schema";

export type ProviderConnectionSummary = {
  id: string;
  provider: RemoteProvider;
  label: string;
  defaultModel: string;
  baseUrl?: string;
  endpointPreset: SaveProviderConnectionRequest["endpointPreset"];
  reasoningProtocol: SaveProviderConnectionRequest["reasoningProtocol"];
  structuredOutputMode: SaveProviderConnectionRequest["structuredOutputMode"];
  configured: true;
  updatedAt: string;
  revision: number;
  catalogCheck?: ModelCatalogCheck;
};

export class ProviderConnectionSecretRequiredError extends Error {
  constructor() {
    super("Yeni bulut bağlantısı veya sağlayıcı değişikliği için API anahtarı gerekli.");
    this.name = "ProviderConnectionSecretRequiredError";
  }
}

function summary(row: typeof providerConnections.$inferSelect): ProviderConnectionSummary {
  const catalogCheck = readProviderObservations(row).latestCatalog;
  return {
    id: row.id,
    provider: row.provider as RemoteProvider,
    label: row.label,
    defaultModel: row.defaultModel,
    ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
    endpointPreset: row.endpointPreset as SaveProviderConnectionRequest["endpointPreset"],
    reasoningProtocol: row.reasoningProtocol as SaveProviderConnectionRequest["reasoningProtocol"],
    structuredOutputMode:
      row.structuredOutputMode as SaveProviderConnectionRequest["structuredOutputMode"],
    configured: true,
    updatedAt: row.updatedAt.toISOString(),
    revision: row.revision,
    ...(catalogCheck ? { catalogCheck } : {}),
  };
}

export async function saveProviderConnection(
  request: SaveProviderConnectionRequest,
): Promise<ProviderConnectionSummary> {
  request = saveProviderConnectionSchema.parse(request);
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [existing] = request.id
      ? await tx
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.ownerId, LOCAL_OWNER_ID),
              eq(providerConnections.id, request.id),
            ),
          )
          .for("update").limit(1)
      : await tx
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.ownerId, LOCAL_OWNER_ID),
              eq(providerConnections.label, request.label),
            ),
          )
          .for("update").limit(1);
    const id = existing?.id ?? randomUUID();
    const localPreset = ["ollama", "vllm", "litellm"].includes(request.endpointPreset);
    if ((!existing && !localPreset && !request.apiKey) ||
        (existing && (existing.provider !== request.provider || existing.endpointPreset !== request.endpointPreset
          && (existing.endpointPreset === "nvidia" || request.endpointPreset === "nvidia")) && !request.apiKey)) {
      throw new ProviderConnectionSecretRequiredError();
    }
    const values = {
      ownerId: LOCAL_OWNER_ID,
      provider: request.provider,
      label: request.label,
      defaultModel: request.defaultModel,
      baseUrl: request.baseUrl ?? null,
      endpointPreset: request.endpointPreset,
      reasoningProtocol: request.reasoningProtocol,
      structuredOutputMode: request.structuredOutputMode,
      secretCiphertext: request.apiKey
        ? encryptText(request.apiKey, `provider-connection:${id}:secret`)
        : existing?.secretCiphertext ?? encryptText("", `provider-connection:${id}:secret`),
      catalogSnapshotCiphertext: existing ? encryptProviderObservations(id, { ...readProviderObservations(existing), latestCatalog: null }) : null,
      revision: (existing?.revision ?? 0) + 1,
      keyVersion: Number(process.env.KEY_VERSION ?? "1"),
      updatedAt: new Date(),
    };
    const [saved] = existing
      ? await tx
          .update(providerConnections)
          .set(values)
          .where(eq(providerConnections.id, id))
          .returning()
      : await tx.insert(providerConnections).values({ id, ...values }).returning();
    if (!saved) throw new Error("Provider connection could not be saved.");
    return summary(saved);
  });
}

export async function listProviderConnections(): Promise<ProviderConnectionSummary[]> {
  const rows = await getDatabase()
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.ownerId, LOCAL_OWNER_ID));
  return rows.map(summary);
}

export async function loadProviderConnectionSecret(
  connectionId: string,
): Promise<
  | (Omit<ProviderConnectionSummary, "configured" | "updatedAt" | "catalogCheck"> & { apiKey: string; revision: number })
  | undefined
> {
  const [row] = await getDatabase()
    .select()
    .from(providerConnections)
    .where(
      and(eq(providerConnections.ownerId, LOCAL_OWNER_ID), eq(providerConnections.id, connectionId)),
    )
    .limit(1);
  if (!row) return undefined;
  return {
    id: row.id,
    provider: row.provider as RemoteProvider,
    label: row.label,
    apiKey: decryptText(row.secretCiphertext, `provider-connection:${row.id}:secret`),
    revision: row.revision,
    defaultModel: row.defaultModel,
    ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
    endpointPreset: row.endpointPreset as SaveProviderConnectionRequest["endpointPreset"],
    reasoningProtocol: row.reasoningProtocol as SaveProviderConnectionRequest["reasoningProtocol"],
    structuredOutputMode:
      row.structuredOutputMode as SaveProviderConnectionRequest["structuredOutputMode"],
  };
}

export async function saveProviderConnectionCatalogCheck(
  connectionId: string,
  expectedRevision: number,
  check: ModelCatalogCheck,
): Promise<ModelCatalogCheck | undefined> {
  const snapshot = modelCatalogCheckSchema.parse({ ...check, checkedAt: new Date().toISOString() });
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx.select().from(providerConnections).where(and(
      eq(providerConnections.ownerId, LOCAL_OWNER_ID), eq(providerConnections.id, connectionId),
      eq(providerConnections.revision, expectedRevision),
    )).for("update").limit(1);
    if (!row) return undefined;
    const observations = readProviderObservations(row);
    const history = [...observations.catalogHistory, { revision: row.revision, provider: row.provider as RemoteProvider,
      endpointPreset: row.endpointPreset as SaveProviderConnectionRequest["endpointPreset"], check: snapshot }];
    await tx.update(providerConnections).set({ catalogSnapshotCiphertext: encryptProviderObservations(row.id, {
      ...observations, latestCatalog: snapshot, catalogHistory: history.slice(-MAX_CATALOG_HISTORY),
      catalogDropped: observations.catalogDropped + Math.max(0, history.length - MAX_CATALOG_HISTORY),
    }) }).where(eq(providerConnections.id, connectionId));
    return snapshot;
  });
}

export async function deleteProviderConnection(connectionId: string): Promise<boolean> {
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx.select().from(providerConnections).where(and(
      eq(providerConnections.ownerId, LOCAL_OWNER_ID), eq(providerConnections.id, connectionId),
    )).for("update").limit(1);
    if (!row) return false;
    if (readProviderObservations(row).generationChecks.some((check) => ["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt)) {
      throw new ProviderConnectionCheckPendingError();
    }
    await tx.delete(providerConnections).where(eq(providerConnections.id, connectionId));
    return true;
  });
}

export class ProviderConnectionCheckPendingError extends Error {
  constructor() { super("Bağlantının doğrulanmamış üretim denemesi var; kaldırma engellendi."); }
}
