import { withLocalSession } from "../../../../../lib/local-auth";
import { loadRunDeletion } from "@deliberation-ai/persistence";
import { privateBranchUuid as uuid, privateBranchJson as json } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
async function sessionGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Silme kaydı bulunamadı." }, 404);
  try { const audit = await loadRunDeletion(id.toLowerCase()); return audit ? json(audit) : json({ error: "Silme kaydı bulunamadı." }, 404); }
  catch { return json({ error: "Silme kaydı okunamadı." }, 500); }
}

export const GET = withLocalSession(sessionGET);
