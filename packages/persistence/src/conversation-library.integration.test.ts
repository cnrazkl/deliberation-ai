import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "./database";
import { conversations, conversationRuns, runs } from "./schema";
import { LOCAL_OWNER_ID } from "./owner";
import { encryptText } from "./crypto";
import { listConversations } from "./conversation-library";
import { ConversationPendingError } from "./conversation-membership";
import { listDurableRuns } from "./run-repository";

const conversationIds: string[] = [];
const runIds: string[] = [];
afterAll(async () => {
  if (conversationIds.length) {
    await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.conversationId, conversationIds));
    await getDatabase().delete(conversations).where(inArray(conversations.id, conversationIds));
  }
  if (runIds.length) await getDatabase().delete(runs).where(inArray(runs.id, runIds));
  await closeDatabase();
});

async function conversation(ownerId = LOCAL_OWNER_ID, timestamp = "2100-01-01 00:00:00.123456+00") {
  const id = randomUUID(); conversationIds.push(id);
  await getDatabase().insert(conversations).values({ id, ownerId, anchorRunId: randomUUID(), origin: "native", createdAt: sql`${timestamp}::timestamptz` });
  return id;
}
async function member(conversationId: string, available: boolean, ownerId = LOCAL_OWNER_ID, timestamp = "2100-01-01 00:00:00.123456+00") {
  const id = randomUUID(); runIds.push(id);
  if (available) await getDatabase().insert(runs).values({ id, ownerId, idempotencyKey: randomUUID(), requestHash: "fixture",
    snapshotId: randomUUID(), question: "[encrypted]", questionCiphertext: encryptText("Kayıtlı son sorunun koşulları neler?", `run:${id}:question`),
    branchIndexVersion: 1, branchKind: "independent", createdAt: sql`${timestamp}::timestamptz`,
    // Listing must not touch report/continuation ciphertext, including this deliberately invalid envelope.
    reportCiphertext: "unreadable-report-fixture", continuationArchiveCiphertext: "unreadable-archive-fixture",
  });
  await getDatabase().insert(conversationRuns).values({ ownerId, runId: id, conversationId, kind: "independent", createdAt: sql`${timestamp}::timestamptz` });
  return id;
}

test("pages every owned conversation once using full PostgreSQL timestamp precision and UUID ties", async () => {
  const expected: string[] = [];
  for (let i = 0; i < 23; i++) expected.push(await conversation(LOCAL_OWNER_ID, i < 2 ? "2100-01-01 00:00:00.123999+00" : "2100-01-01 00:00:00.123456+00"));
  const foreign = await conversation(`other-${randomUUID()}`, "2200-01-01 00:00:00.000001+00");
  const first = await listConversations();
  expect(first!.conversations).toHaveLength(20);
  expect(first!.nextCursor).toBeTruthy();
  // A new conversation before page 2 must not move the immutable cursor boundary.
  const newer = await conversation(LOCAL_OWNER_ID, "2150-01-01 00:00:00.000001+00");
  const second = await listConversations(first!.nextCursor!);
  const observed = [...first!.conversations, ...second!.conversations].map((item) => item.conversationId);
  expect(observed.filter((id) => expected.includes(id)).sort()).toEqual([...expected].sort());
  expect(new Set(observed).size).toBe(observed.length);
  expect(observed).not.toContain(foreign); expect(observed).not.toContain(newer);
  expect(await listConversations(foreign)).toBeUndefined();
  expect(await listConversations(randomUUID())).toBeUndefined();
});

test("counts retained/unavailable members, opens the latest owned available body and reads no report archives", async () => {
  const id = await conversation(LOCAL_OWNER_ID, "2300-01-01 00:00:00+00");
  await member(id, true);
  const available = await member(id, true, LOCAL_OWNER_ID, "2100-01-02 00:00:00+00");
  await member(id, false, LOCAL_OWNER_ID, "2100-01-03 00:00:00+00");
  const foreign = await member(id, true, `other-${randomUUID()}`, "2100-01-04 00:00:00+00");
  const archived = await conversation(LOCAL_OWNER_ID, "2299-01-01 00:00:00+00");
  await member(archived, false);
  const page = await listConversations();
  const item = page!.conversations.find((value) => value.conversationId === id)!;
  expect(item.recordedRunCount).toBe(3); expect(item.availableRunCount).toBe(2); expect(item.unavailableRunCount).toBe(1);
  expect(item.latestAvailableRun).toEqual({ runId: available, question: "Kayıtlı son sorunun koşulları neler?", status: "queued" });
  expect(JSON.stringify(page)).not.toContain(foreign);
  expect(JSON.stringify(page)).not.toContain("unreadable");
  expect(page!.conversations.find((value) => value.conversationId === archived)!.latestAvailableRun).toBeNull();
});

test("refuses an incomplete owned legacy index without writing or exposing partial membership", async () => {
  const id = randomUUID(); runIds.push(id);
  await getDatabase().insert(runs).values({ id, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "fixture", snapshotId: randomUUID(), question: "Pending legacy fixture" });
  await expect(listConversations()).rejects.toBeInstanceOf(ConversationPendingError);
  await getDatabase().delete(runs).where(inArray(runs.id, [id]));
});

test("saved-run history does not skip records sharing sub-millisecond timestamps", async () => {
  const expected: string[] = [];
  for (let i = 0; i < 23; i++) {
    const id = randomUUID(); expected.push(id); runIds.push(id);
    await getDatabase().insert(runs).values({ id, ownerId: LOCAL_OWNER_ID, idempotencyKey: randomUUID(), requestHash: "fixture", snapshotId: randomUUID(),
      question: "Timestamp paging fixture", branchIndexVersion: 1, branchKind: "independent",
      createdAt: sql`${i < 2 ? "2300-01-01 00:00:00.123999+00" : "2300-01-01 00:00:00.123456+00"}::timestamptz` });
  }
  const first = (await listDurableRuns())!;
  const second = (await listDurableRuns(first.nextCursor!))!;
  const observed = [...first.runs, ...second.runs].map((item) => item.runId);
  expect(observed.filter((id) => expected.includes(id)).sort()).toEqual([...expected].sort());
  expect(new Set(observed).size).toBe(observed.length);
});
