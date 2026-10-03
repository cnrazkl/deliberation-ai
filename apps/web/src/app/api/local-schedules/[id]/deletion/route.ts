import { deleteLocalScheduleSchema } from "@deliberation-ai/contracts";
import { deleteLocalScheduleContent, previewLocalScheduleDeletion, LocalScheduleDeletionBlockedError,
  LocalScheduleDeletionStaleError, ConversationIntegrityError } from "@deliberation-ai/persistence";
import { privateBranchUuid as uuid, privateBranchJson as json, privateBranchOrigin, privateBranchRequest } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  if (error instanceof LocalScheduleDeletionBlockedError) return json({ error: "Zamanlama güvenli silme koşullarını karşılamıyor." }, 409);
  if (error instanceof LocalScheduleDeletionStaleError) return json({ error: "Zamanlama değişti. Silme önizlemesini yenileyin." }, 409);
  if (error instanceof ConversationIntegrityError) return json({ error: "Zamanlama kayıt tutarlılığı doğrulanamadı." }, 409);
  return json({ error: "Zamanlama silme işlemi tamamlanamadı." }, 500);
}
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Zamanlama bulunamadı." }, 404);
  try { const preview = await previewLocalScheduleDeletion(id.toLowerCase());
    return preview ? json(preview) : json({ error: "Zamanlama bulunamadı veya içeriği zaten silinmiş." }, 404);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Zamanlama bulunamadı." }, 404);
  const parsed = await privateBranchRequest(request, deleteLocalScheduleSchema, 4_096);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.scheduleId.toLowerCase() !== id.toLowerCase()) return json({ error: "Silme onayı geçersiz." }, 422);
  try { const receipt = await deleteLocalScheduleContent(id.toLowerCase(), parsed.data.fingerprint);
    return receipt ? json({ deleted: true, receipt }) : json({ error: "Zamanlama bulunamadı." }, 404);
  } catch (error) { return failure(error); }
}
