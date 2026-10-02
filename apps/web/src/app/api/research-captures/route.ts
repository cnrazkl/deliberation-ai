import { createResearchCaptureSchema, evidenceSourceIdSchema } from "@deliberation-ai/contracts";
import {
  authorizeResearchCapture,
  listResearchCaptures,
  ResearchCaptureLimitError,
  saveResearchCapture,
} from "@deliberation-ai/persistence";
import { RetrievalError, retrievePublicDocument, retrieveRenderedPublicDocument } from "@deliberation-ai/retrieval";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parsed = evidenceSourceIdSchema.safeParse(new URL(request.url).searchParams.get("runId"));
  if (!parsed.success) return Response.json({ error: "Çalışma kimliği geçersiz." }, { status: 400 });
  const captures = await listResearchCaptures(parsed.data);
  if (!captures) return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  return Response.json({ captures });
}

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = createResearchCaptureSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Araştırma getirme isteği geçersiz." }, { status: 400 });
  try {
    const authorized = await authorizeResearchCapture(parsed.data.runId, parsed.data.claimId);
    if (!authorized) return Response.json({ error: "Çalışma veya iddia bulunamadı." }, { status: 404 });
    const document = parsed.data.renderMode === "browser"
      ? await retrieveRenderedPublicDocument(parsed.data.url)
      : await retrievePublicDocument(parsed.data.url);
    const capture = await saveResearchCapture(parsed.data.runId, parsed.data.claimId, document);
    if (!capture) return Response.json({ error: "Çalışma veya iddia bulunamadı." }, { status: 404 });
    return Response.json(capture);
  } catch (error) {
    if (error instanceof ResearchCaptureLimitError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RetrievalError) {
      const status = error.code === "blocked_target" || error.code === "invalid_url" ? 400 : 422;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
