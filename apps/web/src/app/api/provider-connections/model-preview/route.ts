import { checkProviderConnectionModels } from "@deliberation-ai/providers";
import { withLocalSession } from "../../../../lib/local-auth";
import { rejectCrossOriginMutation } from "../../../../lib/request-security";
import { CatalogPreviewRequestError, readCatalogPreviewRequest } from "../../../../lib/model-catalog-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionPOST(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  try {
    const draft = await readCatalogPreviewRequest(request);
    const result = await checkProviderConnectionModels({ ...draft, defaultModel: "catalog-preview" });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "Model listesi alınamadı. Bağlantı bilgilerini kontrol edin veya model kimliğini elle girin." },
      { status: error instanceof CatalogPreviewRequestError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const POST = withLocalSession(sessionPOST);
