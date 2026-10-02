import { appendPrivateDraftSchema } from "@deliberation-ai/contracts";
import { appendPrivateDraft } from "@deliberation-ai/persistence";
import { privateBranchError, privateBranchJson, privateBranchOrigin, privateBranchRequest, privateBranchUuid } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params; if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Dal bulunamadı." }, 404);
  const parsed = await privateBranchRequest(request, appendPrivateDraftSchema); if ("response" in parsed) return parsed.response;
  try {
    const branch = await appendPrivateDraft(id.toLowerCase(), parsed.data);
    return branch ? privateBranchJson(branch) : privateBranchJson({ error: "Dal bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
