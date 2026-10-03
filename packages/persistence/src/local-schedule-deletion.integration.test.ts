import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, expect, test } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createScheduleSchema, type CreateRunRequest, defaultFakeCouncilMembers } from "@deliberation-ai/contracts";
import { IdempotencyConflictError } from "@deliberation-ai/application";
import { getDatabase, closeDatabase } from "./database";
import { closeBoss } from "./queue";
import { localSchedules, runs, conversationRuns, conversations } from "./schema";
import { LOCAL_OWNER_ID } from "./owner";
import { createLocalSchedule, listLocalSchedules, updateLocalSchedule, dispatchDueLocalSchedules } from "./local-schedules";
import { deleteLocalScheduleContent, previewLocalScheduleDeletion, decodeLocalScheduleDeletion, LocalScheduleDeletionStaleError, LocalScheduleDeletionBlockedError } from "./local-schedule-deletion";
import { enqueueDurableRun } from "./run-repository";
import { scheduleSnapshotHash, scheduleOccurrenceKey, ScheduleOccurrenceUnavailableError } from "./schedule-occurrences";
import { auditRestoredEncryption } from "../scripts/backup-encryption-audit";
const ids: string[] = [];
afterEach(async () => {
  for (const id of ids) {
    const created = await getDatabase().select({ id: runs.id }).from(runs).where(and(eq(runs.ownerId,LOCAL_OWNER_ID), sql`${runs.idempotencyKey} like ${`schedule:${id}:%`}`));
    const runIds = created.map((row) => row.id);
    if (runIds.length) {
      const memberships = await getDatabase().select().from(conversationRuns).where(inArray(conversationRuns.runId, runIds));
      await getDatabase().execute(sql`delete from pgboss.job where name='run-fake-council' and data->>'runId' in (${sql.join(runIds.map((runId) => sql`${runId}`),sql`,`)})`);
      await getDatabase().delete(conversationRuns).where(inArray(conversationRuns.runId,runIds));
      if (memberships.length) await getDatabase().delete(conversations).where(inArray(conversations.id,memberships.map((row) => row.conversationId)));
      await getDatabase().delete(runs).where(inArray(runs.id,runIds));
    }
    await getDatabase().delete(localSchedules).where(eq(localSchedules.id,id));
  }
  ids.length=0;
});
afterAll(async () => { await closeBoss(); await closeDatabase(); });
async function fixture() {
  const input=createScheduleSchema.parse({ requestId:randomUUID(), name:"Generated schedule deletion", question:"Generated scheduled comparison question",
    providerMode:"fake", riskProfile:"standard", reviewRounds:0, members:defaultFakeCouncilMembers, cadence:"daily", nextRunAt:"2400-01-01T00:00:00.000Z" });
  const schedule=await createLocalSchedule(input);ids.push(schedule.id);return { input,schedule };
}
async function fenceFor(id: string) {
  const [row]=await getDatabase().select({ exact:sql<unknown>`to_jsonb(${localSchedules})`, occurrenceAt:sql<string>`to_char(${localSchedules.nextRunAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
    .from(localSchedules).where(eq(localSchedules.id,id));
  return { id, fingerprint:scheduleSnapshotHash(row!.exact), occurrenceAt:row!.occurrenceAt, now:new Date("2400-01-01T00:01:00Z") };
}
function runInput(id: string, time: string): CreateRunRequest {
  return { idempotencyKey:scheduleOccurrenceKey(id,time), question:"Generated scheduled comparison question", providerMode:"fake", scenario:"success", riskProfile:"standard", reviewRounds:0, members:defaultFakeCouncilMembers, memoryEntryIds:[] };
}

test("creation retries deduplicate; reviewed deletion erases templates and tombstones the creation intent",async () => {
  const { input,schedule }=await fixture();expect((await createLocalSchedule(input)).id).toBe(schedule.id);
  await expect(createLocalSchedule({...input,name:"Changed intent"})).rejects.toBeInstanceOf(IdempotencyConflictError);
  const before=await getDatabase().select().from(localSchedules).where(eq(localSchedules.id,schedule.id));
  const review=(await previewLocalScheduleDeletion(schedule.id))!;expect(review.eligible).toBe(true);
  expect(await getDatabase().select().from(localSchedules).where(eq(localSchedules.id,schedule.id))).toEqual(before);
  const receipt=await deleteLocalScheduleContent(schedule.id,review.fingerprint!);
  expect(await deleteLocalScheduleContent(schedule.id,review.fingerprint!)).toEqual(receipt);
  await expect(deleteLocalScheduleContent(schedule.id,"a".repeat(64))).rejects.toBeInstanceOf(LocalScheduleDeletionStaleError);
  const [row]=await getDatabase().select().from(localSchedules).where(eq(localSchedules.id,schedule.id));expect(decodeLocalScheduleDeletion(row!)).toEqual(receipt);
  expect((await listLocalSchedules()).some((item)=>item.id===schedule.id)).toBe(false);
  expect(await updateLocalSchedule(schedule.id,{status:"active"})).toBeUndefined();
  await expect(createLocalSchedule(input)).rejects.toBeInstanceOf(IdempotencyConflictError);
  await expect(enqueueDurableRun(runInput(schedule.id,"2400-01-01T00:00:00.000000Z"))).rejects.toBeInstanceOf(IdempotencyConflictError);
  const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
  try{expect((await auditRestoredEncryption(client)).decryptedValues).toBeGreaterThanOrEqual(4);}finally{await client.end();}
});

test("active schedules are blocked and exact microsecond review drift preserves content",async () => {
  const { schedule }=await fixture();await updateLocalSchedule(schedule.id,{status:"active"});
  expect((await previewLocalScheduleDeletion(schedule.id))!.blockedReasons).toContain("active_schedule");
  await expect(deleteLocalScheduleContent(schedule.id,"a".repeat(64))).rejects.toBeInstanceOf(LocalScheduleDeletionBlockedError);
  await updateLocalSchedule(schedule.id,{status:"paused"});const review=(await previewLocalScheduleDeletion(schedule.id))!;
  await getDatabase().execute(sql`update local_schedules set updated_at=updated_at+interval '1 microsecond' where id=${schedule.id}::uuid`);
  await expect(deleteLocalScheduleContent(schedule.id,review.fingerprint!)).rejects.toBeInstanceOf(LocalScheduleDeletionStaleError);
  expect((await listLocalSchedules()).find((item)=>item.id===schedule.id)!.question).toBe("Generated scheduled comparison question");
});

test("a stale worker snapshot cannot enqueue after pause or deletion",async () => {
  const { schedule }=await fixture();await updateLocalSchedule(schedule.id,{status:"active"});const fence=await fenceFor(schedule.id);
  await updateLocalSchedule(schedule.id,{status:"paused"});
  await expect(enqueueDurableRun(runInput(schedule.id,fence.occurrenceAt),fence)).rejects.toBeInstanceOf(ScheduleOccurrenceUnavailableError);
  const review=(await previewLocalScheduleDeletion(schedule.id))!;await deleteLocalScheduleContent(schedule.id,review.fingerprint!);
  await expect(enqueueDurableRun(runInput(schedule.id,fence.occurrenceAt),fence)).rejects.toBeInstanceOf(ScheduleOccurrenceUnavailableError);
  expect((await getDatabase().select().from(runs).where(eq(runs.idempotencyKey,scheduleOccurrenceKey(schedule.id,fence.occurrenceAt))))).toHaveLength(0);
});

test("concurrent dispatchers enqueue one occurrence and preserve independent queued work after deletion",async () => {
  const { schedule }=await fixture();await updateLocalSchedule(schedule.id,{status:"active"});
  const results=await Promise.all([dispatchDueLocalSchedules(new Date(schedule.nextRunAt)),dispatchDueLocalSchedules(new Date(schedule.nextRunAt))]);
  expect(results.reduce((sum,row)=>sum+row.dispatched,0)).toBe(1);expect(results.every((row)=>row.failed===0)).toBe(true);
  const current=(await listLocalSchedules()).find((item)=>item.id===schedule.id)!;expect(current.lastRunId).toBeTruthy();
  await updateLocalSchedule(schedule.id,{status:"paused"});const review=(await previewLocalScheduleDeletion(schedule.id))!;
  expect(review.retainedRunCount).toBe(1);await deleteLocalScheduleContent(schedule.id,review.fingerprint!);
  expect((await getDatabase().select().from(runs).where(eq(runs.id,current.lastRunId!)))).toHaveLength(1);
});

test("cursor mismatch rolls back the run/job and exact fractional occurrences retain their precision",async () => {
  const { schedule }=await fixture();await updateLocalSchedule(schedule.id,{status:"active"});let fence=await fenceFor(schedule.id);
  const wrong={...fence,occurrenceAt:"2400-01-01T00:00:00.000001Z"};
  await expect(enqueueDurableRun(runInput(schedule.id,wrong.occurrenceAt),wrong)).rejects.toBeInstanceOf(ScheduleOccurrenceUnavailableError);
  expect((await getDatabase().select().from(runs).where(eq(runs.idempotencyKey,scheduleOccurrenceKey(schedule.id,wrong.occurrenceAt))))).toHaveLength(0);
  await getDatabase().execute(sql`update local_schedules set next_run_at='2400-01-01T00:00:00.000123Z'::timestamptz where id=${schedule.id}::uuid`);
  fence=await fenceFor(schedule.id);await enqueueDurableRun(runInput(schedule.id,fence.occurrenceAt),fence);
  const exact=await getDatabase().execute<{ value:string }>(sql`select to_char(next_run_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value from local_schedules where id=${schedule.id}::uuid`);
  expect(exact.rows[0]!.value).toBe("2400-01-02T00:00:00.000123Z");
});

test("schema drift and foreign ownership cannot scrub a schedule",async () => {
  const { schedule }=await fixture();await getDatabase().execute(sql`alter table local_schedules add column generated_unknown text`);
  try{expect((await previewLocalScheduleDeletion(schedule.id))!.blockedReasons).toContain("schema_changed");}
  finally{await getDatabase().execute(sql`alter table local_schedules drop column generated_unknown`);}
  await getDatabase().execute(sql`create table generated_schedule_reference(id uuid references local_schedules(id))`);
  try{expect((await previewLocalScheduleDeletion(schedule.id))!.blockedReasons).toContain("schema_changed");}
  finally{await getDatabase().execute(sql`drop table generated_schedule_reference`);}
  await getDatabase().update(localSchedules).set({ownerId:"generated-foreign"}).where(eq(localSchedules.id,schedule.id));
  expect(await previewLocalScheduleDeletion(schedule.id)).toBeUndefined();expect(await deleteLocalScheduleContent(schedule.id,"a".repeat(64))).toBeUndefined();
});

test("legacy schedules are deletable without invented creation identity and corrupt receipts fail backup auditing", async () => {
  const { schedule } = await fixture();
  await getDatabase().update(localSchedules).set({ creationRequestId: null, creationRequestHash: null }).where(eq(localSchedules.id, schedule.id));
  const preview = (await previewLocalScheduleDeletion(schedule.id))!;
  expect((await deleteLocalScheduleContent(schedule.id, preview.fingerprint!))!.creationRequestId).toBeNull();
  await getDatabase().update(localSchedules).set({ deletionReceiptCiphertext: "corrupt-generated-receipt" }).where(eq(localSchedules.id, schedule.id));
  await expect(previewLocalScheduleDeletion(schedule.id)).rejects.toThrow();
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { await expect(auditRestoredEncryption(client)).rejects.toThrow("Restored schedule deletion receipt is invalid"); }
  finally { await client.end(); }
});
