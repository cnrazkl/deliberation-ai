import { connectionChatReviewSchema, connectionChatSendSchema, type GenerationObservation } from "@deliberation-ai/contracts";
import { ConnectionCheckConflictError, getConnectionCheckHistory, reviewConnectionGenerationCheck, runConnectionChatCheck } from "@deliberation-ai/persistence";
import { NormalizedProviderError } from "@deliberation-ai/providers";
import { withLocalSession } from "../../../../../lib/local-auth";
import { privateBranchOrigin, privateBranchRequest } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function contentFreeReceipt(check: GenerationObservation) {
  const receipt = { ...check }; delete receipt.message; delete receipt.reply; delete receipt.errorDetail; delete receipt.trace;
  return { ...receipt, ...(receipt.kind ? { transient: true } : {}) };
}
async function sessionGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id)) return Response.json({ error: "Bağlantı kimliği geçersiz." }, { status: 400, headers });
  const observations = await getConnectionCheckHistory(id);
  return observations ? Response.json({ observations: { ...observations, generationChecks: observations.generationChecks.map(contentFreeReceipt) } }, { headers }) : Response.json({ error: "Bağlantı bulunamadı." }, { status: 404, headers });
}
async function sessionPOST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id)) return Response.json({ error: "Bağlantı kimliği geçersiz.", code: "invalid_connection" }, { status: 400, headers });
  const parsed = await privateBranchRequest(request, connectionChatReviewSchema.or(connectionChatSendSchema), 2_850_000);
  if ("response" in parsed) return parsed.response;
  try {
    const input = parsed.data;
    if (input.action === "review") {
      const reviewed = await reviewConnectionGenerationCheck(id, input.model, input.message, input.attachments, input.transient, input.debug);
      if (!reviewed) return Response.json({ error: "Bağlantı bulunamadı.", code: "connection_not_found" }, { status: 404, headers });
      const { observations: _observations, ...preview } = reviewed;
      void _observations;
      return Response.json(preview, { headers });
    }
    const result = await runConnectionChatCheck(id, input);
    return result ? Response.json(result, { headers }) : Response.json({ error: "Bağlantı bulunamadı.", code: "connection_not_found" }, { status: 404, headers });
  } catch (error) {
    if (error instanceof NormalizedProviderError && error.code === "test_file_invalid") return Response.json({ error: error.message, code: error.code }, { status: 422, headers });
    if (error instanceof ConnectionCheckConflictError) {
      const messages = { capacity: "Bu bağlantı için 32 test işlemi sınırına ulaşıldı. Yeni API çağrısı yapılmadı.",
        pending: "Önceki test hâlâ bekleniyor. Sonucu Kontrol Et ile durumunu okuyun.",
        acknowledgement: "Önceki testin uzak sonucu bilinmiyor. Yeni testten önce belirsizliği değerlendirin.",
        stale: "Bağlantı veya test girdisi değişti. Güncel ayarlarla yeniden gönderin.",
        identity: "Bu test kimliği başka bir girdiye ait. Sonucu Kontrol Et ile durumunu okuyun." };
      return Response.json({ error: messages[error.reason], code: `check_${error.reason}`, reason: error.reason }, { status: 409, headers });
    }
    return Response.json({ error: "Sonuç doğrulanamadı. Aynı deneme kimliğiyle kaydı kontrol edin; otomatik tekrar yapılmadı.", code: "check_storage_unavailable" }, { status: 503, headers });
  }
}
export const POST = withLocalSession(sessionPOST);
export const GET = withLocalSession(sessionGET);
