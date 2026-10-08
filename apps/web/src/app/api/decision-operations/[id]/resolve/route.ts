import { withLocalSession } from "../../../../../lib/local-auth";
import { resolveDecisionOperationSchema } from "@deliberation-ai/evaluation";
import {
  DecisionOperationResolutionError,
  resolveDecisionOperation,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";

async function sessionPOST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = resolveDecisionOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Operatör eylemi geçersiz." }, { status: 400 });
  const { id } = await context.params;
  try {
    const resolved = await resolveDecisionOperation(id, parsed.data.action);
    if (!resolved) return Response.json({ error: "Karar operasyonu bulunamadı." }, { status: 404 });
    return Response.json(resolved);
  } catch (error) {
    if (error instanceof DecisionOperationResolutionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

export const POST = withLocalSession(sessionPOST);
