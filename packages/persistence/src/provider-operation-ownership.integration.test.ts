import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { closeDatabase, getDatabase } from "./database";
import { withOwner } from "./owner";
import { closeBoss } from "./queue";
import { cancelDurableRun, enqueueDurableRun } from "./run-repository";
import { runs } from "./schema";
import {
  claimProviderOperationSubmission,
  loadProviderOperationFailureRawText,
  loadProviderOperationResult,
  prepareProviderOperation,
  updateProviderOperation,
} from "./provider-operations";

const owner = `operation-owner-${randomUUID()}`;
const otherOwner = `operation-other-${randomUUID()}`;
const runIds: string[] = [];

afterAll(async () => {
  await withOwner(owner, async () => {
    for (const id of runIds) await cancelDurableRun(id);
  });
  await closeBoss();
  if (runIds.length) await getDatabase().delete(runs).where(inArray(runs.id, runIds));
  await closeDatabase();
});

test("operation result, failure body and updates retain the parent run's owner scope", async () => {
  const { success, failure } = await withOwner(owner, async () => {
    const run = await enqueueDurableRun({ question: "Verify offline receipt owner isolation", idempotencyKey: randomUUID(),
      scenario: "success", providerMode: "fake", reviewRounds: 0, memoryEntryIds: [] });
    runIds.push(run.runId);
    const prepare = (memberId: string) => prepareProviderOperation({ runId: run.runId, memberId,
      provider: "offline", model: "offline", requestFingerprint: memberId });
    const success = await prepare("success");
    await updateProviderOperation(success.id, { status: "succeeded", remoteResponseId: "offline-response",
      rawText: "Owner-only successful response", parsedOutput: { summary: "Offline owner fixture",
        claims: [{ statement: "Owner fixture", quote: "Owner fixture", kind: "recommendation" }] } });
    const failure = await prepare("failure");
    await updateProviderOperation(failure.id, { status: "failed", errorCode: "offline_failure", rawText: "Owner-only failed response" });
    return { success, failure };
  });

  await withOwner(otherOwner, async () => {
    expect(await loadProviderOperationResult(success.id)).toBeUndefined();
    expect(await loadProviderOperationFailureRawText(failure.id)).toBeUndefined();
    expect(await claimProviderOperationSubmission(success.id)).toBe(false);
    await expect(updateProviderOperation(success.id, { status: "discarded" })).rejects.toThrow("not found");
    await expect(updateProviderOperation(failure.id, { status: "discarded" })).rejects.toThrow("not found");
  });
  await withOwner(owner, async () => {
    expect((await loadProviderOperationResult(success.id))?.rawText).toBe("Owner-only successful response");
    expect(await loadProviderOperationFailureRawText(failure.id)).toBe("Owner-only failed response");
  });
});
