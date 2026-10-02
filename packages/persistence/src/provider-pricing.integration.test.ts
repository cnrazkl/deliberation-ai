import { randomUUID } from "node:crypto";
import { defaultFakeCouncilMembers, type PriceObservation } from "@deliberation-ai/contracts";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { estimateTokenCost } from "@deliberation-ai/domain";
import { closeDatabase, getDatabase } from "./database";
import { decryptJson, encryptJson } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { closeBoss, RUN_COUNCIL_QUEUE } from "./queue";
import { cancelDurableRun, enqueueDurableRun } from "./run-repository";
import { loadProviderConnectionSecret, saveProviderConnection, deleteProviderConnection } from "./provider-connections";
import { listProviderPrices, pricingFingerprint, recordProviderPrice } from "./provider-pricing";
import { claimProviderOperationSubmission, getRunProviderUsage, prepareProviderOperation, resolveProviderOperation, updateProviderOperation } from "./provider-operations";
import { providerOperations, providerPriceSnapshots, runs } from "./schema";

const runIds: string[] = [];
const connectionIds: string[] = [];
async function fixture() {
  const connection = await saveProviderConnection({ provider: "openai-compatible", label: `Pricing fixture ${randomUUID()}`, apiKey: "",
    defaultModel: "offline-pricing", baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object" });
  connectionIds.push(connection.id);
  const members = defaultFakeCouncilMembers.map((member) => ({ ...member, provider: "openai-compatible" as const, connectionId: connection.id, model: "offline-pricing" }));
  const run = await enqueueDurableRun({ question: "Which offline project evidence should we compare?", idempotencyKey: randomUUID(),
    providerMode: "remote", reviewRounds: 0, members, scenario: "success", memoryEntryIds: [] });
  runIds.push(run.runId);
  const observation: PriceObservation = { version: "token-price-v1", connectionId: connection.id, model: "offline-pricing",
    sourceUrl: "https://example.com/offline-pricing", observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    currency: "USD", inputBasis: "inclusive", outputBasis: "inclusive", maxInputTokens: 200_000,
    inputUsdPerMillion: "2", outputUsdPerMillion: "8", cachedInputUsdPerMillion: "0.5" };
  const price = await recordProviderPrice(observation);
  const secret = await loadProviderConnectionSecret(connection.id);
  return { connection, run, members, observation, price, binding: { id: connection.id, revision: secret!.revision } };
}
async function operation(data: Awaited<ReturnType<typeof fixture>>, memberId = data.members[0]!.id) {
  return prepareProviderOperation({ runId: data.run.runId, memberId, provider: "openai-compatible", model: "offline-pricing",
    requestFingerprint: pricingFingerprint({ runId: data.run.runId, memberId }) });
}
async function finish(id: string) {
  return updateProviderOperation(id, { status: "succeeded", inputTokens: 100, outputTokens: 50,
    metadata: { provider: "openai-compatible", model: "offline-pricing", remoteResponseId: "offline-receipt",
      tokenDetails: { version: "provider-token-details-v1", inputTokenKind: "provider_defined", outputTokenKind: "provider_defined", cachedInputTokens: 40 } } });
}
afterAll(async () => {
  for (const id of runIds) await cancelDurableRun(id);
  await closeBoss();
  if (runIds.length) {
    await getDatabase().execute(sql`delete from pgboss.job where name = ${RUN_COUNCIL_QUEUE} and ${inArray(sql`data->>'runId'`, runIds)}`);
    await getDatabase().delete(runs).where(inArray(runs.id, runIds));
  }
  if (connectionIds.length) await getDatabase().delete(providerPriceSnapshots).where(inArray(providerPriceSnapshots.connectionId, connectionIds));
  for (const id of connectionIds) await deleteProviderConnection(id);
  await closeDatabase();
});

test("records owner-scoped encrypted immutable versions with concurrent idempotent writes", async () => {
  const data = await fixture();
  const repeated = await Promise.all([recordProviderPrice(data.observation), recordProviderPrice(data.observation)]);
  expect(repeated.map((item) => item.id)).toEqual([data.price.id, data.price.id]);
  const [stored] = await getDatabase().select().from(providerPriceSnapshots).where(eq(providerPriceSnapshots.id, data.price.id));
  expect(stored!.payloadCiphertext).not.toContain("offline-pricing");
  expect(decryptJson(stored!.payloadCiphertext, `provider-price:${data.price.id}:payload`)).toEqual(data.observation);
  await closeDatabase();
  expect((await listProviderPrices()).find((item) => item.id === data.price.id)).toEqual(data.price);
  await expect(recordProviderPrice({ ...data.observation, connectionId: randomUUID() })).rejects.toThrow("Owned");
  await expect(recordProviderPrice({ ...data.observation, observedAt: new Date(Date.now() + 1000).toISOString() })).rejects.toThrow("nonfuture");
  await expect(recordProviderPrice({ ...data.observation, validUntil: new Date(Date.now() + 32 * 86_400_000).toISOString() })).rejects.toThrow("31 days");
});
test("binds price at submission, preserves the first calculation, and uses a new version only for a later call", async () => {
  const data = await fixture();
  const first = await operation(data);
  expect(await claimProviderOperationSubmission(first.id, undefined, data.binding)).toBe(true);
  const next = await recordProviderPrice({ ...data.observation, inputUsdPerMillion: "4" });
  await finish(first.id);
  const second = await operation(data, data.members[1]!.id);
  await claimProviderOperationSubmission(second.id, undefined, data.binding);
  await finish(second.id);
  await closeDatabase();
  const usage = await getRunProviderUsage(data.run.runId);
  expect(usage!.costLedger).toEqual({ currency: "USD", estimatedTokenSubtotalUsd: "0.001200000000", estimatedOperations: 2, unavailableOperations: 0, excludedUnsubmittedOperations: 0 });
  expect(usage!.operations.find((item) => item.id === first.id)!.costEstimate).toMatchObject({ priceSnapshotId: data.price.id, amountUsd: "0.000540000000" });
  expect(usage!.operations.find((item) => item.id === second.id)!.costEstimate).toMatchObject({ priceSnapshotId: next.id, amountUsd: "0.000660000000" });
  const [before] = await getDatabase().select().from(providerOperations).where(eq(providerOperations.id, first.id));
  await finish(first.id);
  expect((await getDatabase().select().from(providerOperations).where(eq(providerOperations.id, first.id)))[0]!.costEstimateCiphertext).toBe(before!.costEstimateCiphertext);
  await getDatabase().update(providerOperations).set({ inputTokens: 101 }).where(eq(providerOperations.id, first.id));
  expect((await getRunProviderUsage(data.run.runId))!.operations.find((item) => item.id === first.id)!.costEstimate).toMatchObject({ amountUsd: null, reason: "usage_changed_after_estimate" });
  expect((await getRunProviderUsage(data.run.runId))!.costLedger.estimatedTokenSubtotalUsd).toBe("0.000660000000");
});
test("does not reuse prices after a connection revision, for an unmatched member, or after expiry", async () => {
  const data = await fixture();
  await saveProviderConnection({ id: data.connection.id, provider: "openai-compatible", label: data.connection.label, apiKey: "",
    defaultModel: "offline-pricing", baseUrl: "http://127.0.0.1:2/v1", endpointPreset: "litellm", reasoningProtocol: "none", structuredOutputMode: "json-object" });
  const edited = await operation(data);
  await claimProviderOperationSubmission(edited.id, undefined, data.binding);
  await finish(edited.id);
  expect((await getRunProviderUsage(data.run.runId))!.operations[0]!.costEstimate).toMatchObject({ amountUsd: null, reason: "price_unavailable_at_submission" });
  const other = await fixture();
  const unknownMember = await operation(other, "not-in-frozen-council");
  await claimProviderOperationSubmission(unknownMember.id, undefined, other.binding);
  await finish(unknownMember.id);
  const expired = { ...other.observation, observedAt: new Date(Date.now() - 10_000).toISOString(), validUntil: new Date(Date.now() - 1000).toISOString() };
  await getDatabase().update(providerPriceSnapshots).set({ payloadCiphertext: encryptJson(expired, `provider-price:${other.price.id}:payload`),
    fingerprint: pricingFingerprint({ observation: expired, connectionRevision: other.binding.revision }) }).where(eq(providerPriceSnapshots.id, other.price.id));
  const normal = await operation(other);
  await claimProviderOperationSubmission(normal.id, undefined, other.binding);
  await finish(normal.id);
  expect((await getRunProviderUsage(other.run.runId))!.operations.every((item) => item.costEstimate!.amountUsd === null)).toBe(true);
});
test("keeps unknown costs separate through discard and rejects retroactive pricing", async () => {
  const data = await fixture();
  const first = await operation(data);
  await claimProviderOperationSubmission(first.id, undefined, data.binding);
  await updateProviderOperation(first.id, { status: "outcome_unknown", errorCode: "offline-unknown" });
  await resolveProviderOperation(first.id, "discard");
  const usage = await getRunProviderUsage(data.run.runId);
  expect(usage!.costLedger).toMatchObject({ estimatedTokenSubtotalUsd: null, estimatedOperations: 0, unavailableOperations: 1 });
  expect(usage!.operations[0]!.costEstimate).toMatchObject({ priceSnapshotId: data.price.id, amountUsd: null });
  const second = await operation(data, data.members[1]!.id);
  await claimProviderOperationSubmission(second.id); // no price binding was requested by this offline fixture
  await recordProviderPrice({ ...data.observation, inputUsdPerMillion: "5" });
  await finish(second.id);
  expect((await getRunProviderUsage(data.run.runId))!.operations.find((item) => item.id === second.id)!.costEstimate).toMatchObject({ priceSnapshotId: null, amountUsd: null });
});
test("does not expose another owner's price list entries or accept tampered observation hashes", async () => {
  const data = await fixture();
  await getDatabase().update(providerPriceSnapshots).set({ ownerId: "other-owner-fixture" }).where(eq(providerPriceSnapshots.id, data.price.id));
  expect((await listProviderPrices()).some((item) => item.id === data.price.id)).toBe(false);
  await getDatabase().update(providerPriceSnapshots).set({ ownerId: LOCAL_OWNER_ID, fingerprint: "bad-digest" }).where(eq(providerPriceSnapshots.id, data.price.id));
  await expect(listProviderPrices()).rejects.toThrow("integrity");
  await getDatabase().update(providerPriceSnapshots).set({ fingerprint: data.price.fingerprint }).where(eq(providerPriceSnapshots.id, data.price.id));
  const submitted = await operation(data);
  await claimProviderOperationSubmission(submitted.id, undefined, data.binding);
  await getDatabase().update(providerPriceSnapshots).set({ fingerprint: "bad-digest" }).where(eq(providerPriceSnapshots.id, data.price.id));
  await finish(submitted.id);
  expect((await getRunProviderUsage(data.run.runId))!.operations[0]).toMatchObject({ status: "succeeded",
    costEstimate: { amountUsd: null, reason: "price_integrity_unconfirmed" } });
  await getDatabase().update(providerPriceSnapshots).set({ fingerprint: data.price.fingerprint }).where(eq(providerPriceSnapshots.id, data.price.id));
});

test("sums all priced attempts beyond the latest 100-row detail window without truncating cost coverage", async () => {
  const data = await fixture();
  const metadata = { provider: "openai-compatible", model: "offline-pricing", remoteResponseId: "offline-bulk",
    tokenDetails: { version: "provider-token-details-v1" as const, inputTokenKind: "provider_defined" as const,
      outputTokenKind: "provider_defined" as const, cachedInputTokens: 40 } };
  const usage = { inputTokens: 100, outputTokens: 50, details: metadata.tokenDetails, returnedModel: metadata.model };
  const estimate = estimateTokenCost({ ...usage, price: data.price, submitted: true, usageFingerprint: pricingFingerprint(usage) });
  await getDatabase().insert(providerOperations).values(Array.from({ length: 101 }, () => {
    const id = randomUUID();
    return { id, runId: data.run.runId, memberId: randomUUID(), round: 0, attempt: 1, provider: "openai-compatible",
      model: "offline-pricing", status: "succeeded", requestFingerprint: "offline-bulk-fixture", priceSnapshotId: data.price.id,
      submittedAt: new Date(), inputTokens: 100, outputTokens: 50,
      resultMetadataCiphertext: encryptJson(metadata, `provider-operation:${id}:metadata`),
      costEstimateCiphertext: encryptJson(estimate, `provider-operation:${id}:cost-estimate`) };
  }));
  const projected = await getRunProviderUsage(data.run.runId);
  expect(projected!.operations).toHaveLength(100);
  expect(projected!.recentOperationsTruncated).toBe(true);
  expect(projected!.costLedger).toMatchObject({ estimatedOperations: 101, unavailableOperations: 0, estimatedTokenSubtotalUsd: "0.054540000000" });
});
