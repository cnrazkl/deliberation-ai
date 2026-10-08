import { withLocalSession } from "../../../../../lib/local-auth";
import { exportPrivateBranch } from "@deliberation-ai/persistence";
import { privateBranchError, privateBranchJson, privateBranchOrigin, privateBranchUuid } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function sessionPOST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params; if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Dal bulunamadı." }, 404);
  try {
    const branch = await exportPrivateBranch(id.toLowerCase());
    return branch ? privateBranchJson(branch) : privateBranchJson({ error: "Dal bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}

export const POST = withLocalSession(sessionPOST);
