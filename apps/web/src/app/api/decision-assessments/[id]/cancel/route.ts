import { withLocalSession } from "../../../../../lib/local-auth";
import { cancelDecisionAssessment } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";

async function sessionPOST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await context.params;
  const cancelled = await cancelDecisionAssessment(id);
  return Response.json({ cancelled }, { status: cancelled ? 200 : 409 });
}

export const POST = withLocalSession(sessionPOST);
