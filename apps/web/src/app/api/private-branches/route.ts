import { createPrivateBranchSchema } from "@deliberation-ai/contracts";
import { createPrivateBranch } from "@deliberation-ai/persistence";
import { privateBranchError, privateBranchJson, privateBranchOrigin, privateBranchRequest } from "../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const parsed = await privateBranchRequest(request, createPrivateBranchSchema); if ("response" in parsed) return parsed.response;
  try {
    const branch = await createPrivateBranch(parsed.data);
    return branch ? privateBranchJson(branch) : privateBranchJson({ error: "Kaynak bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
