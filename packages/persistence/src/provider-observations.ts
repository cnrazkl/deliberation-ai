import { modelCatalogCheckSchema, providerObservationsSchema, type ProviderObservations } from "@deliberation-ai/contracts";
import { decryptJson, encryptJson } from "./crypto";
import type { providerConnections } from "./schema";

type Row = typeof providerConnections.$inferSelect;
export function readProviderObservations(row: Pick<Row, "id" | "revision" | "provider" | "endpointPreset" | "catalogSnapshotCiphertext">): ProviderObservations {
  const empty: ProviderObservations = { version: "provider-observations-v1", latestCatalog: null, catalogHistory: [], catalogDropped: 0, generationChecks: [] };
  if (!row.catalogSnapshotCiphertext) return empty;
  const value = decryptJson(row.catalogSnapshotCiphertext, `provider-connection:${row.id}:catalog-snapshot`);
  const current = providerObservationsSchema.safeParse(value);
  if (current.success) return current.data;
  // Historical latest-only records remain readable. Their original timestamp is
  // retained; an absent timestamp never becomes a newly observed capability.
  const legacy = modelCatalogCheckSchema.parse(value);
  return providerObservationsSchema.parse({ ...empty, latestCatalog: legacy, catalogHistory: [{
    revision: row.revision, provider: row.provider, endpointPreset: row.endpointPreset, check: legacy,
  }] });
}
export function encryptProviderObservations(id: string, observations: ProviderObservations): string {
  return encryptJson(providerObservationsSchema.parse(observations), `provider-connection:${id}:catalog-snapshot`);
}
