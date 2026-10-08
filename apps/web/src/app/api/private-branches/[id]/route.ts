import { withLocalSession } from "../../../../lib/local-auth";
import { loadPrivateBranch } from "@deliberation-ai/persistence";
import { privateBranchError, privateBranchJson, privateBranchUuid } from "../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function sessionGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Dal bulunamadı." }, 404);
  try {
    const branch = await loadPrivateBranch(id.toLowerCase());
    return branch ? privateBranchJson(branch) : privateBranchJson({ error: "Dal bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}

export const GET = withLocalSession(sessionGET);
