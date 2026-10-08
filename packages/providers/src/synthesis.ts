import { createHash } from "node:crypto";
import type { SaveProviderConnectionRequest, PrivateDeliveryResult } from "@deliberation-ai/contracts";
import { generateSynthesisText } from "./private-text";
import { NormalizedProviderError } from "./index";

export type SynthesisTarget = Omit<SaveProviderConnectionRequest, "label" | "id">;
export type SynthesisTextOutcome =
  | { status: "returned"; result: PrivateDeliveryResult }
  | { status: "failed"; outcome: "known" | "unknown"; code: string; inputTokens: number | null; outputTokens: number | null; rawText?: string };

export function synthesisTargetIdentity(target: SynthesisTarget): string {
  const base = target.baseUrl ?? (target.provider === "openai" ? "https://api.openai.com/v1"
    : target.provider === "anthropic" ? "https://api.anthropic.com" : target.provider === "google" ? "https://generativelanguage.googleapis.com/v1beta" : "");
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash ||
    url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
    throw new Error("Unsupported synthesis endpoint");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return createHash("sha256").update(JSON.stringify([url.toString(), target.defaultModel])).digest("hex");
}
export async function executeSynthesisText(target: SynthesisTarget, operationKey: string, input: { instructions: string; data: string }, injectedFetch?: typeof fetch): Promise<SynthesisTextOutcome> {
  try {
    synthesisTargetIdentity(target);
    const baseUrl = target.baseUrl ?? (target.provider === "openai" ? "https://api.openai.com/v1"
      : target.provider === "anthropic" ? "https://api.anthropic.com" : "https://generativelanguage.googleapis.com/v1beta");
    const result = await generateSynthesisText({ ...input, model: target.defaultModel }, {
      provider: target.provider, baseUrl, apiKey: target.apiKey, endpointPreset: target.endpointPreset,
      operationKey, timeoutMs: 60_000, ...(injectedFetch ? { fetch: injectedFetch } : {}),
    });
    return { status: "returned", result };
  } catch (error) {
    const normalized = error instanceof NormalizedProviderError ? error : null;
    return { status: "failed", outcome: normalized?.outcome ?? "unknown", code: normalized?.code ?? "synthesis_transport_unavailable",
      inputTokens: normalized?.metadata?.inputTokens ?? null, outputTokens: normalized?.metadata?.outputTokens ?? null,
      ...(normalized?.rawText ? { rawText: normalized.rawText } : {}) };
  }
}
