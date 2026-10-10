import { createHash } from "node:crypto";
import { acknowledgeGenerationCheckSchema, connectionChatSendSchema, generationCheckRequestSchema, MAX_GENERATION_CHECKS, type GenerationObservation, type SaveProviderConnectionRequest } from "@deliberation-ai/contracts";
import { connectionChatPrompt, executeBoundedConnectionChat, executeBoundedConnectionCheck, generationCheckPrompt, GENERATION_CHECK_TIMEOUT_MS, type ConnectionCheckExecution } from "@deliberation-ai/application";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "./database";
import { decryptText } from "./crypto";
import { getOwnerId } from "./owner";
import { providerConnections } from "./schema";
import { readProviderObservations, encryptProviderObservations } from "./provider-observations";

type Row = typeof providerConnections.$inferSelect;
export class ConnectionCheckConflictError extends Error {
  constructor(readonly reason: "stale" | "identity" | "pending" | "acknowledgement" | "capacity") { super("Bağlantı denemesi onayı veya durumu değişti."); }
}
function fingerprint(row: Row, model: string, message?: string) {
  return createHash("sha256").update(JSON.stringify({ id: row.id, revision: row.revision, provider: row.provider,
    baseUrl: row.baseUrl, endpointPreset: row.endpointPreset, reasoningProtocol: row.reasoningProtocol,
    structuredOutputMode: row.structuredOutputMode, model, prompt: message === undefined ? generationCheckPrompt() : connectionChatPrompt(message) })).digest("hex");
}
export async function getConnectionCheckHistory(id: string) {
  const [row] = await getDatabase().select().from(providerConnections).where(and(
    eq(providerConnections.ownerId, getOwnerId()), eq(providerConnections.id, id),
  )).limit(1);
  return row ? readProviderObservations(row) : undefined;
}
export async function reviewConnectionGenerationCheck(id: string, model?: string, message?: string) {
  const [row] = await getDatabase().select().from(providerConnections).where(and(
    eq(providerConnections.ownerId, getOwnerId()), eq(providerConnections.id, id),
  )).limit(1);
  if (!row) return undefined;
  const selected = generationCheckRequestSchema.shape.model.parse(model ?? row.defaultModel);
  return { connectionId: row.id, revision: row.revision, model: selected, fingerprint: fingerprint(row, selected, message),
    ...(message === undefined ? generationCheckPrompt() : connectionChatPrompt(message)), observations: readProviderObservations(row) };
}

type Executor = (target: SaveProviderConnectionRequest, operationId: string) => Promise<ConnectionCheckExecution>;

export async function runConnectionGenerationCheck(id: string, input: unknown, execute: Executor = executeBoundedConnectionCheck): Promise<GenerationObservation | undefined> {
  const request = generationCheckRequestSchema.parse(input);
  return runCheck(id, request, execute);
}
export async function runConnectionChatCheck(id: string, input: unknown,
  execute: (target: SaveProviderConnectionRequest, id: string, message: string) => Promise<ConnectionCheckExecution> = executeBoundedConnectionChat) {
  const request = connectionChatSendSchema.parse(input);
  return runCheck(id, request, (target, operationId) => execute(target, operationId, request.message), request.message);
}
async function runCheck(id: string, request: ReturnType<typeof generationCheckRequestSchema.parse>, execute: Executor, message?: string): Promise<GenerationObservation | undefined> {
  const claim = await getDatabase().transaction(async (tx) => {
    const [row] = await tx.select().from(providerConnections).where(and(
      eq(providerConnections.ownerId, getOwnerId()), eq(providerConnections.id, id),
    )).for("update").limit(1);
    if (!row) return undefined;
    const observations = readProviderObservations(row);
    const previous = observations.generationChecks.find((check) => check.id === request.requestId);
    if (previous) {
      if (previous.fingerprint !== request.fingerprint || previous.model !== request.model || previous.message !== message) throw new ConnectionCheckConflictError("identity");
      return { check: previous, target: null };
    }
    if (fingerprint(row, request.model, message) !== request.fingerprint) throw new ConnectionCheckConflictError("stale");
    if (observations.generationChecks.length >= MAX_GENERATION_CHECKS) throw new ConnectionCheckConflictError("capacity");
    const pending = observations.generationChecks.filter((check) => ["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt);
    if (pending.some((check) => Date.now() - Date.parse(check.startedAt) < GENERATION_CHECK_TIMEOUT_MS + 5_000)) throw new ConnectionCheckConflictError("pending");
    if (pending.length && !request.acknowledgeUnknown) throw new ConnectionCheckConflictError("acknowledgement");
    const now = new Date().toISOString();
    for (const check of pending) { check.status = "outcome_unknown"; check.acknowledgedAt = now; }
    const check: GenerationObservation = { version: "connection-generation-v1", id: request.requestId, revision: row.revision, model: request.model,
      provider: row.provider as GenerationObservation["provider"], endpointPreset: row.endpointPreset as GenerationObservation["endpointPreset"],
      fingerprint: request.fingerprint, status: "submitted", startedAt: now, finishedAt: null, acknowledgedAt: null,
      failure: null, httpStatus: null, outputCapExceeded: null, returnedModel: null, remoteResponseId: null, inputTokens: null, outputTokens: null, elapsedMs: null,
      ...(message === undefined ? {} : { kind: "chat" as const, message }) };
    observations.generationChecks.push(check);
    await tx.update(providerConnections).set({ catalogSnapshotCiphertext: encryptProviderObservations(row.id, observations) }).where(eq(providerConnections.id, row.id));
    // Credentials stop at the adapter boundary and never enter the review/history.
    const target: SaveProviderConnectionRequest = { id: row.id, label: row.label, provider: check.provider, defaultModel: check.model,
      endpointPreset: check.endpointPreset, reasoningProtocol: row.reasoningProtocol as SaveProviderConnectionRequest["reasoningProtocol"],
      structuredOutputMode: row.structuredOutputMode as SaveProviderConnectionRequest["structuredOutputMode"],
      apiKey: decryptText(row.secretCiphertext, `provider-connection:${row.id}:secret`), ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}) };
    return { check, target };
  });
  if (!claim || !claim.target) return claim?.check;
  const started = Date.now();
  let completed: GenerationObservation;
  try {
    const result = await execute(claim.target, claim.check.id);
    completed = { ...claim.check, ...result, outputCapExceeded: result.outputTokens === null ? null : result.outputTokens > generationCheckPrompt().maxOutputTokens,
      finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started };
  } catch {
    completed = { ...claim.check, status: "outcome_unknown", failure: "network_unknown", errorCode: "remote_outcome_unknown", finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started };
  }
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx.select().from(providerConnections).where(and(
      eq(providerConnections.ownerId, getOwnerId()), eq(providerConnections.id, id),
    )).for("update").limit(1);
    if (!row) return undefined;
    const observations = readProviderObservations(row);
    const index = observations.generationChecks.findIndex((check) => check.id === completed.id);
    if (index < 0) throw new ConnectionCheckConflictError("identity");
    completed.acknowledgedAt = observations.generationChecks[index]!.acknowledgedAt;
    observations.generationChecks[index] = completed;
    await tx.update(providerConnections).set({ catalogSnapshotCiphertext: encryptProviderObservations(row.id, observations) }).where(eq(providerConnections.id, row.id));
    return completed;
  });
}

export async function acknowledgeConnectionGenerationCheck(id: string, input: unknown) {
  const request = acknowledgeGenerationCheckSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx.select().from(providerConnections).where(and(
      eq(providerConnections.ownerId, getOwnerId()), eq(providerConnections.id, id),
    )).for("update").limit(1);
    if (!row) return undefined;
    const observations = readProviderObservations(row);
    const check = observations.generationChecks.find((item) => item.id === request.id);
    if (!check || check.fingerprint !== request.fingerprint) throw new ConnectionCheckConflictError("identity");
    if (check.acknowledgedAt) return check;
    if (!["submitted", "outcome_unknown"].includes(check.status)) throw new ConnectionCheckConflictError("stale");
    if (Date.now() - Date.parse(check.startedAt) < GENERATION_CHECK_TIMEOUT_MS + 5_000) throw new ConnectionCheckConflictError("pending");
    check.status = "outcome_unknown"; check.acknowledgedAt = new Date().toISOString();
    await tx.update(providerConnections).set({ catalogSnapshotCiphertext: encryptProviderObservations(row.id, observations) }).where(eq(providerConnections.id, row.id));
    return check;
  });
}
