import { closeDatabase, indexExistingRunBranches } from "../src/index";

try {
  console.log(JSON.stringify({ indexedRuns: await indexExistingRunBranches() }));
} catch {
  console.error("Çalışma bağlantıları doğrulanamadı; gezinme indeksi tamamlanmadı.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
