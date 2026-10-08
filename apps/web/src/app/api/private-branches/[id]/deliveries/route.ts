import { withLocalSession } from "../../../../../lib/local-auth";
import { sendPrivateDeliverySchema, controlPrivateDeliverySchema, privateDeliverySettingsSchema } from "@deliberation-ai/contracts";
import { previewPrivateDelivery, enqueuePrivateDelivery, controlPrivateDelivery } from "@deliberation-ai/persistence";
import { privateBranchError, privateBranchJson, privateBranchOrigin, privateBranchRequest, privateBranchUuid } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function sessionGET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Geçersiz dal." }, 400);
  const values = new URL(request.url).searchParams.getAll("maxOutputTokens");
  const settings = privateDeliverySettingsSchema.safeParse(values.length === 0 ? {} : { maxOutputTokens: Number(values[0]) });
  if (values.length > 1 || !settings.success) return privateBranchJson({ error: "Çıktı sınırı 128–1024 arasında bir tam sayı olmalı." }, 422);
  try {
    const preview = await previewPrivateDelivery(id, settings.data);
    return preview ? privateBranchJson(preview) : privateBranchJson({ error: "Dal bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
async function sessionPOST(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Geçersiz dal." }, 400);
  const parsed = await privateBranchRequest(request, sendPrivateDeliverySchema); if ("response" in parsed) return parsed.response;
  try {
    const result = await enqueuePrivateDelivery(id, parsed.data);
    return result ? privateBranchJson(result, 202) : privateBranchJson({ error: "Dal bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
async function sessionPATCH(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Geçersiz dal." }, 400);
  const parsed = await privateBranchRequest(request, controlPrivateDeliverySchema); if ("response" in parsed) return parsed.response;
  try {
    const result = await controlPrivateDelivery(id, parsed.data);
    return result ? privateBranchJson(result) : privateBranchJson({ error: "Dal veya işlem bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
export const PATCH = withLocalSession(sessionPATCH);
