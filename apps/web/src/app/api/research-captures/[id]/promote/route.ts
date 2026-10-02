import { promoteResearchCaptureSchema, researchCaptureIdSchema } from "@deliberation-ai/contracts";
import { promoteResearchCapture, ResearchCaptureStateError } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await context.params;
  const parsedId = researchCaptureIdSchema.safeParse(id);
  const parsedBody = promoteResearchCaptureSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return Response.json({ error: "Kanıt kaydına dönüştürme isteği geçersiz." }, { status: 400 });
  }
  try {
    const result = await promoteResearchCapture(parsedId.data, parsedBody.data);
    if (!result) return Response.json({ error: "Araştırma yakalaması bulunamadı." }, { status: 404 });
    return Response.json(result);
  } catch (error) {
    if (error instanceof ResearchCaptureStateError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
