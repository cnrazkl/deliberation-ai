import { afterEach, expect, test, vi } from "vitest";

const queueState = vi.hoisted(() => ({
  starts: 0,
  queueCreates: 0,
  stops: 0,
  failFirstQueueCreate: true,
}));

vi.mock("pg-boss", () => ({
  PgBoss: class {
    on(): void {}

    async start(): Promise<void> {
      queueState.starts += 1;
    }

    async createQueue(): Promise<void> {
      queueState.queueCreates += 1;
      if (queueState.failFirstQueueCreate) {
        queueState.failFirstQueueCreate = false;
        throw new Error("temporary queue registration failure");
      }
    }

    async stop(): Promise<void> {
      queueState.stops += 1;
    }
  },
}));

import { closeBoss, getBoss } from "./queue";

const previousDatabaseUrl = process.env.DATABASE_URL;

afterEach(async () => {
  await closeBoss();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

test("retries queue startup after a transient registration failure", async () => {
  process.env.DATABASE_URL = "postgresql://offline-test@127.0.0.1:5432/offline-test";
  const first = getBoss();
  expect(getBoss()).toBe(first);
  await expect(first).rejects.toThrow("temporary queue registration failure");
  expect(queueState.stops).toBe(1);

  const recovered = await getBoss();
  expect(await getBoss()).toBe(recovered);
  expect(queueState.starts).toBe(2);
  expect(queueState.queueCreates).toBe(3);
});
