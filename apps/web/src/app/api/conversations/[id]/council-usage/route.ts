import { loadConversationCouncilUsage } from "@deliberation-ai/persistence";
import { privateBranchUuid, privateBranchJson, privateBranchError } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Konuşma bulunamadı." }, 404);
  try {
    const usage = await loadConversationCouncilUsage(id.toLowerCase());
    return usage ? privateBranchJson({ usage }) : privateBranchJson({ error: "Konuşma bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
