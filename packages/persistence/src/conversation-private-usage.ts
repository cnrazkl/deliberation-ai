import { and, eq, sql } from "drizzle-orm";
import { summarizeConversationPrivateUsage, PrivateUsageIntegrityError } from "@deliberation-ai/domain";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { privateBranchDeletions } from "./schema";
import { exportPrivateBranchesInSnapshot } from "./private-branches";
import { exportPrivateBranchDeletions } from "./private-branch-deletion";
import { ConversationIntegrityError, ConversationSizeError } from "./conversation-membership";

export type ConversationPrivateUsage = ReturnType<typeof summarizeConversationPrivateUsage> & { checkedAt: string };
export function loadConversationPrivateUsage(conversationId: string): Promise<ConversationPrivateUsage | undefined> {
  return getDatabase().transaction(async (tx) => {
    const branches = await exportPrivateBranchesInSnapshot(tx, conversationId);
    if (!branches) return undefined;
    const [foreign] = await tx.select({ id: privateBranchDeletions.id }).from(privateBranchDeletions)
      .where(and(eq(privateBranchDeletions.conversationId, conversationId), sql`${privateBranchDeletions.ownerId} <> ${LOCAL_OWNER_ID}`)).limit(1);
    if (foreign) throw new ConversationIntegrityError();
    const audits = await exportPrivateBranchDeletions(tx, conversationId);
    try {
      const result = { ...summarizeConversationPrivateUsage(branches, audits), checkedAt: new Date().toISOString() };
      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new ConversationSizeError();
      return result;
    } catch (error) {
      if (error instanceof PrivateUsageIntegrityError) throw new ConversationIntegrityError();
      throw error;
    }
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
