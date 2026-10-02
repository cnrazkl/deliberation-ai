import { rejectResearchCaptureSchema, researchCaptureIdSchema } from "@deliberation-ai/contracts";
import { rejectResearchCapture, ResearchCaptureStateError } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await context.params;
  const parsedId = researchCaptureIdSchema.safeParse(id);
  const parsedBody = rejectResearchCaptureSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return Response.json({ error: "Araştırma yakalaması kararı geçersiz." }, { status: 400 });
  }
  try {
    const capture = await rejectResearchCapture(parsedId.data);
    if (!capture) return Response.json({ error: "Araştırma yakalaması bulunamadı." }, { status: 404 });
    return Response.json(capture);
  } catch (error) {
    if (error instanceof ResearchCaptureStateError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
