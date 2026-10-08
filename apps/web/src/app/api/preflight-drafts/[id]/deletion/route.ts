import { withLocalSession } from "../../../../../lib/local-auth";
import { deletePreflightDraftSchema } from "@deliberation-ai/contracts";
import { deletePreflightDraftContent, previewPreflightDraftDeletion, PreflightDraftDeletionBlockedError,
  PreflightDraftDeletionStaleError, ConversationIntegrityError } from "@deliberation-ai/persistence";
import { privateBranchUuid as uuid, privateBranchJson as json, privateBranchOrigin, privateBranchRequest } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  if (error instanceof PreflightDraftDeletionBlockedError) return json({ error: "Taslak güvenli silme koşullarını karşılamıyor." }, 409);
  if (error instanceof PreflightDraftDeletionStaleError) return json({ error: "Taslak değişti. Silme önizlemesini yenileyin." }, 409);
  if (error instanceof ConversationIntegrityError) return json({ error: "Taslak kayıt tutarlılığı doğrulanamadı." }, 409);
  return json({ error: "Taslak silme işlemi tamamlanamadı." }, 500);
}
async function sessionGET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Taslak bulunamadı." }, 404);
  try { const preview = await previewPreflightDraftDeletion(id.toLowerCase());
    return preview ? json(preview) : json({ error: "Taslak bulunamadı veya içeriği zaten silinmiş." }, 404);
  } catch (error) { return failure(error); }
}
async function sessionPOST(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Taslak bulunamadı." }, 404);
  const parsed = await privateBranchRequest(request, deletePreflightDraftSchema, 4_096);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.draftId.toLowerCase() !== id.toLowerCase()) return json({ error: "Silme onayı geçersiz." }, 422);
  try { const receipt = await deletePreflightDraftContent(id.toLowerCase(), parsed.data.fingerprint);
    return receipt ? json({ deleted: true, receipt }) : json({ error: "Taslak bulunamadı." }, 404);
  } catch (error) { return failure(error); }
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
