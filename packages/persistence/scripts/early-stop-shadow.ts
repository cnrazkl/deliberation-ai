import { closeDatabase } from "../src/database";
import { inspectStoredEarlyStopShadow } from "../src/early-stop-shadow";

try {
  const runId = process.argv[2];
  if (process.argv.length !== 3 || !runId || !/^[a-f0-9-]{36}$/i.test(runId)) {
    throw new Error("Expected a run UUID");
  }
  console.log(JSON.stringify(await inspectStoredEarlyStopShadow(runId), null, 2));
} catch {
  console.error("Erken durdurma gölge incelemesi yapılamadı. Sahibe ait tamamlanmış bir çalışma kimliği verin.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
