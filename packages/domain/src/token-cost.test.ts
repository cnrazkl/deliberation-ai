import { expect, test } from "vitest";
import { priceObservationSchema, type PriceSnapshot, type ProviderTokenDetails } from "@deliberation-ai/contracts";
import { estimateTokenCost } from "./token-cost";

const price: PriceSnapshot = { version: "token-price-v1", id: "price", connectionId: "00000000-0000-4000-8000-000000000001",
  connectionRevision: 1, fingerprint: "price-digest", recordedAt: "2026-10-01T00:00:00.000Z", model: "fixture-model",
  sourceUrl: "https://example.com/pricing", observedAt: "2026-10-01T00:00:00.000Z", validUntil: "2026-10-02T00:00:00.000Z",
  currency: "USD", inputBasis: "inclusive", outputBasis: "inclusive", maxInputTokens: 200_000,
  inputUsdPerMillion: "2", outputUsdPerMillion: "8", cachedInputUsdPerMillion: "0.5" };
const details: ProviderTokenDetails = { version: "provider-token-details-v1", inputTokenKind: "inclusive", outputTokenKind: "inclusive",
  cachedInputTokens: 40, reasoningTokens: 10 };
const request = { price, inputTokens: 100, outputTokens: 50, details, returnedModel: price.model, usageFingerprint: "usage", submitted: true };

test("prices nonoverlapping cache and output counts exactly without charging inclusive reasoning twice", () => {
  expect(estimateTokenCost(request)).toMatchObject({ status: "estimated", amountPicoUsd: "540000000", amountUsd: "0.000540000000" });
  expect(estimateTokenCost(request).components.map((item) => item.tokens)).toEqual([60, 40, 50]);
});
test("prices additive Claude input and Gemini candidates plus thoughts using the declared basis", () => {
  expect(estimateTokenCost({ ...request, price: { ...price, inputBasis: "uncached" }, details: { ...details, inputTokenKind: "uncached", cacheWriteInputTokens: 0 } }).amountUsd).toBe("0.000620000000");
  expect(estimateTokenCost({ ...request, price: { ...price, outputBasis: "candidates" }, details: { ...details, outputTokenKind: "candidates" } }).amountUsd).toBe("0.000620000000");
});
test("retains unknown prices, missing counters, cache TTL, model aliases and input bands as unavailable", () => {
  const cases = [
    { ...request, price: null }, { ...request, inputTokens: null }, { ...request, returnedModel: "another-model" },
    { ...request, details: { ...details, cachedInputTokens: undefined } },
    { ...request, details: { ...details, cacheWriteInputTokens: 3 } },
    { ...request, details: { ...details, cachedInputTokens: 101 } },
    { ...request, price: { ...price, maxInputTokens: 99 } },
    { ...request, price: { ...price, outputBasis: "candidates" as const }, details: { ...details, outputTokenKind: "candidates" as const, reasoningTokens: undefined } },
  ];
  for (const item of cases) expect(estimateTokenCost(item)).toMatchObject({ status: "unavailable", amountUsd: null, amountPicoUsd: null });
});
test("distinguishes explicit zero rates from unavailable and keeps fixed point precision at large counts", () => {
  expect(estimateTokenCost({ ...request, price: { ...price, inputUsdPerMillion: "0", outputUsdPerMillion: "0", cachedInputUsdPerMillion: "0" } }).amountUsd).toBe("0.000000000000");
  expect(estimateTokenCost({ ...request, inputTokens: 2_000_000_000, outputTokens: 2_000_000_000,
    price: { ...price, maxInputTokens: 2_147_483_647, inputUsdPerMillion: "999999.999999", outputUsdPerMillion: "999999.999999" },
    details: { ...details, cachedInputTokens: 0 } }).amountUsd).toBe("3999999999.996000000000");
});
test("validates price strings, timestamps, currency and safe source references", () => {
  const { id: _id, connectionRevision: _revision, fingerprint: _fingerprint, recordedAt: _recorded, ...observation } = price;
  expect(priceObservationSchema.safeParse(observation).success).toBe(true);
  for (const inputUsdPerMillion of ["-1", "NaN", "1e3", "1000000", "0.0000001"]) expect(priceObservationSchema.safeParse({ ...observation, inputUsdPerMillion }).success).toBe(false);
  for (const sourceUrl of ["http://example.com", "https://u:p@example.com", "https://example.com/?key=x", "https://example.com/#secret"]) expect(priceObservationSchema.safeParse({ ...observation, sourceUrl }).success).toBe(false);
  expect(priceObservationSchema.safeParse({ ...observation, validUntil: observation.observedAt }).success).toBe(false);
});
