import { withLocalSession } from "../../../../lib/local-auth";
import { evidenceSourceIdSchema, updateEvidenceSourceSchema } from "@deliberation-ai/contracts";
import {
  EvidenceSourceInUseError,
  updateEvidenceSourceReview,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionPATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await context.params;
  const parsedId = evidenceSourceIdSchema.safeParse(id);
  const parsedBody = updateEvidenceSourceSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return Response.json({ error: "Kanıt inceleme durumu geçersiz." }, { status: 400 });
  }
  try {
    const source = await updateEvidenceSourceReview(parsedId.data, parsedBody.data);
    if (!source) return Response.json({ error: "Kanıt kaydı bulunamadı." }, { status: 404 });
    return Response.json(source);
  } catch (error) {
    if (error instanceof EvidenceSourceInUseError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

export const PATCH = withLocalSession(sessionPATCH);
