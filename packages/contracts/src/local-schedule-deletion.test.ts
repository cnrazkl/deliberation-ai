import { expect,test } from "vitest";
import { deleteLocalScheduleSchema, localScheduleDeletionReceiptSchema } from "./index";
test("schedule deletion requires retained-run acknowledgement and excludes template content from receipts",()=>{
  const scheduleId="11111111-1111-4111-8111-111111111111";const fingerprint="a".repeat(64);
  expect(deleteLocalScheduleSchema.safeParse({scheduleId,fingerprint,confirmContentDeletion:true,acknowledgeRetainedRuns:false}).success).toBe(false);
  expect(localScheduleDeletionReceiptSchema.safeParse({version:"local-schedule-deletion-v1",scheduleId,fingerprint,creationRequestId:null,retainedLastRunId:null,deletedAt:"2026-10-03T09:00:00.000Z",question:"Private question"}).success).toBe(false);
});
