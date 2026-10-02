import { z } from "zod";

const rate = z.string().regex(/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/u);
const source = z.string().url().max(2000).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
}, "Use a public HTTPS pricing reference without credentials or query parameters.");
export const priceObservationSchema = z.object({
  version: z.literal("token-price-v1"),
  connectionId: z.string().uuid(),
  model: z.string().trim().min(1).max(200),
  sourceUrl: source,
  observedAt: z.string().datetime(),
  validUntil: z.string().datetime(),
  currency: z.literal("USD"),
  inputBasis: z.enum(["inclusive", "uncached"]),
  outputBasis: z.enum(["inclusive", "candidates"]),
  maxInputTokens: z.number().int().min(1).max(2_147_483_647),
  inputUsdPerMillion: rate,
  outputUsdPerMillion: rate,
  cachedInputUsdPerMillion: rate.optional(),
}).strict().refine((value) => Date.parse(value.validUntil) > Date.parse(value.observedAt), "Price validity must follow observation.");
export type PriceObservation = z.infer<typeof priceObservationSchema>;
export type PriceSnapshot = PriceObservation & { id: string; connectionRevision: number; fingerprint: string; recordedAt: string };
export type TokenCostEstimate = {
  version: "token-cost-v1";
  status: "estimated" | "unavailable" | "not_submitted";
  currency: "USD";
  amountPicoUsd: string | null;
  amountUsd: string | null;
  reason: string | null;
  priceSnapshotId: string | null;
  priceFingerprint: string | null;
  usageFingerprint: string;
  components: Array<{ kind: "input" | "cached_input" | "output"; tokens: number; usdPerMillion: string; amountPicoUsd: string }>;
  exclusions: readonly string[];
};
