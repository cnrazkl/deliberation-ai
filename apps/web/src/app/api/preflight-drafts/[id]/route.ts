import { findPreflightDraft } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Ön değerlendirme kimliği geçersiz." }, { status: 400 });
  const draft = await findPreflightDraft(id);
  return draft ? Response.json(draft, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Ön değerlendirme bulunamadı." }, { status: 404 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Ön değerlendirme kimliği geçersiz." }, { status: 400 });
  return Response.json({ error: "Taslağı silmek için silme önizlemesini inceleyip onaylayın." }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
