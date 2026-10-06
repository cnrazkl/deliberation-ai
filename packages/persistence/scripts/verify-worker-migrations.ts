import { assertDatabaseMigrationCompatibility } from "../src/migration-compatibility";
import { closeDatabase } from "../src/database";

try {
  if (process.argv.length !== 2) throw new Error("Unsupported arguments.");
  await assertDatabaseMigrationCompatibility();
  console.log("Worker migration history matches this source revision; no queue was started.");
} catch {
  console.error("Worker migration history could not be verified; no queue was started.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
