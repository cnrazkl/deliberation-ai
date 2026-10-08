import { withLocalSession } from "../../../../../lib/local-auth";
import { deleteRunBodySchema } from "@deliberation-ai/contracts";
import { deleteRunBody, previewRunDeletion, RunDeletionBlockedError, RunDeletionStaleError,
  ConversationIntegrityError, ConversationSizeError } from "@deliberation-ai/persistence";
import { privateBranchUuid as uuid, privateBranchJson as json, privateBranchOrigin, privateBranchRequest } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  if (error instanceof RunDeletionBlockedError) return json({ error: "Çalışma şu anda silinemez. İşlem durumunu ve kopyaları kontrol edip önizlemeyi yenileyin." }, 409);
  if (error instanceof RunDeletionStaleError) return json({ error: "Çalışma değişti. Yeni silme önizlemesini inceleyin." }, 409);
  if (error instanceof ConversationIntegrityError) return json({ error: "Kayıt tutarlılığı doğrulanamadı." }, 409);
  if (error instanceof ConversationSizeError) return json({ error: "Kayıt güvenli inceleme sınırını aşıyor." }, 413);
  return json({ error: "Çalışma silme işlemi tamamlanamadı." }, 500);
}
async function sessionGET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Çalışma bulunamadı." }, 404);
  try { const value = await previewRunDeletion(id.toLowerCase()); return value ? json(value) : json({ error: "Çalışma bulunamadı." }, 404); }
  catch (error) { return failure(error); }
}
async function sessionPOST(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Çalışma bulunamadı." }, 404);
  const parsed = await privateBranchRequest(request, deleteRunBodySchema, 4_096);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.runId.toLowerCase() !== id.toLowerCase()) return json({ error: "Silme onayı geçersiz." }, 422);
  try { const audit = await deleteRunBody(id.toLowerCase(), parsed.data.fingerprint);
    return audit ? json({ deleted: true, audit }) : json({ error: "Çalışma bulunamadı." }, 404);
  } catch (error) { return failure(error); }
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
