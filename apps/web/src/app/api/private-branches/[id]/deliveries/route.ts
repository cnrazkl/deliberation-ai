import { sendPrivateDeliverySchema, controlPrivateDeliverySchema } from "@deliberation-ai/contracts";
import { previewPrivateDelivery, enqueuePrivateDelivery, controlPrivateDelivery } from "@deliberation-ai/persistence";
import { privateBranchError, privateBranchJson, privateBranchOrigin, privateBranchRequest, privateBranchUuid } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Geçersiz dal." }, 400);
  try {
    const preview = await previewPrivateDelivery(id);
    return preview ? privateBranchJson(preview) : privateBranchJson({ error: "Dal bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
export async function POST(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Geçersiz dal." }, 400);
  const parsed = await privateBranchRequest(request, sendPrivateDeliverySchema); if ("response" in parsed) return parsed.response;
  try {
    const result = await enqueuePrivateDelivery(id, parsed.data);
    return result ? privateBranchJson(result, 202) : privateBranchJson({ error: "Dal bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
export async function PATCH(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return privateBranchJson({ error: "Geçersiz dal." }, 400);
  const parsed = await privateBranchRequest(request, controlPrivateDeliverySchema); if ("response" in parsed) return parsed.response;
  try {
    const result = await controlPrivateDelivery(id, parsed.data);
    return result ? privateBranchJson(result) : privateBranchJson({ error: "Dal veya işlem bulunamadı." }, 404);
  } catch (error) { return privateBranchError(error); }
}
