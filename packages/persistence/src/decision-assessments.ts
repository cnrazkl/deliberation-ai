import { createHash, randomUUID } from "node:crypto";
import type {
  CreateDecisionAssessmentRequest,
  DecisionAssessmentInput,
  DecisionAssessmentResult,
  DecisionAssessmentStatus,
  DecisionMode,
  ResolveDecisionOperationRequest,
} from "@deliberation-ai/evaluation";
import {
  decisionAssessmentInputSchema,
  decisionAssessmentResultSchema,
} from "@deliberation-ai/evaluation";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { decryptJson, decryptText, encryptJson } from "./crypto";
import { getDatabase } from "./database";
import { getOwnerId } from "./owner";
import { getBoss, RUN_DECISION_ASSESSMENT_QUEUE } from "./queue";
import {
  claims,
  decisionAssessments,
  decisionConnections,
  decisionOperations,
  evidenceSources,
  runs,
} from "./schema";

export type DecisionAssessmentProjection = {
  id: string;
  runId: string;
  claimId: string;
  sourceId: string;
  connectionId: string;
  mode: DecisionMode;
  status: DecisionAssessmentStatus;
  rubricVersion: "source-support-v1";
  requestedModel: string;
  returnedModel: string | null;
  result: DecisionAssessmentResult | null;
  errorCode: string | null;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type DecisionAssessmentWork = {
  assessmentId: string;
  connectionId: string;
  requestFingerprint: string;
  input: DecisionAssessmentInput;
};

export type DecisionOperationStatus =
  | "prepared"
  | "submitted"
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "discarded"
  | "retry_authorized";

export type DecisionOperationReceipt = {
  id: string;
  assessmentId: string;
  batchId: string;
  attempt: number;
  provider: string;
  model: string;
  status: DecisionOperationStatus;
  errorCode: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type OperatorDecisionOperation = DecisionOperationReceipt & {
  runId: string;
  claimId: string;
};

export class DecisionAssessmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionAssessmentInputError";
  }
}

export class DecisionOperationResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionOperationResolutionError";
  }
}

export const fingerprintDecisionRequest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function mapOperation(row: typeof decisionOperations.$inferSelect): DecisionOperationReceipt {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    batchId: row.batchId,
    attempt: row.attempt,
    provider: row.provider,
    model: row.model,
    status: row.status as DecisionOperationStatus,
    errorCode: row.errorCode,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function mapAssessment(
  row: typeof decisionAssessments.$inferSelect,
  currentRunVersion: number,
): DecisionAssessmentProjection {
  const result = row.resultCiphertext
    ? decisionAssessmentResultSchema.parse(
        decryptJson<unknown>(row.resultCiphertext, `decision-assessment:${row.id}:result`),
      )
    : null;
  return {
    id: row.id,
    runId: row.runId,
    claimId: row.reportClaimId,
    sourceId: row.sourceId,
    connectionId: row.connectionId,
    mode: row.mode as DecisionMode,
    status: row.status as DecisionAssessmentStatus,
    rubricVersion: "source-support-v1",
    requestedModel: row.requestedModel,
    returnedModel: row.returnedModel,
    result,
    errorCode: row.errorCode,
    isCurrent: row.runStateVersion === currentRunVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function createDecisionAssessment(
  request: CreateDecisionAssessmentRequest,
): Promise<DecisionAssessmentProjection> {
  const boss = await getBoss();
  return getDatabase().transaction(async (tx) => {
    const [claim] = await tx
      .select({
        id: claims.id,
        statement: claims.statement,
        statementCiphertext: claims.statementCiphertext,
        runStateVersion: runs.stateVersion,
        runStatus: runs.status,
      })
      .from(claims)
      .innerJoin(runs, eq(runs.id, claims.runId))
      .where(
        and(
          eq(runs.ownerId, getOwnerId()),
          eq(runs.id, request.runId),
          eq(claims.reportClaimId, request.claimId),
        ),
      )
      .limit(1);
    if (!claim || !["completed", "partially_completed"].includes(claim.runStatus)) {
      throw new DecisionAssessmentInputError("Tamamlanmış çalışma veya iddia bulunamadı.");
    }
    const [source] = await tx
      .select()
      .from(evidenceSources)
      .where(
        and(
          eq(evidenceSources.ownerId, getOwnerId()),
          eq(evidenceSources.id, request.sourceId),
          eq(evidenceSources.runId, request.runId),
          eq(evidenceSources.claimId, claim.id),
        ),
      )
      .limit(1);
    if (!source?.excerptCiphertext) {
      throw new DecisionAssessmentInputError("Seçilen iddiaya ait mühürlü kaynak alıntısı bulunamadı.");
    }
    if (source.candidateProvenanceCiphertext) throw new DecisionAssessmentInputError("Aday kutusu TypeSafe gönderimi sağlamaz; bu kayıt yalnızca insan incelemesi içindir.");
    const [connection] = await tx
      .select({ id: decisionConnections.id })
      .from(decisionConnections)
      .where(
        and(
          eq(decisionConnections.ownerId, getOwnerId()),
          eq(decisionConnections.id, request.connectionId),
        ),
      )
      .limit(1);
    if (!connection) throw new DecisionAssessmentInputError("TypeSafe karar bağlantısı bulunamadı.");

    const assessmentId = randomUUID();
    const statement = claim.statementCiphertext
      ? decryptText(claim.statementCiphertext, `claim:${claim.id}:statement`)
      : claim.statement;
    const input = decisionAssessmentInputSchema.parse({
      assessmentId,
      runId: request.runId,
      claimId: request.claimId,
      sourceId: source.id,
      claim: statement,
      sourceExcerpt: decryptText(
        source.excerptCiphertext,
        `evidence-source:${source.id}:excerpt`,
      ),
      sourcePublishedAt: source.publishedAt,
      sourceCapturedAt: source.capturedAt.toISOString(),
      rubricVersion: "source-support-v1",
      model: request.model,
    });
    const requestFingerprint = fingerprintDecisionRequest({
      provider: "typesafe",
      protocol: "systemone-v1",
      input,
      mode: request.mode,
    });
    const [inserted] = await tx
      .insert(decisionAssessments)
      .values({
        id: assessmentId,
        ownerId: getOwnerId(),
        runId: request.runId,
        claimId: claim.id,
        reportClaimId: request.claimId,
        sourceId: source.id,
        connectionId: connection.id,
        mode: request.mode,
        status: "queued",
        rubricVersion: "source-support-v1",
        requestedModel: request.model,
        runStateVersion: claim.runStateVersion,
        requestFingerprint,
        inputCiphertext: encryptJson(input, `decision-assessment:${assessmentId}:input`),
      })
      .returning();
    if (!inserted) throw new Error("Decision assessment could not be created.");
    const jobId = await boss.send(
      RUN_DECISION_ASSESSMENT_QUEUE,
      { assessmentId },
      { db: fromDrizzle(tx, sql), singletonKey: assessmentId },
    );
    if (!jobId) throw new Error("Decision assessment job could not be created.");
    const [queued] = await tx
      .update(decisionAssessments)
      .set({ queueJobId: jobId, updatedAt: new Date() })
      .where(eq(decisionAssessments.id, assessmentId))
      .returning();
    if (!queued) throw new Error("Decision assessment job id could not be stored.");
    return mapAssessment(queued, claim.runStateVersion);
  });
}

export async function listDecisionAssessments(
  runId: string,
): Promise<DecisionAssessmentProjection[] | undefined> {
  const [ownedRun] = await getDatabase()
    .select({ stateVersion: runs.stateVersion })
    .from(runs)
    .where(and(eq(runs.ownerId, getOwnerId()), eq(runs.id, runId)))
    .limit(1);
  if (!ownedRun) return undefined;
  const rows = await getDatabase()
    .select()
    .from(decisionAssessments)
    .where(
      and(
        eq(decisionAssessments.ownerId, getOwnerId()),
        eq(decisionAssessments.runId, runId),
      ),
    )
    .orderBy(asc(decisionAssessments.createdAt));
  return rows.map((row) => mapAssessment(row, ownedRun.stateVersion));
}

export async function startDecisionAssessment(
  assessmentId: string,
): Promise<DecisionAssessmentWork | undefined> {
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(decisionAssessments)
      .where(
        and(
          eq(decisionAssessments.ownerId, getOwnerId()),
          eq(decisionAssessments.id, assessmentId),
        ),
      )
      .for("update")
      .limit(1);
    if (!row || row.status !== "queued") return undefined;
    await tx
      .update(decisionAssessments)
      .set({ status: "running", errorCode: null, updatedAt: new Date() })
      .where(eq(decisionAssessments.id, assessmentId));
    return {
      assessmentId: row.id,
      connectionId: row.connectionId,
      requestFingerprint: row.requestFingerprint,
      input: decisionAssessmentInputSchema.parse(
        decryptJson<unknown>(row.inputCiphertext, `decision-assessment:${row.id}:input`),
      ),
    };
  });
}

export async function completeDecisionAssessment(
  assessmentId: string,
  result: DecisionAssessmentResult,
): Promise<boolean> {
  const parsed = decisionAssessmentResultSchema.parse(result);
  const [updated] = await getDatabase()
    .update(decisionAssessments)
    .set({
      status: "completed",
      returnedModel: parsed.returnedModel,
      resultCiphertext: encryptJson(parsed, `decision-assessment:${assessmentId}:result`),
      errorCode: null,
      updatedAt: new Date(),
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(decisionAssessments.ownerId, getOwnerId()),
        eq(decisionAssessments.id, assessmentId),
        eq(decisionAssessments.status, "running"),
      ),
    )
    .returning({ id: decisionAssessments.id });
  return updated !== undefined;
}

export async function failDecisionAssessment(
  assessmentId: string,
  status: "failed" | "outcome_unknown",
  errorCode: string,
): Promise<boolean> {
  const [updated] = await getDatabase()
    .update(decisionAssessments)
    .set({
      status,
      errorCode,
      updatedAt: new Date(),
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(decisionAssessments.ownerId, getOwnerId()),
        eq(decisionAssessments.id, assessmentId),
        eq(decisionAssessments.status, "running"),
      ),
    )
    .returning({ id: decisionAssessments.id });
  return updated !== undefined;
}

export async function cancelDecisionAssessment(assessmentId: string): Promise<boolean> {
  const [row] = await getDatabase()
    .update(decisionAssessments)
    .set({ status: "cancelled", updatedAt: new Date(), finishedAt: new Date() })
    .where(
      and(
        eq(decisionAssessments.ownerId, getOwnerId()),
        eq(decisionAssessments.id, assessmentId),
        sql`${decisionAssessments.status} in ('queued', 'running')`,
      ),
    )
    .returning({ jobId: decisionAssessments.queueJobId });
  if (!row) return false;
  if (row.jobId) {
    const boss = await getBoss();
    await boss.cancel(RUN_DECISION_ASSESSMENT_QUEUE, row.jobId);
  }
  return true;
}

export async function prepareDecisionOperation(input: {
  assessmentId: string;
  provider: string;
  model: string;
  requestFingerprint: string;
  batchId?: string;
}): Promise<DecisionOperationReceipt> {
  return getDatabase().transaction(async (tx) => {
    const batchId = input.batchId ?? "single";
    const [existing] = await tx
      .select()
      .from(decisionOperations)
      .where(
        and(
          eq(decisionOperations.assessmentId, input.assessmentId),
          eq(decisionOperations.batchId, batchId),
        ),
      )
      .orderBy(desc(decisionOperations.attempt))
      .limit(1);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new Error("Decision operation fingerprint conflict.");
      }
      if (existing.status !== "retry_authorized") return mapOperation(existing);
    }
    const [created] = await tx
      .insert(decisionOperations)
      .values({
        id: randomUUID(),
        assessmentId: input.assessmentId,
        batchId,
        attempt: (existing?.attempt ?? 0) + 1,
        provider: input.provider,
        model: input.model,
        status: "prepared",
        requestFingerprint: input.requestFingerprint,
      })
      .returning();
    if (!created) throw new Error("Decision operation could not be created.");
    return mapOperation(created);
  });
}

export async function updateDecisionOperation(
  id: string,
  update: {
    status: DecisionOperationStatus;
    errorCode?: string;
    result?: DecisionAssessmentResult;
  },
): Promise<DecisionOperationReceipt> {
  const parsedResult = update.result
    ? decisionAssessmentResultSchema.parse(update.result)
    : undefined;
  const [row] = await getDatabase()
    .update(decisionOperations)
    .set({
      status: update.status,
      errorCode: update.errorCode,
      ...(parsedResult
        ? {
            inputTokens: parsedResult.inputTokens,
            outputTokens: parsedResult.outputTokens,
            resultCiphertext: encryptJson(parsedResult, `decision-operation:${id}:result`),
          }
        : {}),
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
    .where(eq(decisionOperations.id, id))
    .returning();
  if (!row) throw new Error("Decision operation was not found.");
  return mapOperation(row);
}

export async function loadDecisionOperationResult(
  id: string,
): Promise<DecisionAssessmentResult | undefined> {
  const [row] = await getDatabase()
    .select()
    .from(decisionOperations)
    .where(eq(decisionOperations.id, id))
    .limit(1);
  if (!row || row.status !== "succeeded" || !row.resultCiphertext) return undefined;
  return decisionAssessmentResultSchema.parse(
    decryptJson<unknown>(row.resultCiphertext, `decision-operation:${id}:result`),
  );
}

export async function listDecisionOperationsNeedingAction(): Promise<
  OperatorDecisionOperation[]
> {
  const rows = await getDatabase()
    .select({ operation: decisionOperations, assessment: decisionAssessments })
    .from(decisionOperations)
    .innerJoin(decisionAssessments, eq(decisionAssessments.id, decisionOperations.assessmentId))
    .where(
      and(
        eq(decisionAssessments.ownerId, getOwnerId()),
        eq(decisionOperations.status, "outcome_unknown"),
      ),
    )
    .orderBy(asc(decisionOperations.startedAt));
  return rows.map(({ operation, assessment }) => ({
    ...mapOperation(operation),
    runId: assessment.runId,
    claimId: assessment.reportClaimId,
  }));
}

export async function resolveDecisionOperation(
  operationId: string,
  action: ResolveDecisionOperationRequest["action"],
): Promise<{ operation: DecisionOperationReceipt; requeued: boolean } | undefined> {
  const boss = action === "authorize_retry" ? await getBoss() : undefined;
  return getDatabase().transaction(async (tx) => {
    const [joined] = await tx
      .select({ operation: decisionOperations, assessment: decisionAssessments })
      .from(decisionOperations)
      .innerJoin(decisionAssessments, eq(decisionAssessments.id, decisionOperations.assessmentId))
      .where(
        and(
          eq(decisionOperations.id, operationId),
          eq(decisionAssessments.ownerId, getOwnerId()),
        ),
      )
      .for("update")
      .limit(1);
    if (!joined) return undefined;
    if (joined.operation.status !== "outcome_unknown") {
      throw new DecisionOperationResolutionError("Karar operasyonu artık kullanıcı kararı beklemiyor.");
    }
    const nextStatus = action === "discard" ? "discarded" : "retry_authorized";
    const [resolved] = await tx
      .update(decisionOperations)
      .set({ status: nextStatus, finishedAt: new Date() })
      .where(eq(decisionOperations.id, operationId))
      .returning();
    if (!resolved) throw new Error("Decision operation could not be resolved.");
    if (action === "discard") {
      await tx
        .update(decisionAssessments)
        .set({
          status: "failed",
          errorCode: "operator_discarded",
          updatedAt: new Date(),
          finishedAt: new Date(),
        })
        .where(eq(decisionAssessments.id, joined.assessment.id));
      return { operation: mapOperation(resolved), requeued: false };
    }
    if (!boss) throw new Error("Queue is unavailable.");
    const jobId = await boss.send(
      RUN_DECISION_ASSESSMENT_QUEUE,
      { assessmentId: joined.assessment.id },
      {
        db: fromDrizzle(tx, sql),
        singletonKey: `${joined.assessment.id}:retry:${joined.operation.attempt + 1}`,
      },
    );
    if (!jobId) throw new Error("Decision retry job could not be created.");
    await tx
      .update(decisionAssessments)
      .set({
        status: "queued",
        queueJobId: jobId,
        errorCode: null,
        resultCiphertext: null,
        returnedModel: null,
        updatedAt: new Date(),
        finishedAt: null,
      })
      .where(eq(decisionAssessments.id, joined.assessment.id));
    return { operation: mapOperation(resolved), requeued: true };
  });
}
