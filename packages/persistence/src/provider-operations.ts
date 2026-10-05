import { createHash, randomUUID } from "node:crypto";
import type {
  ProviderCitation,
  ProviderOutput,
  ReviewRoundCount,
  ResolveProviderOperationRequest,
  ProviderTokenDetails,
  ExecutionBudgetStatus,
  PriceSnapshot,
  TokenCostEstimate,
  BillingProjection,
} from "@deliberation-ai/contracts";
import { executionLimitsSchema, reviewRoundCountSchema } from "@deliberation-ai/contracts";
import { executionReservationAllowed, estimateTokenCost, picoUsdToUsd, usdToPico } from "@deliberation-ai/domain";
import { readRunKnowledgePacket, authorizeKnowledgePacketInSnapshot } from "./knowledge-packets";
import { lockConversationMembership } from "./conversation-membership";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { getDatabase } from "./database";
import { decryptJson, decryptText, encryptJson, encryptText } from "./crypto";
import { getBoss, RUN_COUNCIL_QUEUE } from "./queue";
import { LOCAL_OWNER_ID } from "./owner";
import { providerBillingClaims, providerBillingRecords, providerConnections, providerOperations, providerPriceSnapshots, runEvents, runs } from "./schema";
import { readBillingStates, projectBillingState } from "./provider-billing";
import { hydratePriceSnapshot, pricingFingerprint } from "./provider-pricing";
import { addTokenDetails, emptyTokenDetailTotals, readTokenDetails, type TokenDetailTotals } from "./provider-usage";

export type ProviderOperationStatus =
  | "prepared"
  | "submitted"
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "discarded"
  | "retry_authorized";

export type ProviderOperationReceipt = {
  id: string;
  runId: string;
  memberId: string;
  round: ReviewRoundCount;
  attempt: number;
  provider: string;
  model: string;
  status: ProviderOperationStatus;
  remoteResponseId: string | null;
  errorCode: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type OperatorProviderOperation = ProviderOperationReceipt & {
  runStatus: string;
};

export type RunProviderUsage = {
  runId: string;
  reportedInputTokens: number;
  reportedOutputTokens: number;
  operationCount: number;
  inputReportCount: number;
  outputReportCount: number;
  uncertainUsageCount: number;
  recentOperationsTruncated: boolean;
  tokenDetails: TokenDetailTotals;
  executionBudget: ExecutionBudgetStatus | null;
  costLedger: { currency: "USD"; estimatedTokenSubtotalUsd: string | null; estimatedOperations: number; unavailableOperations: number; excludedUnsubmittedOperations: number };
  billingLedger: { currency: "USD"; recordedSubtotalUsd: string | null; recordedOperations: number; pendingOperations: number; mismatchedOperations: number; voidedOperations: number; reallocatedOperations: number };
  operations: Array<{
    id: string;
    memberId: string;
    round: ReviewRoundCount;
    attempt: number;
    provider: string;
    model: string;
    status: ProviderOperationStatus;
    inputTokens: number | null;
    outputTokens: number | null;
    tokenDetails: ProviderTokenDetails | null;
    costEstimate: TokenCostEstimate | null;
    billing: BillingProjection | null;
  }>;
};

function projectCost(row: Pick<typeof providerOperations.$inferSelect, "id" | "inputTokens" | "outputTokens" | "resultMetadataCiphertext" | "costEstimateCiphertext">): TokenCostEstimate | null {
  if (!row.costEstimateCiphertext) return null;
  const cost = decryptJson<TokenCostEstimate>(row.costEstimateCiphertext, `provider-operation:${row.id}:cost-estimate`);
  const metadata = row.resultMetadataCiphertext ? decryptJson<StoredProviderMetadata>(row.resultMetadataCiphertext, `provider-operation:${row.id}:metadata`) : undefined;
  const fingerprint = pricingFingerprint({ inputTokens: row.inputTokens, outputTokens: row.outputTokens,
    details: readTokenDetails(metadata), returnedModel: metadata?.model ?? null });
  return cost.usageFingerprint === fingerprint ? cost : { ...cost, status: "unavailable", amountPicoUsd: null, amountUsd: null,
    components: [], reason: "usage_changed_after_estimate" };
}

export async function getRunProviderUsage(runId: string): Promise<RunProviderUsage | undefined> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: runs.id, limits: runs.executionLimitsCiphertext }).from(runs)
      .where(and(eq(runs.id, runId), eq(runs.ownerId, LOCAL_OWNER_ID))).limit(1);
    if (!owned) return undefined;

    const [totals] = await tx.select({
      operationCount: sql<number>`count(*)::integer`,
      reportedInputTokens: sql<number>`coalesce(sum(${providerOperations.inputTokens}), 0)::double precision`,
      reportedOutputTokens: sql<number>`coalesce(sum(${providerOperations.outputTokens}), 0)::double precision`,
      inputReportCount: sql<number>`count(${providerOperations.inputTokens})::integer`,
      outputReportCount: sql<number>`count(${providerOperations.outputTokens})::integer`,
      uncertainUsageCount: sql<number>`count(*) filter (where ${providerOperations.status} <> 'prepared' and (${providerOperations.inputTokens} is null or ${providerOperations.outputTokens} is null))::integer`,
      submittedCalls: sql<number>`count(${providerOperations.reservedOutputTokens})::integer`,
      reservedOutputTokens: sql<number>`coalesce(sum(${providerOperations.reservedOutputTokens}), 0)::integer`,
    }).from(providerOperations).where(eq(providerOperations.runId, runId));
    const rows = await tx.select({
      id: providerOperations.id,
      memberId: providerOperations.memberId,
      round: providerOperations.round,
      attempt: providerOperations.attempt,
      provider: providerOperations.provider,
      model: providerOperations.model,
      status: providerOperations.status,
      runId: providerOperations.runId,
      remoteResponseId: providerOperations.remoteResponseId,
      inputTokens: providerOperations.inputTokens,
      outputTokens: providerOperations.outputTokens,
      resultMetadataCiphertext: providerOperations.resultMetadataCiphertext,
      costEstimateCiphertext: providerOperations.costEstimateCiphertext,
    }).from(providerOperations).where(eq(providerOperations.runId, runId))
      .orderBy(desc(providerOperations.startedAt), desc(providerOperations.id)).limit(101);

    // Bounded pages include all attempts, while the UI keeps only the latest 100.
    // One read snapshot prevents the summary and its denominator racing the worker.
    const tokenDetails = emptyTokenDetailTotals();
    let costTotal = BigInt(0);
    let estimatedOperations = 0;
    let unavailableOperations = 0;
    let excludedUnsubmittedOperations = 0;
    let billingTotal = BigInt(0);
    let recordedOperations = 0;
    let pendingOperations = 0;
    let mismatchedOperations = 0;
    let voidedOperations = 0;
    let reallocatedOperations = 0;
    const recentBilling = new Map<string, BillingProjection>();
    const recentIds = new Set(rows.slice(0, 100).map((row) => row.id));
    let cursor: string | undefined;
    for (;;) {
      const page = await tx.select({ id: providerOperations.id, runId: providerOperations.runId, provider: providerOperations.provider,
        model: providerOperations.model, remoteResponseId: providerOperations.remoteResponseId, submittedAt: providerOperations.submittedAt,
        status: providerOperations.status,
        inputTokens: providerOperations.inputTokens, outputTokens: providerOperations.outputTokens,
        resultMetadataCiphertext: providerOperations.resultMetadataCiphertext, costEstimateCiphertext: providerOperations.costEstimateCiphertext })
        .from(providerOperations).where(and(eq(providerOperations.runId, runId),
          cursor ? gt(providerOperations.id, cursor) : undefined)).orderBy(asc(providerOperations.id)).limit(100);
      const billRows = page.length ? await tx.select().from(providerBillingRecords).where(and(eq(providerBillingRecords.ownerId, LOCAL_OWNER_ID),
        inArray(providerBillingRecords.operationId, page.map((row) => row.id)))).orderBy(desc(providerBillingRecords.recordedAt), desc(providerBillingRecords.id)) : [];
      const states = await readBillingStates(billRows, tx);
      const claims = page.length ? await tx.select().from(providerBillingClaims).where(and(eq(providerBillingClaims.ownerId, LOCAL_OWNER_ID), inArray(providerBillingClaims.operationId, page.map((row) => row.id)))) : [];
      for (const row of page) {
        const cost = projectCost(row);
        const claim = claims.find((claim) => claim.operationId === row.id);
        const state = claim ? states.find((state) => state.id === claim.recordId) : states.find((state) => state.operationId === row.id);
        if (claim && !state) throw new Error("Owned billing claim points to an unavailable record.");
        const bill = state ? projectBillingState(state, row) : null;
        if (bill?.status === "owner_recorded") { billingTotal += usdToPico(bill.totalUsd); recordedOperations += 1; }
        else if (bill?.status === "voided") { voidedOperations += 1; pendingOperations += 1; }
        else if (bill?.status === "reallocated") { reallocatedOperations += 1; pendingOperations += 1; }
        else if (bill) mismatchedOperations += 1;
        else if (row.submittedAt || (row.status !== "prepared" && cost?.status !== "not_submitted")) pendingOperations += 1;
        if (bill && recentIds.has(row.id)) recentBilling.set(row.id, bill);
        addTokenDetails(tokenDetails, row.resultMetadataCiphertext
          ? readTokenDetails(decryptJson(row.resultMetadataCiphertext, `provider-operation:${row.id}:metadata`)) : null);
        if (cost?.status === "estimated" && cost.amountPicoUsd !== null) {
          costTotal += BigInt(cost.amountPicoUsd); estimatedOperations += 1;
        } else if (cost?.status === "not_submitted") excludedUnsubmittedOperations += 1;
        else unavailableOperations += 1;
      }
      if (page.length < 100) break;
      cursor = page[page.length - 1]!.id;
    }

    const limits = owned.limits ? executionLimitsSchema.parse(decryptJson(owned.limits, `run:${runId}:execution-limits`)) : null;
    return {
      runId,
      reportedInputTokens: totals?.reportedInputTokens ?? 0,
      reportedOutputTokens: totals?.reportedOutputTokens ?? 0,
      operationCount: totals?.operationCount ?? 0,
      inputReportCount: totals?.inputReportCount ?? 0,
      outputReportCount: totals?.outputReportCount ?? 0,
      uncertainUsageCount: totals?.uncertainUsageCount ?? 0,
      recentOperationsTruncated: rows.length > 100,
      tokenDetails,
      billingLedger: { currency: "USD", recordedSubtotalUsd: recordedOperations > 0 ? picoUsdToUsd(billingTotal) : null,
        recordedOperations, pendingOperations, mismatchedOperations, voidedOperations, reallocatedOperations },
      costLedger: { currency: "USD", estimatedTokenSubtotalUsd: estimatedOperations > 0 ? picoUsdToUsd(costTotal) : null,
        estimatedOperations, unavailableOperations, excludedUnsubmittedOperations },
      executionBudget: limits ? {
        limits, submittedCalls: totals?.submittedCalls ?? 0, reservedOutputTokens: totals?.reservedOutputTokens ?? 0,
        remainingCalls: Math.max(0, limits.maxProviderCalls - (totals?.submittedCalls ?? 0)),
        remainingOutputTokens: Math.max(0, limits.maxReservedOutputTokens - (totals?.reservedOutputTokens ?? 0)),
      } : null,
      operations: rows.slice(0, 100).map(({ resultMetadataCiphertext, costEstimateCiphertext, runId: _runId, remoteResponseId: _remoteId, ...row }) => ({
        ...row, tokenDetails: resultMetadataCiphertext
          ? readTokenDetails(decryptJson(resultMetadataCiphertext, `provider-operation:${row.id}:metadata`)) : null,
        costEstimate: projectCost({ ...row, resultMetadataCiphertext, costEstimateCiphertext }),
        billing: recentBilling.get(row.id) ?? null,
        round: reviewRoundCountSchema.parse(row.round),
        status: row.status as ProviderOperationStatus,
      })),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

type StoredProviderMetadata = {
  provider: string;
  model: string;
  remoteResponseId: string;
  inputTokens?: number;
  outputTokens?: number;
  tokenDetails?: ProviderTokenDetails;
  citations?: ProviderCitation[];
};

function receipt(row: typeof providerOperations.$inferSelect): ProviderOperationReceipt {
  return {
    id: row.id,
    runId: row.runId,
    memberId: row.memberId,
    round: reviewRoundCountSchema.parse(row.round),
    attempt: row.attempt,
    provider: row.provider,
    model: row.model,
    status: row.status as ProviderOperationStatus,
    remoteResponseId: row.remoteResponseId,
    errorCode: row.errorCode,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function fingerprintProviderRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function prepareProviderOperation(input: {
  runId: string;
  memberId: string;
  round?: ReviewRoundCount;
  provider: string;
  model: string;
  requestFingerprint: string;
}): Promise<ProviderOperationReceipt> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    // Serialize receipt creation and admission with the same run -> operation lock order.
    const [owned] = await tx.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.id, input.runId), eq(runs.ownerId, LOCAL_OWNER_ID))).for("update").limit(1);
    if (!owned) throw new Error("Provider operation run was not found.");
    const [existing] = await tx
      .select()
      .from(providerOperations)
      .where(
        and(
          eq(providerOperations.runId, input.runId),
          eq(providerOperations.memberId, input.memberId),
          eq(providerOperations.round, input.round ?? 0),
        ),
      )
      .orderBy(desc(providerOperations.attempt))
      .limit(1);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new Error("Provider operation fingerprint conflict.");
      }
      if (existing.status !== "retry_authorized") return receipt(existing);
    }
    const [created] = await tx
      .insert(providerOperations)
      .values({
        id: randomUUID(),
        status: "prepared",
        attempt: (existing?.attempt ?? 0) + 1,
        ...input,
        round: input.round ?? 0,
      })
      .returning();
    if (!created) throw new Error("Provider operation receipt could not be created.");
    return receipt(created);
  });
}

/** Only the caller that atomically claims a prepared receipt may contact the provider. */
export class ExecutionLimitsExceededError extends Error {
  constructor(readonly code: "execution_limit_exhausted" | "output_limit_mismatch" | "run_not_active" | "knowledge_scope_revoked") {
    super(code === "knowledge_scope_revoked" ? "Kaynak erişimi iptal edildi; yeni gönderim engellendi." : code === "run_not_active" ? "Çalışma artık çağrı başlatmaya uygun değil." : code === "output_limit_mismatch"
      ? "İsteğin yanıt kotası çalışma için dondurulan kotayla eşleşmiyor." : "Çalışmanın çağrı veya toplam yanıt kotası tükendi.");
    this.name = "ExecutionLimitsExceededError";
  }
}

export async function claimProviderOperationSubmission(id: string, maxOutputTokens?: number, pricingConnection?: { id: string; revision: number }): Promise<boolean> {
  return getDatabase().transaction(async (tx) => {
    await lockConversationMembership(tx);
    const [candidate] = await tx.select({ runId: providerOperations.runId }).from(providerOperations)
      .where(eq(providerOperations.id, id)).limit(1);
    if (!candidate) return false;
    const [run] = await tx.select().from(runs)
      .where(and(eq(runs.id, candidate.runId), eq(runs.ownerId, LOCAL_OWNER_ID))).for("update").limit(1);
    if (!run) return false;
    const [operation] = await tx.select().from(providerOperations).where(eq(providerOperations.id, id)).for("update").limit(1);
    if (!operation || operation.status !== "prepared") return false;
    if (!["queued", "running"].includes(run.status)) throw new ExecutionLimitsExceededError("run_not_active");
    const packet = readRunKnowledgePacket(run);
    if (packet && operation.round === 0) {
      try { await authorizeKnowledgePacketInSnapshot(tx, packet); }
      catch { throw new ExecutionLimitsExceededError("knowledge_scope_revoked"); }
    }
    const limits = run.executionLimitsCiphertext
      ? executionLimitsSchema.parse(decryptJson(run.executionLimitsCiphertext, `run:${run.id}:execution-limits`)) : null;
    if (limits) {
      if (maxOutputTokens !== limits.maxOutputTokensPerCall) throw new ExecutionLimitsExceededError("output_limit_mismatch");
      const [usage] = await tx.select({ calls: sql<number>`count(${providerOperations.reservedOutputTokens})::integer`,
        tokens: sql<number>`coalesce(sum(${providerOperations.reservedOutputTokens}), 0)::integer` }).from(providerOperations)
        .where(eq(providerOperations.runId, run.id));
      if (!executionReservationAllowed(limits, usage?.calls ?? 0, usage?.tokens ?? 0)) throw new ExecutionLimitsExceededError("execution_limit_exhausted");
    } else if (maxOutputTokens !== undefined) throw new ExecutionLimitsExceededError("output_limit_mismatch");
    let priceSnapshotId: string | null = null;
    if (pricingConnection && run.membersCiphertext) {
      const members = decryptJson<Array<{ id: string; connectionId?: string; model: string; provider: string; receiveAttachments?: boolean }>>(run.membersCiphertext, `run:${run.id}:members`);
      const member = members.find((candidate) => candidate.id === operation.memberId);
      const hasImages = operation.round === 0 && member?.receiveAttachments && run.attachmentsCiphertext
        && decryptJson<Array<{ mimeType: string }>>(run.attachmentsCiphertext, `run:${run.id}:attachments`).some((item) => item.mimeType !== "application/pdf");
      if (!hasImages && member?.connectionId === pricingConnection.id && member.model === operation.model && member.provider === operation.provider) {
        const [connection] = await tx.select().from(providerConnections).where(and(eq(providerConnections.id, pricingConnection.id),
          eq(providerConnections.ownerId, LOCAL_OWNER_ID), eq(providerConnections.revision, pricingConnection.revision),
          eq(providerConnections.provider, operation.provider))).for("share").limit(1);
        if (connection) {
          const [candidatePrice] = await tx.select().from(providerPriceSnapshots).where(and(eq(providerPriceSnapshots.ownerId, LOCAL_OWNER_ID),
            eq(providerPriceSnapshots.connectionId, connection.id), eq(providerPriceSnapshots.connectionRevision, connection.revision),
            eq(providerPriceSnapshots.model, operation.model))).orderBy(desc(providerPriceSnapshots.recordedAt), desc(providerPriceSnapshots.id)).limit(1);
          if (candidatePrice) {
            const price = hydratePriceSnapshot(candidatePrice);
            if (Date.parse(price.observedAt) <= Date.now() && Date.parse(price.validUntil) > Date.now()) priceSnapshotId = price.id;
          }
        }
      }
    }
    await tx.update(providerOperations).set({ status: "submitted", reservedOutputTokens: limits?.maxOutputTokensPerCall ?? null,
      priceSnapshotId, submittedAt: new Date() })
      .where(eq(providerOperations.id, id));
    return true;
  });
}

export async function updateProviderOperation(
  id: string,
  update: {
    status: ProviderOperationStatus;
    remoteResponseId?: string;
    errorCode?: string;
    inputTokens?: number;
    outputTokens?: number;
    rawText?: string;
    parsedOutput?: ProviderOutput;
    metadata?: StoredProviderMetadata;
  },
): Promise<ProviderOperationReceipt> {
  const sensitive = {
    ...(update.rawText !== undefined
      ? { rawTextCiphertext: encryptText(update.rawText, `provider-operation:${id}:raw`) }
      : {}),
    ...(update.parsedOutput !== undefined
      ? { parsedOutputCiphertext: encryptJson(update.parsedOutput, `provider-operation:${id}:parsed`) }
      : {}),
    ...(update.metadata
      ? { resultMetadataCiphertext: encryptJson(update.metadata, `provider-operation:${id}:metadata`) }
      : {}),
  };
  const {
    rawText: _rawText,
    parsedOutput: _parsedOutput,
    metadata: _metadata,
    ...publicUpdate
  } = update;
  return getDatabase().transaction(async (tx) => {
    const [existing] = await tx.select().from(providerOperations).where(eq(providerOperations.id, id)).for("update").limit(1);
    if (!existing) throw new Error("Provider operation receipt was not found.");
    let costEstimateCiphertext = existing.costEstimateCiphertext;
    // Freeze the first outcome's valuation. Later counter changes must not silently rewrite history.
    if (!costEstimateCiphertext && ["succeeded", "failed", "outcome_unknown"].includes(update.status)) {
      let price: PriceSnapshot | null = null;
      let priceIntegrityUnavailable = false;
      if (existing.priceSnapshotId) {
        const [storedPrice] = await tx.select().from(providerPriceSnapshots).where(and(eq(providerPriceSnapshots.id, existing.priceSnapshotId),
          eq(providerPriceSnapshots.ownerId, LOCAL_OWNER_ID))).limit(1);
        if (storedPrice) {
          try { price = hydratePriceSnapshot(storedPrice); }
          catch { priceIntegrityUnavailable = true; }
        }
      }
      const metadata = update.metadata ?? (existing.resultMetadataCiphertext
        ? decryptJson<StoredProviderMetadata>(existing.resultMetadataCiphertext, `provider-operation:${id}:metadata`) : undefined);
      const usage = { inputTokens: update.inputTokens ?? existing.inputTokens, outputTokens: update.outputTokens ?? existing.outputTokens,
        details: readTokenDetails(metadata), returnedModel: metadata?.model ?? null };
      const estimate = estimateTokenCost({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, details: usage.details,
        ...(metadata?.model ? { returnedModel: metadata.model } : {}), price, submitted: existing.submittedAt !== null,
        usageFingerprint: pricingFingerprint(usage) });
      if (priceIntegrityUnavailable) {
        estimate.reason = "price_integrity_unconfirmed";
        estimate.priceSnapshotId = existing.priceSnapshotId;
      }
      costEstimateCiphertext = encryptJson(estimate, `provider-operation:${id}:cost-estimate`);
    }
    const [row] = await tx
      .update(providerOperations)
      .set({
        ...publicUpdate,
        ...sensitive,
        costEstimateCiphertext,
        finishedAt: [
          "succeeded",
          "failed",
          "outcome_unknown",
          "discarded",
          "retry_authorized",
        ].includes(update.status)
          ? new Date()
          : undefined,
      })
      .where(eq(providerOperations.id, id))
      .returning();
    if (!row) throw new Error("Provider operation receipt was not found.");
    return receipt(row);
  });
}

export async function loadProviderOperationFailureRawText(id: string): Promise<string | undefined> {
  const [row] = await getDatabase()
    .select({ status: providerOperations.status, rawTextCiphertext: providerOperations.rawTextCiphertext })
    .from(providerOperations)
    .where(eq(providerOperations.id, id))
    .limit(1);
  if (row?.status !== "failed" || !row.rawTextCiphertext) return undefined;
  return decryptText(row.rawTextCiphertext, `provider-operation:${id}:raw`);
}

export async function listProviderOperationsNeedingAction(): Promise<
  OperatorProviderOperation[]
> {
  const rows = await getDatabase()
    .select({ operation: providerOperations, runStatus: runs.status })
    .from(providerOperations)
    .innerJoin(runs, eq(runs.id, providerOperations.runId))
    .where(
      and(
        eq(runs.ownerId, LOCAL_OWNER_ID),
        eq(providerOperations.status, "outcome_unknown"),
      ),
    )
    .orderBy(asc(providerOperations.startedAt));
  return rows.map((row) => ({ ...receipt(row.operation), runStatus: row.runStatus }));
}

export class ProviderOperationResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderOperationResolutionError";
  }
}

export async function resolveProviderOperation(
  operationId: string,
  action: ResolveProviderOperationRequest["action"],
): Promise<{ operation: ProviderOperationReceipt; requeued: boolean } | undefined> {
  const db = getDatabase();
  const boss = action === "authorize_retry" ? await getBoss() : undefined;
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ runId: providerOperations.runId })
      .from(providerOperations)
      .where(eq(providerOperations.id, operationId))
      .limit(1);
    if (!candidate) return undefined;
    const [run] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.id, candidate.runId), eq(runs.ownerId, LOCAL_OWNER_ID)))
      .for("update")
      .limit(1);
    if (!run) return undefined;
    const [operation] = await tx.select().from(providerOperations).where(eq(providerOperations.id, operationId)).for("update").limit(1);
    if (!operation) return undefined;
    if (operation.status !== "outcome_unknown") {
      throw new ProviderOperationResolutionError(
        "Sağlayıcı operasyonu artık operatör kararı beklemiyor.",
      );
    }

    if (action === "authorize_retry" && run.executionLimitsCiphertext) {
      const limits = executionLimitsSchema.parse(decryptJson(run.executionLimitsCiphertext, `run:${run.id}:execution-limits`));
      const [usage] = await tx.select({ calls: sql<number>`count(${providerOperations.reservedOutputTokens})::integer`,
        tokens: sql<number>`coalesce(sum(${providerOperations.reservedOutputTokens}), 0)::integer` }).from(providerOperations)
        .where(eq(providerOperations.runId, run.id));
      if (!executionReservationAllowed(limits, usage?.calls ?? 0, usage?.tokens ?? 0)) {
        throw new ProviderOperationResolutionError("Çalışmanın çağrı veya yanıt kotası tükendi; yeniden deneme başlatılamaz.");
      }
    }
    const nextStatus = action === "discard" ? "discarded" : "retry_authorized";
    const [resolved] = await tx
      .update(providerOperations)
      .set({
        status: nextStatus,
        errorCode:
          action === "discard" ? "operator_discarded" : operation.errorCode,
        finishedAt: new Date(),
      })
      .where(eq(providerOperations.id, operationId))
      .returning();
    if (!resolved) throw new Error("Provider operation could not be resolved.");

    if (action === "discard") {
      const [updatedRun] = await tx
        .update(runs)
        .set({
          lastSequence: sql`${runs.lastSequence} + 1`,
          stateVersion: sql`${runs.stateVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, run.id))
        .returning();
      if (!updatedRun) throw new Error("Run could not record the operator action.");
      await tx.insert(runEvents).values({
        runId: run.id,
        sequence: updatedRun.lastSequence,
        type: "provider.operation_discarded",
        payload: { operationId, memberId: operation.memberId, attempt: operation.attempt },
      });
      return { operation: receipt(resolved), requeued: false };
    }

    if (!["completed", "partially_completed", "failed"].includes(run.status)) {
      throw new ProviderOperationResolutionError(
        "Yalnızca tamamlanmış bir çalışma yeniden sıraya alınabilir.",
      );
    }
    if (!boss) throw new Error("Queue is unavailable.");
    const jobId = await boss.send(
      RUN_COUNCIL_QUEUE,
      { runId: run.id },
      {
        db: fromDrizzle(tx, sql),
        singletonKey: `${run.id}:operator-retry:${operation.attempt + 1}`,
      },
    );
    if (!jobId) throw new Error("Retry queue job could not be created.");
    const [requeued] = await tx
      .update(runs)
      .set({
        status: "queued",
        queueJobId: jobId,
        report: null,
        reportCiphertext: null,
        finishedAt: null,
        lastSequence: sql`${runs.lastSequence} + 1`,
        stateVersion: sql`${runs.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, run.id))
      .returning();
    if (!requeued) throw new Error("Run could not be requeued.");
    await tx.insert(runEvents).values({
      runId: run.id,
      sequence: requeued.lastSequence,
      type: "provider.retry_authorized",
      payload: {
        status: "queued",
        operationId,
        memberId: operation.memberId,
        previousAttempt: operation.attempt,
      },
    });
    return { operation: receipt(resolved), requeued: true };
  });
}

export async function loadProviderOperationResult(id: string): Promise<
  | {
      rawText: string;
      parsed: ProviderOutput;
      metadata: StoredProviderMetadata;
    }
  | undefined
> {
  const [row] = await getDatabase()
    .select()
    .from(providerOperations)
    .where(eq(providerOperations.id, id))
    .limit(1);
  if (
    !row ||
    row.status !== "succeeded" ||
    !row.rawTextCiphertext ||
    !row.parsedOutputCiphertext ||
    !row.remoteResponseId
  ) {
    return undefined;
  }
  const storedMetadata = row.resultMetadataCiphertext
    ? decryptJson<StoredProviderMetadata>(
        row.resultMetadataCiphertext,
        `provider-operation:${id}:metadata`,
      )
    : undefined;
  return {
    rawText: decryptText(row.rawTextCiphertext, `provider-operation:${id}:raw`),
    parsed: decryptJson<ProviderOutput>(
      row.parsedOutputCiphertext,
      `provider-operation:${id}:parsed`,
    ),
    metadata:
      storedMetadata ?? {
        provider: row.provider,
        model: row.model,
        remoteResponseId: row.remoteResponseId,
        ...(row.inputTokens !== null ? { inputTokens: row.inputTokens } : {}),
        ...(row.outputTokens !== null ? { outputTokens: row.outputTokens } : {}),
      },
  };
}
