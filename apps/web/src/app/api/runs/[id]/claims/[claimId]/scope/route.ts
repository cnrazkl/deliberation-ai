import { withLocalSession } from "../../../../../../../lib/local-auth";
import { updateClaimScopeSchema } from "@deliberation-ai/contracts";
import { updateDurableClaimScope } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionPATCH(
  request: Request,
  context: { params: Promise<{ id: string; claimId: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = updateClaimScopeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "İddia kapsamı en fazla 500 karakter olabilir." }, { status: 422 });
  const { id, claimId } = await context.params;
  const run = await updateDurableClaimScope(id, claimId, parsed.data.scopeNote);
  return run
    ? Response.json(run)
    : Response.json({ error: "Çalışma veya iddia bulunamadı." }, { status: 404 });
}

export const PATCH = withLocalSession(sessionPATCH);
