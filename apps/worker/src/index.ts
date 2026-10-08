import { randomUUID } from "node:crypto";
import {
  assertDatabaseMigrationCompatibility,
  DatabaseMigrationCompatibilityError,
  closeBoss,
  closeDatabase,
  dispatchAllUserSchedules,
  withWorkerOwner,
  executeDurableRun,
  getBoss,
  openWorkerHeartbeat,
  RUN_DECISION_ASSESSMENT_QUEUE,
  RUN_COUNCIL_QUEUE,
  PRIVATE_DELIVERY_QUEUE,
  type WorkerHeartbeatLease,
} from "@deliberation-ai/persistence";
import { executeWorkerCouncil } from "./provider-runtime";
import { executeWorkerDecisionAssessment } from "./decision-runtime";
import { executeWorkerPrivateDelivery } from "./private-runtime";

type RunCouncilJob = { runId: string };
type DecisionAssessmentJob = { assessmentId: string };
const workerInstanceId = randomUUID();

async function main(): Promise<void> {
  await assertDatabaseMigrationCompatibility();
  if (process.env.DELIBERATION_RECOVERY_HOLD === "true") {
    heartbeatLease = await openWorkerHeartbeat(workerInstanceId);
    heartbeatTimer = setInterval(() => { void heartbeatLease?.beat().catch(() => console.error("Kurtarma nabzı güncellenemedi.")); }, 15_000);
    console.log("Kurtarma incelemesi salt okunur; kuyruk ve zamanlamalar başlatılmadı.");
    return;
  }
  const boss = await getBoss();
  await boss.work<{ branchId: string; operationId: string }>(PRIVATE_DELIVERY_QUEUE, {
    batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 0.5, notifyPollingIntervalSeconds: 1,
  }, async ([job]) => { if (job) await withWorkerOwner("private", job.data.branchId, () => executeWorkerPrivateDelivery(job.data.branchId, job.data.operationId)); });
  await boss.work<RunCouncilJob>(
    RUN_COUNCIL_QUEUE,
    {
      batchSize: 1,
      localConcurrency: Number(process.env.WORKER_CONCURRENCY ?? "1"),
      pollingIntervalSeconds: 0.5,
      notifyPollingIntervalSeconds: 1,
    },
    async ([job]) => {
      if (!job) return;
      const run = await withWorkerOwner("run", job.data.runId, () => executeDurableRun(job.data.runId, executeWorkerCouncil));
      return { runId: job.data.runId, status: run?.status ?? "missing" };
    },
  );
  if (process.env.ENABLE_DECISION_EVALUATOR === "true") {
    await boss.work<DecisionAssessmentJob>(
      RUN_DECISION_ASSESSMENT_QUEUE,
      {
        batchSize: 1,
        localConcurrency: Number(process.env.DECISION_WORKER_CONCURRENCY ?? "1"),
        pollingIntervalSeconds: 0.5,
        notifyPollingIntervalSeconds: 30,
      },
      async ([job]) => {
        if (!job) return;
        const status = await withWorkerOwner("decision", job.data.assessmentId, () => executeWorkerDecisionAssessment(job.data.assessmentId));
        return { assessmentId: job.data.assessmentId, status };
      },
    );
  }
  await dispatchAllUserSchedules();
  heartbeatLease = await openWorkerHeartbeat(workerInstanceId);
  heartbeatTimer = setInterval(() => {
    void heartbeatLease?.beat().catch(() => {
      console.error("Worker durum nabzı güncellenemedi.");
    });
  }, 15_000);
  scheduleTimer = setInterval(() => {
    void dispatchAllUserSchedules().catch(() => {
      console.error("Yerel zamanlama taraması tamamlanamadı.");
    });
  }, 30_000);
  console.log("DeliberationAI worker hazır.");
}

let stopping = false;
let scheduleTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatLease: WorkerHeartbeatLease | undefined;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (scheduleTimer) clearInterval(scheduleTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  try {
    await heartbeatLease?.close();
  } catch {
    console.error("Worker kapanış durumu kaydedilemedi.");
  }
  await closeBoss();
  await closeDatabase();
}

async function handleSignal(): Promise<void> {
  await shutdown();
  process.exit(0);
}

process.once("SIGINT", () => void handleSignal());
process.once("SIGTERM", () => void handleSignal());

main().catch(async (error: unknown) => {
  if (error instanceof DatabaseMigrationCompatibilityError) console.error(error.message);
  // Startup failures may include database/HTTP details with private values.
  console.error("Worker başlatılamadı", { name: error instanceof Error ? error.name : "UnknownError" });
  try {
    await shutdown();
  } catch {
    console.error("Worker başlatma hatasından sonra bağlantılar kapatılamadı.");
  }
  process.exitCode = 1;
});
