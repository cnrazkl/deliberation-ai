import { cancelDecisionAssessment } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await context.params;
  const cancelled = await cancelDecisionAssessment(id);
  return Response.json({ cancelled }, { status: cancelled ? 200 : 409 });
}
