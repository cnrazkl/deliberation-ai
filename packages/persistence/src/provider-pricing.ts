import { createHash, randomUUID } from "node:crypto";
import { priceObservationSchema, type PriceObservation, type PriceSnapshot } from "@deliberation-ai/contracts";
import { and, desc, eq } from "drizzle-orm";
import { decryptJson, encryptJson } from "./crypto";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { providerConnections, providerPriceSnapshots } from "./schema";

export function pricingFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function hydratePriceSnapshot(row: typeof providerPriceSnapshots.$inferSelect): PriceSnapshot {
  const payload = priceObservationSchema.parse(decryptJson(row.payloadCiphertext, `provider-price:${row.id}:payload`));
  if (payload.connectionId !== row.connectionId || payload.model !== row.model ||
    pricingFingerprint({ observation: payload, connectionRevision: row.connectionRevision }) !== row.fingerprint) {
    throw new Error("Price snapshot integrity check failed.");
  }
  return { ...payload, id: row.id, connectionRevision: row.connectionRevision, fingerprint: row.fingerprint, recordedAt: row.recordedAt.toISOString() };
}
export async function recordProviderPrice(input: PriceObservation): Promise<PriceSnapshot> {
  const observation = priceObservationSchema.parse(input);
  const now = Date.now();
  if (Date.parse(observation.observedAt) > now || Date.parse(observation.validUntil) <= now ||
    Date.parse(observation.validUntil) - Date.parse(observation.observedAt) > 31 * 86_400_000) {
    throw new Error("Price observation must be current, nonfuture and valid for at most 31 days.");
  }
  return getDatabase().transaction(async (tx) => {
    const [connection] = await tx.select().from(providerConnections).where(and(
      eq(providerConnections.id, observation.connectionId), eq(providerConnections.ownerId, LOCAL_OWNER_ID))).for("share").limit(1);
    if (!connection) throw new Error("Owned provider connection was not found.");
    const fingerprint = pricingFingerprint({ observation, connectionRevision: connection.revision });
    const id = randomUUID();
    const [created] = await tx.insert(providerPriceSnapshots).values({
      id, ownerId: LOCAL_OWNER_ID, connectionId: connection.id, connectionRevision: connection.revision,
      model: observation.model, fingerprint, payloadCiphertext: encryptJson(observation, `provider-price:${id}:payload`),
    }).onConflictDoNothing().returning();
    if (created) return hydratePriceSnapshot(created);
    const [existing] = await tx.select().from(providerPriceSnapshots).where(and(
      eq(providerPriceSnapshots.ownerId, LOCAL_OWNER_ID), eq(providerPriceSnapshots.fingerprint, fingerprint))).limit(1);
    if (!existing) throw new Error("Price snapshot could not be recorded.");
    return hydratePriceSnapshot(existing);
  });
}
export async function listProviderPrices(): Promise<PriceSnapshot[]> {
  const rows = await getDatabase().select().from(providerPriceSnapshots).where(eq(providerPriceSnapshots.ownerId, LOCAL_OWNER_ID))
    .orderBy(desc(providerPriceSnapshots.recordedAt), desc(providerPriceSnapshots.id)).limit(100);
  return rows.map(hydratePriceSnapshot);
}
