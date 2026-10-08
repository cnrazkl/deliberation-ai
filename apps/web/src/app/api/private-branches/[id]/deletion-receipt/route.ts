import { withLocalSession } from "../../../../../lib/local-auth";
import { loadPrivateBranchDeletion } from "@deliberation-ai/persistence";
import { privateBranchUuid, privateBranchJson as json, privateBranchError } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
async function sessionGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return json({ error: "Silme kaydı bulunamadı." }, 404);
  try { const value = await loadPrivateBranchDeletion(id.toLowerCase()); return value ? json(value) : json({ error: "Silme kaydı bulunamadı." }, 404); }
  catch (error) { return privateBranchError(error); }
}

export const GET = withLocalSession(sessionGET);
