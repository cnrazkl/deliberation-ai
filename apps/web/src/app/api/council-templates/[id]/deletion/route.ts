import { withLocalSession } from "../../../../../lib/local-auth";
import { deleteCouncilTemplateSchema } from "@deliberation-ai/contracts";
import { deleteCouncilTemplateContent, previewCouncilTemplateDeletion, CouncilTemplateDeletionBlockedError,
  CouncilTemplateDeletionStaleError, ConversationIntegrityError } from "@deliberation-ai/persistence";
import { privateBranchUuid as uuid, privateBranchJson as json, privateBranchOrigin, privateBranchRequest } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  if (error instanceof CouncilTemplateDeletionBlockedError) return json({ error: "Şablon güvenli silme koşullarını karşılamıyor." }, 409);
  if (error instanceof CouncilTemplateDeletionStaleError) return json({ error: "Şablon değişti. Silme önizlemesini yenileyin." }, 409);
  if (error instanceof ConversationIntegrityError) return json({ error: "Şablon kayıt tutarlılığı doğrulanamadı." }, 409);
  return json({ error: "Şablon silme işlemi tamamlanamadı." }, 500);
}
async function sessionGET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Şablon bulunamadı." }, 404);
  try {
    const preview = await previewCouncilTemplateDeletion(id.toLowerCase());
    return preview ? json(preview) : json({ error: "Şablon bulunamadı." }, 404);
  } catch (error) { return failure(error); }
}
async function sessionPOST(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Şablon bulunamadı." }, 404);
  const parsed = await privateBranchRequest(request, deleteCouncilTemplateSchema, 4_096);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.templateId.toLowerCase() !== id.toLowerCase()) return json({ error: "Silme onayı geçersiz." }, 422);
  try {
    const receipt = await deleteCouncilTemplateContent(id.toLowerCase(), parsed.data.fingerprint);
    return receipt ? json({ deleted: true, receipt }) : json({ error: "Şablon bulunamadı." }, 404);
  } catch (error) { return failure(error); }
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
