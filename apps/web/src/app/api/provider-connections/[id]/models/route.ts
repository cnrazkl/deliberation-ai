import { loadProviderConnectionSecret, saveProviderConnectionCatalogCheck } from "@deliberation-ai/persistence";
import { checkProviderConnectionModels } from "@deliberation-ai/providers";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Bağlantı kimliği geçersiz." }, { status: 400 });
  }
  const connection = await loadProviderConnectionSecret(id);
  if (!connection) return Response.json({ error: "Bağlantı bulunamadı." }, { status: 404 });
  const result = await checkProviderConnectionModels(connection);
  const saved = await saveProviderConnectionCatalogCheck(id, connection.revision, result);
  if (!saved) return Response.json({ error: "Bağlantı kontrol sırasında değişti. Yeniden kontrol edin." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  return Response.json(saved, { headers: { "Cache-Control": "no-store" } });
}
