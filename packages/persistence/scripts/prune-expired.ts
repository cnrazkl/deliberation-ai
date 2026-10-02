import { closeDatabase } from "../src/database";
import { pruneExpiredRuns } from "../src/run-retention";

const retentionDays = Number(process.env.RUN_RETENTION_DAYS ?? "30");
const apply = process.argv.slice(2).includes("--apply");
if (process.argv.slice(2).some((argument) => argument !== "--apply")) {
  throw new Error("Only --apply is supported.");
}

try {
  const result = await pruneExpiredRuns({ retentionDays, apply });
  const verb = result.applied ? "Deleted" : "Would delete";
  console.log(`${verb} ${result.count} expired local run(s) finished before ${result.cutoff.toISOString()}.`);
} finally {
  await closeDatabase();
}
