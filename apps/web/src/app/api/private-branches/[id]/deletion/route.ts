import { withLocalSession } from "../../../../../lib/local-auth";
import { deletePrivateBranchSchema } from "@deliberation-ai/contracts";
import { deletePrivateBranch, previewPrivateBranchDeletion, PrivateBranchDeletionBlockedError, PrivateBranchDeletionStaleError } from "@deliberation-ai/persistence";
import { privateBranchUuid, privateBranchJson as json, privateBranchOrigin, privateBranchRequest, privateBranchError } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function sessionGET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return json({ error: "Özel dal bulunamadı." }, 404);
  try { const value = await previewPrivateBranchDeletion(id.toLowerCase()); return value ? json(value) : json({ error: "Özel dal bulunamadı." }, 404); }
  catch (error) { return privateBranchError(error); }
}
async function sessionPOST(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!privateBranchUuid.test(id)) return json({ error: "Özel dal bulunamadı." }, 404);
  const parsed = await privateBranchRequest(request, deletePrivateBranchSchema, 4_096);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.branchId.toLowerCase() !== id.toLowerCase()) return json({ error: "Silme onayı geçersiz." }, 422);
  try {
    const audit = await deletePrivateBranch(id.toLowerCase(), parsed.data.fingerprint);
    return audit ? json({ deleted: true, audit }) : json({ error: "Özel dal bulunamadı." }, 404);
  } catch (error) {
    if (error instanceof PrivateBranchDeletionBlockedError) return json({ error: "Bu dal şu anda silinemez. Gönderimleri ve kopyaları kontrol edip önizlemeyi yenileyin." }, 409);
    if (error instanceof PrivateBranchDeletionStaleError) return json({ error: "Dal değişti. Yeni silme önizlemesini inceleyin." }, 409);
    return privateBranchError(error);
  }
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
