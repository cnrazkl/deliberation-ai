import { PgBoss } from "pg-boss";

export const RUN_COUNCIL_QUEUE = "run-fake-council";
export const RUN_DECISION_ASSESSMENT_QUEUE = "run-decision-assessment";
export const PRIVATE_DELIVERY_QUEUE = "private-text-delivery";

declare global {
  var deliberationBossPromise: Promise<PgBoss> | undefined;
}

function startBoss(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");

  return (async () => {
    const boss = new PgBoss({
      connectionString,
      application_name: "deliberation-ai-queue",
      schema: "pgboss",
      schedule: false,
      useListenNotify: true,
    });
    boss.on("error", (error) => {
      // Database errors can contain SQL values; keep operator logs content-free.
      console.error("Queue error", { name: error.name });
    });
    try {
      await boss.start();
      await boss.createQueue(RUN_COUNCIL_QUEUE, {
        retryLimit: 2,
        retryDelay: 1,
        retryBackoff: true,
        expireInSeconds: 60,
        heartbeatSeconds: 10,
        deleteAfterSeconds: 86_400,
        notify: true,
      });
      await boss.createQueue(RUN_DECISION_ASSESSMENT_QUEUE, {
        retryLimit: 0,
        expireInSeconds: 60,
        heartbeatSeconds: 10,
        deleteAfterSeconds: 86_400,
        notify: true,
      });
      await boss.createQueue(PRIVATE_DELIVERY_QUEUE, {
        retryLimit: 2, retryDelay: 5, expireInSeconds: 180, heartbeatSeconds: 10, deleteAfterSeconds: 86_400, notify: true,
      });
      return boss;
    } catch (error) {
      // Queue registration can fail after start opened database connections.
      try {
        await boss.stop({ graceful: false, timeout: 5_000 });
      } catch {
        // Preserve the original startup failure; the next call creates a fresh boss.
      }
      throw error;
    }
  })();
}

export function getBoss(): Promise<PgBoss> {
  if (globalThis.deliberationBossPromise) return globalThis.deliberationBossPromise;
  const pending = startBoss();
  globalThis.deliberationBossPromise = pending;
  void pending.catch(() => {
    if (globalThis.deliberationBossPromise === pending) {
      globalThis.deliberationBossPromise = undefined;
    }
  });
  return pending;
}

export async function closeBoss(): Promise<void> {
  if (globalThis.deliberationBossPromise) {
    const boss = await globalThis.deliberationBossPromise;
    await boss.stop({ graceful: true, timeout: 5_000 });
  }
  globalThis.deliberationBossPromise = undefined;
}
