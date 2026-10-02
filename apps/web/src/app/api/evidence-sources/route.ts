import {
  evidenceSourceIdSchema,
  saveEvidenceSourceSchema,
} from "@deliberation-ai/contracts";
import {
  deleteEvidenceSource,
  EvidenceSourceInUseError,
  EvidenceSourceLimitError,
  listEvidenceSources,
  saveEvidenceSource,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parsed = evidenceSourceIdSchema.safeParse(new URL(request.url).searchParams.get("runId"));
  if (!parsed.success) return Response.json({ error: "Çalışma kimliği geçersiz." }, { status: 400 });
  const sources = await listEvidenceSources(parsed.data);
  if (!sources) return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  return Response.json({ sources });
}

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = saveEvidenceSourceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Kanıt kaydı geçersiz." }, { status: 400 });
  try {
    const source = await saveEvidenceSource(parsed.data);
    if (!source) return Response.json({ error: "Çalışma veya iddia bulunamadı." }, { status: 404 });
    return Response.json(source);
  } catch (error) {
    if (error instanceof EvidenceSourceLimitError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = evidenceSourceIdSchema.safeParse(new URL(request.url).searchParams.get("id"));
  if (!parsed.success) return Response.json({ error: "Kanıt kaydı kimliği geçersiz." }, { status: 400 });
  try {
    return Response.json({ deleted: await deleteEvidenceSource(parsed.data) });
  } catch (error) {
    if (error instanceof EvidenceSourceInUseError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
