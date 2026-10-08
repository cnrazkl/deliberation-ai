import { withLocalSession } from "../../../../../lib/local-auth";
import { deleteClaimRelationSchema, saveClaimRelationSchema } from "@deliberation-ai/contracts";
import { deleteDurableClaimRelation, saveDurableClaimRelation } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionPOST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = saveClaimRelationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "İki farklı iddia, ilişki türü ve kısa bir gerekçe gerekli." }, { status: 422 });
  const { id } = await context.params;
  const run = await saveDurableClaimRelation(id, parsed.data);
  return run
    ? Response.json(run)
    : Response.json({ error: "İddialar bulunamadı veya 100 ilişki sınırına ulaşıldı." }, { status: 404 });
}

async function sessionDELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = deleteClaimRelationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "İki farklı iddia kimliği gerekli." }, { status: 422 });
  const { id } = await context.params;
  const run = await deleteDurableClaimRelation(id, parsed.data);
  return run
    ? Response.json(run)
    : Response.json({ error: "Çalışma veya ilişki bulunamadı." }, { status: 404 });
}

export const POST = withLocalSession(sessionPOST);
export const DELETE = withLocalSession(sessionDELETE);
