import { withLocalSession } from "../../../../../lib/local-auth";
import { acknowledgeGenerationCheckSchema, generationCheckRequestSchema } from "@deliberation-ai/contracts";
import { acknowledgeConnectionGenerationCheck, ConnectionCheckConflictError, reviewConnectionGenerationCheck, runConnectionGenerationCheck } from "@deliberation-ai/persistence";
import { privateBranchOrigin, privateBranchRequest } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
type Context = { params: Promise<{ id: string }> };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
async function sessionGET(request: Request, context: Context) {
  const { id } = await context.params;
  const model = new URL(request.url).searchParams.get("model") ?? undefined;
  if (!uuid.test(id) || model !== undefined && !generationCheckRequestSchema.shape.model.safeParse(model).success) return Response.json({ error: "Bağlantı veya model geçersiz." }, { status: 400, headers });
  const review = await reviewConnectionGenerationCheck(id, model);
  return review ? Response.json(review, { headers }) : Response.json({ error: "Bağlantı bulunamadı." }, { status: 404, headers });
}
async function sessionPOST(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!uuid.test(id)) return Response.json({ error: "Bağlantı kimliği geçersiz." }, { status: 400, headers });
  const parsed = await privateBranchRequest(request, generationCheckRequestSchema, 2048);
  if ("response" in parsed) return parsed.response;
  try {
    const result = await runConnectionGenerationCheck(id, parsed.data);
    return result ? Response.json(result, { headers }) : Response.json({ error: "Bağlantı bulunamadı." }, { status: 404, headers });
  } catch (error) {
    if (error instanceof ConnectionCheckConflictError) return Response.json({ error: "Onay, deneme kimliği, bekleyen sonuç veya kayıt sınırı nedeniyle gönderim engellendi. İncelemeyi yenileyin.", reason: error.reason }, { status: 409, headers });
    return Response.json({ error: "Deneme sonucu kaydedilemedi; aynı deneme kimliğiyle kaydı kontrol edin. Otomatik tekrar yapılmadı." }, { status: 503, headers });
  }
}

async function sessionPATCH(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!uuid.test(id)) return Response.json({ error: "Bağlantı kimliği geçersiz." }, { status: 400, headers });
  const parsed = await privateBranchRequest(request, acknowledgeGenerationCheckSchema, 2048);
  if ("response" in parsed) return parsed.response;
  try {
    const check = await acknowledgeConnectionGenerationCheck(id, parsed.data);
    return check ? Response.json(check, { headers }) : Response.json({ error: "Bağlantı bulunamadı." }, { status: 404, headers });
  } catch (error) {
    if (error instanceof ConnectionCheckConflictError) return Response.json({ error: "Deneme henüz bekliyor veya kayıt değişti.", reason: error.reason }, { status: 409, headers });
    return Response.json({ error: "Deneme kaydı güncellenemedi." }, { status: 503, headers });
  }
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
export const PATCH = withLocalSession(sessionPATCH);
