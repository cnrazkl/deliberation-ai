import { saveCouncilTemplateSchema } from "@deliberation-ai/contracts";
import {
  CouncilTemplateConflictError,
  listCouncilTemplates,
  saveCouncilTemplate,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ templates: await listCouncilTemplates() });
}

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Geçerli bir JSON gövdesi gerekli." }, { status: 400 });
  }
  const parsed = saveCouncilTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Konsey şablonu geçersiz." }, { status: 422 });
  }
  try {
    return Response.json(await saveCouncilTemplate(parsed.data));
  } catch (reason) {
    if (reason instanceof CouncilTemplateConflictError) {
      return Response.json({ error: "Şablon değişmiş, silinmiş veya bu ad farklı bir şablonda kullanılıyor. Listeyi yenileyin ya da farklı bir ad seçin." }, { status: 409 });
    }
    return Response.json({ error: "Konsey şablonu kaydedilemedi." }, { status: 409 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  return Response.json({ error: "Önce şablon silme önizlemesini inceleyin ve onaylayın." }, { status: 405, headers: { "Cache-Control": "no-store" } });
}
