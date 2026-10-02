import { randomUUID } from "node:crypto";
import type {
  ModelCatalogCheck,
  RemoteProvider,
  SaveProviderConnectionRequest,
} from "@deliberation-ai/contracts";
import { modelCatalogCheckSchema } from "@deliberation-ai/contracts";
import { and, eq } from "drizzle-orm";
import { encryptText, decryptText, encryptJson, decryptJson } from "./crypto";
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
  catalogCheck?: ModelCatalogCheck;
};

export class ProviderConnectionSecretRequiredError extends Error {
  constructor() {
    super("Yeni bulut bağlantısı veya sağlayıcı değişikliği için API anahtarı gerekli.");
    this.name = "ProviderConnectionSecretRequiredError";
  }
}

function summary(row: typeof providerConnections.$inferSelect): ProviderConnectionSummary {
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
    ...(row.catalogSnapshotCiphertext ? {
      catalogCheck: modelCatalogCheckSchema.parse(decryptJson(row.catalogSnapshotCiphertext, `provider-connection:${row.id}:catalog-snapshot`)),
    } : {}),
  };
}

export async function saveProviderConnection(
  request: SaveProviderConnectionRequest,
): Promise<ProviderConnectionSummary> {
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
          .limit(1)
      : await tx
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.ownerId, LOCAL_OWNER_ID),
              eq(providerConnections.label, request.label),
            ),
          )
          .limit(1);
    const id = existing?.id ?? randomUUID();
    const localPreset = ["ollama", "vllm", "litellm"].includes(request.endpointPreset);
    if ((!existing && !localPreset && !request.apiKey) ||
        (existing && existing.provider !== request.provider && !request.apiKey)) {
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
      catalogSnapshotCiphertext: null,
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
  const [updated] = await getDatabase()
    .update(providerConnections)
    .set({ catalogSnapshotCiphertext: encryptJson(snapshot, `provider-connection:${connectionId}:catalog-snapshot`) })
    .where(and(
      eq(providerConnections.ownerId, LOCAL_OWNER_ID),
      eq(providerConnections.id, connectionId),
      eq(providerConnections.revision, expectedRevision),
    ))
    .returning({ id: providerConnections.id });
  return updated ? snapshot : undefined;
}

export async function deleteProviderConnection(connectionId: string): Promise<boolean> {
  const deleted = await getDatabase()
    .delete(providerConnections)
    .where(
      and(eq(providerConnections.ownerId, LOCAL_OWNER_ID), eq(providerConnections.id, connectionId)),
    )
    .returning({ id: providerConnections.id });
  return deleted.length > 0;
}
