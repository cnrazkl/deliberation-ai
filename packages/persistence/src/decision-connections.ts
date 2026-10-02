import { randomUUID } from "node:crypto";
import type { SaveDecisionConnectionRequest } from "@deliberation-ai/evaluation";
import { and, asc, eq } from "drizzle-orm";
import { decryptText, encryptText } from "./crypto";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { decisionConnections } from "./schema";

export type DecisionConnectionSummary = {
  id: string;
  provider: "typesafe";
  label: string;
  defaultModel: string;
  configured: true;
  updatedAt: string;
};

export class DecisionConnectionSecretRequiredError extends Error {
  constructor() {
    super("Yeni TypeSafe bağlantısı için API anahtarı gerekli.");
    this.name = "DecisionConnectionSecretRequiredError";
  }
}

export class DecisionConnectionInUseError extends Error {
  constructor() {
    super("Bu TypeSafe bağlantısına bağlı inceleme geçmişi var; kayıt silinemez.");
    this.name = "DecisionConnectionInUseError";
  }
}

function mapConnection(row: typeof decisionConnections.$inferSelect): DecisionConnectionSummary {
  return {
    id: row.id,
    provider: "typesafe",
    label: row.label,
    defaultModel: row.defaultModel,
    configured: true,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveDecisionConnection(
  request: SaveDecisionConnectionRequest,
): Promise<DecisionConnectionSummary> {
  return getDatabase().transaction(async (tx) => {
    const [existing] = request.id
      ? await tx
          .select()
          .from(decisionConnections)
          .where(
            and(
              eq(decisionConnections.ownerId, LOCAL_OWNER_ID),
              eq(decisionConnections.id, request.id),
            ),
          )
          .limit(1)
      : await tx
          .select()
          .from(decisionConnections)
          .where(
            and(
              eq(decisionConnections.ownerId, LOCAL_OWNER_ID),
              eq(decisionConnections.label, request.label),
            ),
          )
          .limit(1);
    if (!existing && !request.apiKey) throw new DecisionConnectionSecretRequiredError();
    const id = existing?.id ?? randomUUID();
    const values = {
      ownerId: LOCAL_OWNER_ID,
      provider: "typesafe",
      label: request.label,
      defaultModel: request.defaultModel,
      secretCiphertext: request.apiKey
        ? encryptText(request.apiKey, `decision-connection:${id}:secret`)
        : existing?.secretCiphertext ?? "",
      keyVersion: Number(process.env.KEY_VERSION ?? "1"),
      updatedAt: new Date(),
    };
    const [saved] = existing
      ? await tx
          .update(decisionConnections)
          .set(values)
          .where(eq(decisionConnections.id, id))
          .returning()
      : await tx.insert(decisionConnections).values({ id, ...values }).returning();
    if (!saved) throw new Error("Decision connection could not be saved.");
    return mapConnection(saved);
  });
}

export async function listDecisionConnections(): Promise<DecisionConnectionSummary[]> {
  const rows = await getDatabase()
    .select()
    .from(decisionConnections)
    .where(eq(decisionConnections.ownerId, LOCAL_OWNER_ID))
    .orderBy(asc(decisionConnections.label));
  return rows.map(mapConnection);
}

export async function loadDecisionConnectionSecret(id: string): Promise<
  | (Omit<DecisionConnectionSummary, "configured" | "updatedAt"> & { apiKey: string })
  | undefined
> {
  const [row] = await getDatabase()
    .select()
    .from(decisionConnections)
    .where(
      and(eq(decisionConnections.ownerId, LOCAL_OWNER_ID), eq(decisionConnections.id, id)),
    )
    .limit(1);
  if (!row) return undefined;
  return {
    id: row.id,
    provider: "typesafe",
    label: row.label,
    defaultModel: row.defaultModel,
    apiKey: decryptText(row.secretCiphertext, `decision-connection:${row.id}:secret`),
  };
}

export async function deleteDecisionConnection(id: string): Promise<boolean> {
  try {
    const deleted = await getDatabase()
      .delete(decisionConnections)
      .where(
        and(eq(decisionConnections.ownerId, LOCAL_OWNER_ID), eq(decisionConnections.id, id)),
      )
      .returning({ id: decisionConnections.id });
    return deleted.length > 0;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23503") {
      throw new DecisionConnectionInUseError();
    }
    throw error;
  }
}
