import type { CatalogModelDetail, ModelCatalogCheck, SaveProviderConnectionRequest } from "@deliberation-ai/contracts";
import { NVIDIA_HOSTED_BASE_URL } from "@deliberation-ai/contracts";

export type { CatalogModelDetail, ModelCatalogCheck } from "@deliberation-ai/contracts";

type CatalogConnection = Pick<SaveProviderConnectionRequest, "provider" | "endpointPreset" | "baseUrl" | "apiKey" | "defaultModel">;

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_MODELS = 300;
const TIMEOUT_MS = 10_000;
const effortLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

function positiveTokenLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000
    ? value
    : undefined;
}

function safeDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 && !/[\u0000-\u001f]/.test(trimmed) ? trimmed : undefined;
}

function catalogDetail(model: Record<string, unknown>, id: string, connection: CatalogConnection): CatalogModelDetail {
  const detail: CatalogModelDetail = { id };
  if (connection.provider === "anthropic") {
    const displayName = safeDisplayName(model.display_name);
    const inputTokenLimit = positiveTokenLimit(model.max_input_tokens);
    const outputTokenLimit = positiveTokenLimit(model.max_tokens);
    if (displayName) detail.displayName = displayName;
    if (inputTokenLimit) detail.inputTokenLimit = inputTokenLimit;
    if (outputTokenLimit) detail.outputTokenLimit = outputTokenLimit;
    const capabilities = model.capabilities;
    if (capabilities && typeof capabilities === "object") {
      const effort = (capabilities as Record<string, unknown>).effort;
      if (effort && typeof effort === "object") {
        const entries = effort as Record<string, unknown>;
        const levels = effortLevels.filter((level) => {
          const item = entries[level];
          return item && typeof item === "object" && (item as Record<string, unknown>).supported === true;
        });
        if (levels.length > 0) detail.reasoningLevels = [...levels];
      }
    }
  } else if (connection.provider === "google") {
    const displayName = safeDisplayName(model.displayName);
    const inputTokenLimit = positiveTokenLimit(model.inputTokenLimit);
    const outputTokenLimit = positiveTokenLimit(model.outputTokenLimit);
    if (displayName) detail.displayName = displayName;
    if (inputTokenLimit) detail.inputTokenLimit = inputTokenLimit;
    if (outputTokenLimit) detail.outputTokenLimit = outputTokenLimit;
    if (typeof model.thinking === "boolean") detail.thinking = model.thinking;
  } else if (connection.endpointPreset === "openrouter") {
    const displayName = safeDisplayName(model.name);
    const contextWindowTokens = positiveTokenLimit(model.context_length);
    if (displayName) detail.displayName = displayName;
    if (contextWindowTokens) detail.contextWindowTokens = contextWindowTokens;
    if (Array.isArray(model.supported_parameters) && model.supported_parameters.some((item) => item === "reasoning" || item === "reasoning_effort")) {
      detail.reasoningParameterListed = true;
    }
  }
  return detail;
}

function catalogRequest(connection: CatalogConnection): { url: string; headers: Record<string, string>; verification: ModelCatalogCheck["verification"] } | undefined {
  if (connection.endpointPreset === "nvidia" && (connection.provider !== "openai-compatible" || connection.baseUrl !== NVIDIA_HOSTED_BASE_URL || !connection.apiKey.trim())) return undefined;
  const headers: Record<string, string> = { accept: "application/json" };
  if (connection.provider === "anthropic") {
    const base = (connection.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    return { url: `${base}/v1/models?limit=100`, headers, verification: base === "https://api.anthropic.com" ? "authenticated_catalog" : "catalog_only" };
  }
  if (connection.provider === "google") {
    const base = (connection.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
    headers["x-goog-api-key"] = connection.apiKey;
    return { url: `${base}/models?pageSize=100`, headers, verification: base === "https://generativelanguage.googleapis.com/v1beta" ? "authenticated_catalog" : "catalog_only" };
  }
  if (connection.apiKey) headers.authorization = `Bearer ${connection.apiKey}`;
  if (connection.provider === "openai") {
    const base = (connection.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    return { url: `${base}/models`, headers, verification: base === "https://api.openai.com/v1" ? "authenticated_catalog" : "catalog_only" };
  }
  if (!connection.baseUrl) return undefined;
  const officialOpenRouter = connection.endpointPreset === "openrouter" && ["https://openrouter.ai/api/v1", "https://eu.openrouter.ai/api/v1"].includes(connection.baseUrl.replace(/\/+$/, ""));
  const suffix = connection.endpointPreset === "openrouter" ? `/models/user${officialOpenRouter ? "?limit=300" : ""}` : "/models";
  return {
    url: `${connection.baseUrl.replace(/\/+$/, "")}${suffix}`,
    headers,
    verification: officialOpenRouter ? "authenticated_catalog" : "catalog_only",
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty catalog body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new Error("catalog body too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function checkProviderConnectionModels(
  connection: CatalogConnection,
  fetcher: typeof fetch = fetch,
): Promise<ModelCatalogCheck> {
  const request = catalogRequest(connection);
  const failure = (status: ModelCatalogCheck["status"]): ModelCatalogCheck => ({ status, verification: "none", models: [], truncated: false });
  if (!request) return failure("unsupported");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
    if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) return failure("unsupported");
  } catch {
    return failure("unsupported");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(parsedUrl, {
      method: "GET",
      headers: request.headers,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return failure("auth_failed");
    if (response.status === 404 || response.status === 405 || response.status === 501) return failure("unsupported");
    if (!response.ok) return failure("unavailable");
    const body = await readBoundedJson(response);
    if (!body || typeof body !== "object") return failure("unavailable");
    const record = body as Record<string, unknown>;
    const entries = connection.provider === "google" ? record.models : record.data;
    if (!Array.isArray(entries)) return failure("unsupported");
    const ids: string[] = [];
    const details: CatalogModelDetail[] = [];
    let eligibleCount = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const model = entry as Record<string, unknown>;
      if (connection.provider === "google") {
        const actions = model.supportedActions ?? model.supportedGenerationMethods;
        if (Array.isArray(actions) && !actions.includes("generateContent")) continue;
      }
      const rawId = connection.provider === "google" ? model.name : model.id;
      if (typeof rawId !== "string") continue;
      const id = connection.provider === "google" ? rawId.replace(/^models\//, "") : rawId;
      if (!id || id.length > 120 || /[\u0000-\u001f]/.test(id)) continue;
      eligibleCount += 1;
      if (ids.length < MAX_MODELS && !ids.includes(id)) {
        ids.push(id);
        if (request.verification === "authenticated_catalog") {
          const detail = catalogDetail(model, id, connection);
          if (Object.keys(detail).length > 1) details.push(detail);
        }
      }
    }
    ids.sort((a, b) => a.localeCompare(b));
    details.sort((a, b) => a.id.localeCompare(b.id));
    return {
      status: "available",
      verification: request.verification,
      models: ids,
      ...(details.length ? { details } : {}),
      checkedAt: new Date().toISOString(),
      truncated: eligibleCount > MAX_MODELS || record.has_more === true || typeof record.nextPageToken === "string" || (typeof record.total_count === "number" && record.total_count > entries.length),
    };
  } catch {
    return failure("unavailable");
  } finally {
    clearTimeout(timeout);
  }
}
