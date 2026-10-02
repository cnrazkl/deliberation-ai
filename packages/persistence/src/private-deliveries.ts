import { createHash } from "node:crypto";
import { Client } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { privateDeliveryResultSchema, sendPrivateDeliverySchema, controlPrivateDeliverySchema,
  privateDeliveryUsageSchema, type PrivateBranchBody, type PrivateDelivery, type PrivateDeliveryResult, type PrivateDeliveryUsage } from "@deliberation-ai/contracts";
import { renderPrivateDelivery, assessPrivateDelivery } from "@deliberation-ai/domain";
import { getDatabase } from "./database";
import { decryptText } from "./crypto";
import { LOCAL_OWNER_ID } from "./owner";
import { providerConnections } from "./schema";
import { getBoss, PRIVATE_DELIVERY_QUEUE } from "./queue";
import { lockConversationMembership, ConversationSizeError, type ConversationTransaction } from "./conversation-membership";
import { boundedPrivateBody, privateDeliveryPending, readPrivateBranch, writePrivateDeliveryBody, PrivateBranchConflictError } from "./private-branches";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Connection = typeof providerConnections.$inferSelect;
function supportedProvider(provider: string): provider is "openai-compatible" | "anthropic" | "openai" {
  return provider === "openai-compatible" || provider === "anthropic" || provider === "openai";
}
function privateBaseUrl(target: Connection) {
  return target.baseUrl || (target.provider === "anthropic" ? "https://api.anthropic.com" : target.provider === "openai" ? "https://api.openai.com/v1" : null);
}
export function privateConnectionFingerprint(connection: Connection) {
  return hash({ id: connection.id, revision: connection.revision, provider: connection.provider, baseUrl: connection.baseUrl,
    endpointPreset: connection.endpointPreset, reasoningProtocol: connection.reasoningProtocol });
}
export type PrivateDeliveryBlock = "no_message" | "already_requested" | "pending" | "unsupported_provider" | "unsupported_settings" | "missing_connection" | "high_risk" | "capacity";
export class PrivateDeliveryBlockedError extends Error {}
async function connection(tx: ConversationTransaction, id: string | undefined, lock = false) {
  if (!id) return undefined;
  const query = tx.select().from(providerConnections).where(and(eq(providerConnections.id, id), eq(providerConnections.ownerId, LOCAL_OWNER_ID))).limit(1);
  const [value] = await (lock ? query.for("share") : query);
  return value;
}
async function preview(tx: ConversationTransaction, id: string, lock = false) {
  const branch = await readPrivateBranch(tx, id, lock); if (!branch) return undefined;
  const body = branch.value.body; const deliveries = body.deliveries ?? []; const member = body.seed.member;
  const input = renderPrivateDelivery(body); const risk = assessPrivateDelivery(body, input);
  const target = await connection(tx, member.connectionId, lock);
  const blocks: PrivateDeliveryBlock[] = [];
  const message = body.messages.at(-1);
  if (!message) blocks.push("no_message");
  if (message && deliveries.some((item) => item.messageId === message.id)) blocks.push("already_requested");
  if (privateDeliveryPending(body)) blocks.push("pending");
  if (!supportedProvider(member.provider) || (target && target.provider !== member.provider)) blocks.push("unsupported_provider");
  if (member.reasoningLevel !== "default" || member.webSearchMode !== "off") blocks.push("unsupported_settings");
  if (!target || !privateBaseUrl(target)) blocks.push("missing_connection");
  if (risk.effectiveProfile === "high") blocks.push("high_risk");
  const used = deliveries.filter((item) => item.originBranchId === id).length;
  // Reserve enough encrypted-body plaintext capacity for a maximally escaped
  // 16k-character reply plus bounded metadata before any dispatch can occur.
  const inputBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (used >= 8 || deliveries.length >= 16 || inputBytes > 65_536 ||
    Buffer.byteLength(JSON.stringify(body), "utf8") + inputBytes + 115_000 > 512 * 1024) blocks.push("capacity");
  const connectionFingerprint = target ? privateConnectionFingerprint(target) : null;
  const fingerprint = hash({ id, revision: branch.value.revision, deliveryVersion: body.deliveryVersion ?? 0, bodyHash: hash(body), connectionFingerprint, input });
  return { branchId: id, fingerprint, eligible: blocks.length === 0, blocks, input, risk,
    provider: member.provider, connectionId: target?.id ?? null, connectionFingerprint, connectionLabel: target?.label ?? null,
    maximumProviderCalls: 1 as const, maxOutputTokens: 1_024 as const, remainingBranchRequests: Math.max(0, 8 - used), inputBytes };
}
export async function previewPrivateDelivery(id: string) {
  return getDatabase().transaction((tx) => preview(tx, id), { isolationLevel: "repeatable read", accessMode: "read only" });
}
export type PrivateDeliveryPreview = NonNullable<Awaited<ReturnType<typeof previewPrivateDelivery>>>;
function changed(body: PrivateBranchBody, deliveries: PrivateDelivery[]): PrivateBranchBody {
  return boundedPrivateBody({ ...body, deliveries, deliveryVersion: (body.deliveryVersion ?? 0) + 1 });
}
export async function enqueuePrivateDelivery(id: string, input: { requestId: string; fingerprint: string }) {
  const request = sendPrivateDeliverySchema.parse(input); const boss = await getBoss();
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await lockConversationMembership(tx);
    const current = await readPrivateBranch(tx, id, true); if (!current) return undefined;
    const existing = (current.value.body.deliveries ?? []).find((item) => item.id === request.requestId);
    if (existing) {
      if (existing.originBranchId !== id || existing.fingerprint !== request.fingerprint) throw new PrivateBranchConflictError();
      return { operationId: existing.id };
    }
    const value = (await preview(tx, id, true))!;
    if (value.fingerprint !== request.fingerprint) throw new PrivateBranchConflictError();
    if (!value.eligible) throw new PrivateDeliveryBlockedError();
    const operation: PrivateDelivery = { id: request.requestId, originBranchId: id, messageId: current.value.body.messages.at(-1)!.id,
      fingerprint: request.fingerprint, connectionId: value.connectionId!, connectionFingerprint: value.connectionFingerprint!,
      request: value.input, status: "prepared", result: null, errorCode: null, submittedAt: null, finishedAt: null, createdAt: new Date().toISOString() };
    const body = changed(current.value.body, [...current.value.body.deliveries ?? [], operation]);
    if (Buffer.byteLength(JSON.stringify(body), "utf8") + 110_000 > 512 * 1024) throw new ConversationSizeError();
    await writePrivateDeliveryBody(tx, id, body);
    const job = await boss.send(PRIVATE_DELIVERY_QUEUE, { branchId: id, operationId: operation.id }, { db: fromDrizzle(tx, sql), singletonKey: operation.id });
    if (!job) throw new PrivateBranchConflictError();
    return { operationId: operation.id };
  });
}
export async function controlPrivateDelivery(id: string, input: { operationId: string; action: "cancel" | "recover" | "discard_unknown"; acknowledgeUnknown?: boolean | undefined }) {
  const request = controlPrivateDeliverySchema.parse(input); const boss = await getBoss();
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await lockConversationMembership(tx);
    const current = await readPrivateBranch(tx, id, true); if (!current) return undefined;
    const deliveries = current.value.body.deliveries ?? [];
    const operation = deliveries.find((item) => item.id === request.operationId && item.originBranchId === id);
    if (!operation) return undefined;
    if (request.action === "recover") {
      if (!["prepared", "submitted"].includes(operation.status)) return { status: operation.status };
      await boss.send(PRIVATE_DELIVERY_QUEUE, { branchId: id, operationId: operation.id }, { db: fromDrizzle(tx, sql) });
    } else {
      const status = request.action === "cancel" ? "cancelled" : "discarded";
      if (operation.status === status) return { status };
      if (request.action === "cancel" ? operation.status !== "prepared" : operation.status !== "outcome_unknown" || !request.acknowledgeUnknown) throw new PrivateBranchConflictError();
      operation.status = status; operation.finishedAt = new Date().toISOString();
      await writePrivateDeliveryBody(tx, id, changed(current.value.body, deliveries));
    }
    return { status: operation.status };
  });
}
export type PrivateDeliveryExecutionResult = { result: PrivateDeliveryResult } | { errorCode: string; outcome: "known" | "unknown"; usage?: PrivateDeliveryUsage };
export type PrivateDeliveryExecutor = (operation: PrivateDelivery, target: { provider: "openai-compatible" | "anthropic" | "openai"; apiKey: string; baseUrl: string; endpointPreset: string }, branchId: string) => Promise<PrivateDeliveryExecutionResult>;
export async function executePrivateDelivery(id: string, operationId: string, execute: PrivateDeliveryExecutor) {
  // A session lock spans network work without holding a transaction. Lost
  // sessions cannot authorize another submission of an already submitted id.
  const lease = new Client({ connectionString: process.env.DATABASE_URL });
  let locked = false; let sessionLost = false;
  lease.on("error", () => { sessionLost = true; });
  try {
    await lease.connect();
    const lock = await lease.query<{ acquired: boolean }>("select pg_try_advisory_lock(hashtext($1), hashtext($2)) as acquired", ["private-delivery-v1", id]);
    locked = lock.rows[0]!.acquired;
    if (!locked) throw new Error("Private delivery is already active.");
    const claimed = await getDatabase().transaction(async (tx) => {
      await lockConversationMembership(tx);
      const current = await readPrivateBranch(tx, id, true); if (!current) return undefined;
      const deliveries = current.value.body.deliveries ?? [];
      const operation = deliveries.find((item) => item.id === operationId && item.originBranchId === id);
      if (!operation || !["prepared", "submitted"].includes(operation.status)) return undefined;
      if (operation.status === "submitted") {
        operation.status = "outcome_unknown"; operation.errorCode = "interrupted_submission"; operation.finishedAt = new Date().toISOString();
        await writePrivateDeliveryBody(tx, id, changed(current.value.body, deliveries)); return undefined;
      }
      const target = await connection(tx, operation.connectionId, true);
      const member = current.value.body.seed.member;
      if (!target || !supportedProvider(target.provider) || target.provider !== member.provider || !privateBaseUrl(target) ||
        member.reasoningLevel !== "default" || member.webSearchMode !== "off" || privateConnectionFingerprint(target) !== operation.connectionFingerprint ||
        assessPrivateDelivery(current.value.body, operation.request).effectiveProfile === "high") {
        operation.status = "failed"; operation.errorCode = "connection_or_risk_changed"; operation.finishedAt = new Date().toISOString();
        await writePrivateDeliveryBody(tx, id, changed(current.value.body, deliveries)); return undefined;
      }
      const apiKey = decryptText(target.secretCiphertext, `provider-connection:${target.id}:secret`);
      operation.status = "submitted"; operation.submittedAt = new Date().toISOString();
      await writePrivateDeliveryBody(tx, id, changed(current.value.body, deliveries));
      return { operation, target: { provider: target.provider, apiKey, baseUrl: privateBaseUrl(target)!, endpointPreset: target.endpointPreset } };
    });
    if (!claimed) return;
    let result: PrivateDeliveryExecutionResult;
    try {
      if (sessionLost) throw new Error("Session lost.");
      result = await execute(claimed.operation, claimed.target, id);
      if ("result" in result) result = { result: privateDeliveryResultSchema.parse(result.result) };
    } catch { result = { outcome: "unknown", errorCode: "execution_interrupted" }; }
    await getDatabase().transaction(async (tx) => {
      await lockConversationMembership(tx);
      const current = await readPrivateBranch(tx, id, true); if (!current) return;
      const deliveries = current.value.body.deliveries ?? [];
      const operation = deliveries.find((item) => item.id === operationId && item.originBranchId === id);
      if (!operation || !["submitted", "outcome_unknown"].includes(operation.status)) return;
      operation.finishedAt = new Date().toISOString();
      if ("result" in result) {
        operation.status = "succeeded"; operation.result = result.result; operation.errorCode = null;
        const { model, remoteResponseId, inputTokens, outputTokens, tokenDetails } = result.result;
        operation.usage = { model, remoteResponseId, inputTokens, outputTokens, tokenDetails };
      } else {
        operation.status = result.outcome === "unknown" ? "outcome_unknown" : "failed";
        operation.errorCode = /^[a-z0-9_]{1,100}$/.test(result.errorCode) ? result.errorCode : "provider_failure";
        operation.usage = result.usage ? privateDeliveryUsageSchema.parse(result.usage) : null;
      }
      await writePrivateDeliveryBody(tx, id, changed(current.value.body, deliveries));
    });
  } finally {
    if (locked && !sessionLost) await lease.query("select pg_advisory_unlock(hashtext($1), hashtext($2))", ["private-delivery-v1", id]).catch(() => undefined);
    await lease.end().catch(() => undefined);
  }
}
