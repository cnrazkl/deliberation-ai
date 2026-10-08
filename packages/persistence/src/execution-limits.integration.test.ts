import { randomUUID } from "node:crypto";
import { executeFakeCouncil, IdempotencyConflictError } from "@deliberation-ai/application";
import type { CreateRunRequest, CreateScheduleRequest, ExecutionLimits } from "@deliberation-ai/contracts";
import { defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { ExecutionPlanLimitsError } from "@deliberation-ai/domain";
import { NormalizedProviderError, type ProviderRequest, type TextProvider } from "../../providers/src";
import { ReceiptTrackedProvider } from "../../../apps/worker/src/provider-runtime";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDatabase, getDatabase } from "./database";
import { decryptJson, encryptJson } from "./crypto";
import { closeBoss, RUN_COUNCIL_QUEUE } from "./queue";
import { cancelDurableRun, enqueueDurableRun, findDurableRunById } from "./run-repository";
import { createLocalSchedule, dispatchDueLocalSchedules, listLocalSchedules, updateLocalSchedule } from "./local-schedules";
import {
  claimProviderOperationSubmission,
  ExecutionLimitsExceededError,
  fingerprintProviderRequest,
  getRunProviderUsage,
  loadProviderOperationFailureRawText,
  prepareProviderOperation,
  ProviderOperationResolutionError,
  resolveProviderOperation,
  updateProviderOperation,
} from "./provider-operations";
import { localSchedules, providerOperations, runEvents, runs } from "./schema";

const fixtureRunIds: string[] = [];
const fixtureScheduleIds: string[] = [];
const limits: ExecutionLimits = {
  version: "dispatch-limits-v1",
  maxProviderCalls: 2,
  maxOutputTokensPerCall: 128,
  maxReservedOutputTokens: 256,
};

function request(overrides: Partial<CreateRunRequest> = {}): CreateRunRequest {
  return {
    question: "Bounded offline execution limit integration fixture question",
    idempotencyKey: randomUUID(),
    scenario: "success",
    providerMode: "fake",
    reviewRounds: 0,
    memoryEntryIds: [],
    executionLimits: { ...limits },
    ...overrides,
  };
}

async function createFixture(overrides: Partial<CreateRunRequest> = {}) {
  const run = await enqueueDurableRun(request(overrides));
  fixtureRunIds.push(run.runId);
  return run;
}

async function prepare(runId: string, memberId = randomUUID()) {
  return prepareProviderOperation({
    runId,
    memberId,
    provider: "offline-fixture",
    model: "offline-model",
    requestFingerprint: fingerprintProviderRequest({ runId, memberId, maxOutputTokens: 128 }),
  });
}

function providerRequest(run: Awaited<ReturnType<typeof createFixture>>, memberId: string): ProviderRequest {
  return {
    memberId,
    role: "Offline analyst",
    councilRole: "analyst",
    round: 0,
    input: { snapshotId: run.snapshotId, question: run.question },
  };
}

afterAll(async () => {
  for (const scheduleId of fixtureScheduleIds) {
    const schedule = (await listLocalSchedules()).find((item) => item.id === scheduleId);
    if (schedule?.lastRunId && !fixtureRunIds.includes(schedule.lastRunId)) fixtureRunIds.push(schedule.lastRunId);
    await deleteLocalSchedule(scheduleId);
  }
  for (const runId of fixtureRunIds) await cancelDurableRun(runId);
  await closeBoss();
  if (fixtureRunIds.length) {
    // Only generated fixtures are removed; do not prune an owner's real history.
    await getDatabase().execute(sql`delete from pgboss.job where name = ${RUN_COUNCIL_QUEUE}
      and ${inArray(sql`data->>'runId'`, fixtureRunIds)}`);
    await getDatabase().delete(runs).where(inArray(runs.id, fixtureRunIds));
  }
  await closeDatabase();
});

test("freezes limits encrypted across connection reopen and binds them to the run intent", async () => {
  const input = request();
  const run = await enqueueDurableRun(input);
  fixtureRunIds.push(run.runId);
  const [stored] = await getDatabase().select({ ciphertext: runs.executionLimitsCiphertext })
    .from(runs).where(eq(runs.id, run.runId));
  expect(stored?.ciphertext).toBeTruthy();
  expect(stored?.ciphertext).not.toContain("maxProviderCalls");
  expect(decryptJson(stored!.ciphertext!, `run:${run.runId}:execution-limits`)).toEqual(limits);
  await closeDatabase();
  expect((await findDurableRunById(run.runId))?.executionLimits).toEqual(limits);
  expect((await enqueueDurableRun(input)).runId).toBe(run.runId);
  await expect(enqueueDurableRun({ ...input,
    executionLimits: { ...limits, maxProviderCalls: 3, maxReservedOutputTokens: 384 },
  })).rejects.toBeInstanceOf(IdempotencyConflictError);
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({
    limits, submittedCalls: 0, reservedOutputTokens: 0, remainingCalls: 2, remainingOutputTokens: 256,
  });
});

test("rejects limits that cannot reserve the entire selected council before enqueue", async () => {
  await expect(enqueueDurableRun(request({ executionLimits: { ...limits, maxProviderCalls: 1 } })))
    .rejects.toThrow();
  await expect(enqueueDurableRun(request({ executionLimits: { ...limits, maxReservedOutputTokens: 255 } })))
    .rejects.toThrow();
  await expect(enqueueDurableRun(request({ reviewRounds: 1 }))).rejects.toThrow();
});

test.each([
  { name: "calls", executionLimits: { ...limits, maxReservedOutputTokens: 384 }, remainingCalls: 0, remainingOutputTokens: 128 },
  { name: "output tokens", executionLimits: { ...limits, maxProviderCalls: 3 }, remainingCalls: 1, remainingOutputTokens: 0 },
])("parallel submission claims cannot overbook frozen $name", async ({ executionLimits, remainingCalls, remainingOutputTokens }) => {
  const run = await createFixture({ executionLimits });
  const operations = await Promise.all(Array.from({ length: 5 }, () => prepare(run.runId)));
  const outcomes = await Promise.allSettled(operations.map((operation) => claimProviderOperationSubmission(operation.id, 128)));
  const admitted = outcomes.flatMap((outcome, index) => outcome.status === "fulfilled" && outcome.value ? [operations[index]!] : []);
  expect(admitted).toHaveLength(2);
  for (const rejected of outcomes.filter((outcome) => outcome.status === "rejected")) {
    expect(rejected.status === "rejected" && rejected.reason).toBeInstanceOf(ExecutionLimitsExceededError);
  }
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(3);
  expect(await claimProviderOperationSubmission(admitted[0]!.id, 128)).toBe(false);
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({
    submittedCalls: 2, reservedOutputTokens: 256, remainingCalls, remainingOutputTokens,
  });
  const rows = await getDatabase().select({ reserved: providerOperations.reservedOutputTokens })
    .from(providerOperations).where(eq(providerOperations.runId, run.runId));
  expect(rows.filter((row) => row.reserved === 128)).toHaveLength(2);
  expect(rows.filter((row) => row.reserved === null)).toHaveLength(3);
});

test("successful receipt replay after reconnect returns saved output without another reservation", async () => {
  const run = await createFixture();
  const memberId = defaultFakeCouncilMembers[0]!.id;
  let dispatched = 0;
  const delegate: TextProvider = {
    id: memberId, label: "Offline successful receipt", councilRole: "analyst",
    async generate(input) {
      dispatched += 1;
      expect(input.maxOutputTokens).toBe(128);
      return {
        rawText: '{"summary":"Offline result","claims":[]}',
        parsed: { summary: "Offline result", claims: [] },
        metadata: { provider: "offline-fixture", model: "offline-model", remoteResponseId: "offline-success", outputTokens: 7 },
      };
    },
  };
  const tracked = new ReceiptTrackedProvider(run.runId, "offline-fixture", "offline-model", "off", delegate, undefined, 128);
  const input = providerRequest(run, memberId);
  const first = await tracked.generate(input);
  await closeDatabase();
  expect(await tracked.generate(input)).toEqual(first);
  expect(dispatched).toBe(1);
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({
    submittedCalls: 1, reservedOutputTokens: 128, remainingCalls: 1, remainingOutputTokens: 128,
  });
});

test("reported output above the requested cap is retained as failure and cannot be silently replayed or resent", async () => {
  const run = await createFixture();
  const memberId = defaultFakeCouncilMembers[0]!.id;
  let dispatched = 0;
  const delegate: TextProvider = {
    id: memberId, label: "Offline over-cap receipt", councilRole: "analyst",
    async generate() {
      dispatched += 1;
      return { rawText: '{"summary":"Offline over-cap result","claims":[]}',
        parsed: { summary: "Offline over-cap result", claims: [] },
        metadata: { provider: "offline-fixture", model: "offline-model", remoteResponseId: "offline-over-cap", inputTokens: 20, outputTokens: 129 } };
    },
  };
  const tracked = new ReceiptTrackedProvider(run.runId, "offline-fixture", "offline-model", "off", delegate, undefined, 128);
  const input = providerRequest(run, memberId);
  await expect(tracked.generate(input)).rejects.toMatchObject({ code: "reported_output_limit_exceeded", outcome: "known" });
  await closeDatabase();
  await expect(tracked.generate(input)).rejects.toMatchObject({ code: "reported_output_limit_exceeded" });
  expect(dispatched).toBe(1);
  const [receipt] = await getDatabase().select().from(providerOperations).where(eq(providerOperations.runId, run.runId));
  expect(receipt).toMatchObject({ status: "failed", outputTokens: 129, inputTokens: 20, reservedOutputTokens: 128 });
  expect(await loadProviderOperationFailureRawText(receipt!.id)).toContain("Offline over-cap result");
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({ submittedCalls: 1, reservedOutputTokens: 128 });
});

test("budget rejection never contacts the delegate and leaves a replayable failed unreserved receipt", async () => {
  const run = await createFixture();
  for (let index = 0; index < 2; index += 1) {
    const operation = await prepare(run.runId);
    expect(await claimProviderOperationSubmission(operation.id, 128)).toBe(true);
    await updateProviderOperation(operation.id, { status: "outcome_unknown", errorCode: "offline_unknown" });
  }
  let dispatched = 0;
  const delegate: TextProvider = {
    id: "blocked-member", label: "Offline blocked receipt", councilRole: "analyst",
    async generate() { dispatched += 1; throw new Error("No delegate may run after exhaustion."); },
  };
  const tracked = new ReceiptTrackedProvider(run.runId, "offline-fixture", "offline-model", "off", delegate, undefined, 128);
  const input = providerRequest(run, delegate.id);
  await expect(tracked.generate(input)).rejects.toBeInstanceOf(NormalizedProviderError);
  await expect(tracked.generate(input)).rejects.toBeInstanceOf(NormalizedProviderError);
  expect(dispatched).toBe(0);
  const [blocked] = await getDatabase().select().from(providerOperations)
    .where(eq(providerOperations.memberId, delegate.id));
  expect(blocked).toMatchObject({ status: "failed", reservedOutputTokens: null });
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({
    submittedCalls: 2, reservedOutputTokens: 256,
  });
});

test("unknown and discarded attempts retain reservations; exhausted retry leaves the report and queue untouched", async () => {
  const run = await createFixture();
  const operations = await Promise.all([prepare(run.runId), prepare(run.runId)]);
  for (const operation of operations) {
    expect(await claimProviderOperationSubmission(operation.id, 128)).toBe(true);
    await updateProviderOperation(operation.id, { status: "outcome_unknown", errorCode: "offline_unknown" });
  }
  const report = await executeFakeCouncil({ snapshotId: run.snapshotId, question: run.question },
    "success", defaultFakeCouncilMembers, 0);
  const reportCiphertext = encryptJson(report, `run:${run.runId}:report`);
  await getDatabase().update(runs).set({ status: "partially_completed", reportCiphertext, finishedAt: new Date() })
    .where(eq(runs.id, run.runId));
  expect(await resolveProviderOperation(operations[0]!.id, "discard")).toMatchObject({ requeued: false });
  const [before] = await getDatabase().select().from(runs).where(eq(runs.id, run.runId));
  const eventsBefore = await getDatabase().select().from(runEvents).where(eq(runEvents.runId, run.runId));
  await expect(resolveProviderOperation(operations[1]!.id, "authorize_retry"))
    .rejects.toBeInstanceOf(ProviderOperationResolutionError);
  const [after] = await getDatabase().select().from(runs).where(eq(runs.id, run.runId));
  expect(after).toEqual(before);
  expect((await findDurableRunById(run.runId))?.report?.memberResults).toHaveLength(2);
  expect(await getDatabase().select().from(runEvents).where(eq(runEvents.runId, run.runId))).toEqual(eventsBefore);
  const [unresolved] = await getDatabase().select().from(providerOperations).where(eq(providerOperations.id, operations[1]!.id));
  expect(unresolved).toMatchObject({ status: "outcome_unknown", reservedOutputTokens: 128 });
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({
    submittedCalls: 2, reservedOutputTokens: 256, remainingCalls: 0, remainingOutputTokens: 0,
  });
});

test("a mismatching output ceiling and cancellation do not acquire a reservation", async () => {
  const run = await createFixture();
  const mismatch = await prepare(run.runId);
  await expect(claimProviderOperationSubmission(mismatch.id, 129)).rejects.toBeInstanceOf(ExecutionLimitsExceededError);
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({ submittedCalls: 0, reservedOutputTokens: 0 });
  await cancelDurableRun(run.runId);
  await expect(claimProviderOperationSubmission(mismatch.id, 128)).rejects.toBeInstanceOf(ExecutionLimitsExceededError);
  const [stored] = await getDatabase().select().from(providerOperations).where(eq(providerOperations.id, mismatch.id));
  expect(stored).toMatchObject({ status: "prepared", reservedOutputTokens: null });
});

test("an authorized retry spends fresh capacity and preserves the unknown attempt across reconnect", async () => {
  const run = await createFixture({ executionLimits: { ...limits, maxProviderCalls: 3, maxReservedOutputTokens: 384 } });
  let dispatched = 0;
  const delegate: TextProvider = {
    id: defaultFakeCouncilMembers[0]!.id, label: "Offline retry receipt", councilRole: "analyst",
    async generate() {
      dispatched += 1;
      if (dispatched === 1) throw new NormalizedProviderError("Offline uncertain result", "offline_unknown", "unknown", false);
      return { rawText: '{"summary":"Offline retry","claims":[]}', parsed: { summary: "Offline retry", claims: [] },
        metadata: { provider: "offline-fixture", model: "offline-model", remoteResponseId: "offline-retry", outputTokens: 7 } };
    },
  };
  const tracked = new ReceiptTrackedProvider(run.runId, "offline-fixture", "offline-model", "off", delegate, undefined, 128);
  const input = providerRequest(run, delegate.id);
  await expect(tracked.generate(input)).rejects.toMatchObject({ outcome: "unknown" });
  await closeDatabase();
  await expect(tracked.generate(input)).rejects.toMatchObject({ code: "remote_outcome_unknown" });
  expect(dispatched).toBe(1);
  const [original] = await getDatabase().select().from(providerOperations).where(eq(providerOperations.runId, run.runId));
  await getDatabase().update(runs).set({ status: "partially_completed", finishedAt: new Date() }).where(eq(runs.id, run.runId));
  expect(await resolveProviderOperation(original!.id, "authorize_retry")).toMatchObject({ requeued: true });
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({ submittedCalls: 1, reservedOutputTokens: 128 });
  const result = await tracked.generate(input);
  await closeDatabase();
  expect(await tracked.generate(input)).toEqual(result);
  expect(dispatched).toBe(2);
  expect((await getRunProviderUsage(run.runId))?.executionBudget).toMatchObject({
    submittedCalls: 2, reservedOutputTokens: 256, remainingCalls: 1, remainingOutputTokens: 128,
  });
  const attempts = await getDatabase().select().from(providerOperations).where(eq(providerOperations.runId, run.runId));
  expect(attempts).toHaveLength(2);
  expect(attempts.find((attempt) => attempt.id === original!.id)).toMatchObject({ status: "retry_authorized", reservedOutputTokens: 128 });
  expect(attempts.find((attempt) => attempt.id !== original!.id)).toMatchObject({ status: "succeeded", reservedOutputTokens: 128 });
});

function scheduleRequest(overrides: Partial<CreateScheduleRequest> = {}): CreateScheduleRequest {
  return {
    name: `Offline execution quota schedule ${randomUUID()}`,
    question: "Which offline project comparison evidence should be inspected?",
    providerMode: "fake",
    reviewRounds: 0,
    cadence: "daily",
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    members: defaultFakeCouncilMembers,
    executionLimits: { ...limits },
    ...overrides,
  };
}

test("keeps schedule limits encrypted and passes their exact frozen values to each dispatched run", async () => {
  const input = scheduleRequest();
  const schedule = await createLocalSchedule(input);
  fixtureScheduleIds.push(schedule.id);
  expect(schedule.executionLimits).toEqual(limits);
  expect(schedule.status).toBe("paused");
  const [stored] = await getDatabase().select({ ciphertext: localSchedules.executionLimitsCiphertext })
    .from(localSchedules).where(eq(localSchedules.id, schedule.id));
  expect(stored?.ciphertext).toBeTruthy();
  expect(stored?.ciphertext).not.toContain("maxReservedOutputTokens");
  expect(decryptJson(stored!.ciphertext!, `local-schedule:${schedule.id}:execution-limits`)).toEqual(limits);
  await closeDatabase();
  expect((await listLocalSchedules()).find((item) => item.id === schedule.id)?.executionLimits).toEqual(limits);
  await updateLocalSchedule(schedule.id, { status: "active" });
  const scheduledAt = new Date(input.nextRunAt);
  expect(await dispatchDueLocalSchedules(scheduledAt)).toEqual({ dispatched: 1, failed: 0 });
  const dispatched = (await listLocalSchedules()).find((item) => item.id === schedule.id);
  expect(dispatched?.lastRunId).toBeTruthy();
  const childRunId = dispatched!.lastRunId!;
  fixtureRunIds.push(childRunId);
  expect((await findDurableRunById(childRunId))?.executionLimits).toEqual(limits);
  expect((await getRunProviderUsage(childRunId))?.executionBudget).toMatchObject({
    limits, submittedCalls: 0, reservedOutputTokens: 0, remainingCalls: 2, remainingOutputTokens: 256,
  });
  expect(await dispatchDueLocalSchedules(scheduledAt)).toEqual({ dispatched: 0, failed: 0 });
  await updateLocalSchedule(schedule.id, { status: "paused" });
});

test("rejects an insufficient scheduled plan at creation and at activation or dispatch after drift", async () => {
  const insufficient = { ...limits, maxProviderCalls: 1 };
  await expect(createLocalSchedule(scheduleRequest({ executionLimits: insufficient })))
    .rejects.toBeInstanceOf(ExecutionPlanLimitsError);
  const schedule = await createLocalSchedule(scheduleRequest());
  fixtureScheduleIds.push(schedule.id);
  await getDatabase().update(localSchedules).set({
    executionLimitsCiphertext: encryptJson(insufficient, `local-schedule:${schedule.id}:execution-limits`),
  }).where(eq(localSchedules.id, schedule.id));
  await expect(updateLocalSchedule(schedule.id, { status: "active" })).rejects.toBeInstanceOf(ExecutionPlanLimitsError);
  // A stale active record must also be withheld by the dispatcher itself.
  await getDatabase().update(localSchedules).set({ status: "active" }).where(eq(localSchedules.id, schedule.id));
  expect(await dispatchDueLocalSchedules(new Date(schedule.nextRunAt))).toEqual({ dispatched: 0, failed: 1 });
  const withheld = (await listLocalSchedules()).find((item) => item.id === schedule.id);
  expect(withheld).toMatchObject({ status: "paused", lastRunId: null });
});

// Exact generated fixture cleanup; production schedule deletion requires review.
async function deleteLocalSchedule(id: string): Promise<boolean> {
  const rows = await getDatabase().delete(localSchedules).where(eq(localSchedules.id, id))
    .returning({ id: localSchedules.id });
  return rows.length > 0;
}
