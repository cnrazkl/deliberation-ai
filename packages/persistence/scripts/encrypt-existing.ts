import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { encryptJson, encryptText } from "../src/crypto";
import { closeDatabase, getDatabase } from "../src/database";
import { claimOccurrences, claims, modelRuns, runs } from "../src/schema";

const db = getDatabase();

try {
  await db.transaction(async (tx) => {
    for (const row of await tx.select().from(runs)) {
      const updates: Partial<typeof runs.$inferInsert> = {};
      if (!row.questionCiphertext) {
        updates.question = "[encrypted]";
        updates.questionCiphertext = encryptText(row.question, `run:${row.id}:question`);
      }
      if (row.report && !row.reportCiphertext) {
        updates.report = null;
        updates.reportCiphertext = encryptJson(row.report, `run:${row.id}:report`);
      }
      if (Object.keys(updates).length > 0) await tx.update(runs).set(updates).where(eq(runs.id, row.id));
    }

    for (const row of await tx.select().from(modelRuns)) {
      const updates: Partial<typeof modelRuns.$inferInsert> = {};
      if (row.rawText && !row.rawTextCiphertext) {
        updates.rawText = "[encrypted]";
        updates.rawTextCiphertext = encryptText(row.rawText, `model-run:${row.id}:raw`);
      }
      if (row.parsedOutput && !row.parsedOutputCiphertext) {
        updates.parsedOutput = null;
        updates.parsedOutputCiphertext = encryptJson(row.parsedOutput, `model-run:${row.id}:parsed`);
      }
      if (Object.keys(updates).length > 0) {
        await tx.update(modelRuns).set(updates).where(eq(modelRuns.id, row.id));
      }
    }

    for (const row of await tx.select().from(claims)) {
      if (!row.statementCiphertext) {
        await tx
          .update(claims)
          .set({
            statement: "[encrypted]",
            statementCiphertext: encryptText(row.statement, `claim:${row.id}:statement`),
          })
          .where(eq(claims.id, row.id));
      }
    }

    for (const row of await tx.select().from(claimOccurrences)) {
      if (!row.quoteCiphertext) {
        const quoteFingerprint = createHash("sha256").update(row.quote).digest("hex");
        await tx
          .update(claimOccurrences)
          .set({
            quote: quoteFingerprint,
            quoteCiphertext: encryptText(
              row.quote,
              `occurrence:${row.claimId}:${row.modelRunId}:${quoteFingerprint}`,
            ),
          })
          .where(
            and(
              eq(claimOccurrences.claimId, row.claimId),
              eq(claimOccurrences.modelRunId, row.modelRunId),
              eq(claimOccurrences.quote, row.quote),
            ),
          );
      }
    }
  });
  console.log("Existing sensitive run content is encrypted.");
} finally {
  await closeDatabase();
}
