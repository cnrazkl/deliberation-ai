import { closeDatabase } from "../src/database";
import { indexExistingRunBranches } from "../src/run-branches";
import { indexExistingConversations } from "../src/conversation-membership";

try {
  const indexedBranches = await indexExistingRunBranches();
  console.log(JSON.stringify({ indexedBranches, indexedConversationRuns: await indexExistingConversations() }));
} catch {
  console.error("Konuşma geçmişi doğrulanamadı; aktarım tamamlanmadı.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
