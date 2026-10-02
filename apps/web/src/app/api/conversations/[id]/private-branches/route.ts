import { listPrivateBranches } from "@deliberation-ai/persistence";
import { privateBranchError, privateBranchJson, privateBranchUuid } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Konuşma bulunamadı." }, 404);
  try {
    const branches = await listPrivateBranches(id.toLowerCase());
    return branches ? privateBranchJson({ branches }) : privateBranchJson({ error: "Konuşma bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
