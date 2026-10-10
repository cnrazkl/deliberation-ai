import { connectionChatReviewSchema, connectionChatSendSchema } from "@deliberation-ai/contracts";
import { ConnectionCheckConflictError, getConnectionCheckHistory, reviewConnectionGenerationCheck, runConnectionChatCheck } from "@deliberation-ai/persistence";
import { withLocalSession } from "../../../../../lib/local-auth";
import { privateBranchOrigin, privateBranchRequest } from "../../../../../lib/private-branches-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
async function sessionGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id)) return Response.json({ error: "Bağlantı kimliği geçersiz." }, { status: 400, headers });
  const observations = await getConnectionCheckHistory(id);
  return observations ? Response.json({ observations }, { headers }) : Response.json({ error: "Bağlantı bulunamadı." }, { status: 404, headers });
}
async function sessionPOST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = privateBranchOrigin(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id)) return Response.json({ error: "Bağlantı kimliği geçersiz.", code: "invalid_connection" }, { status: 400, headers });
  const parsed = await privateBranchRequest(request, connectionChatReviewSchema.or(connectionChatSendSchema), 8192);
  if ("response" in parsed) return parsed.response;
  try {
    const input = parsed.data;
    const result = input.action === "review" ? await reviewConnectionGenerationCheck(id, input.model, input.message) : await runConnectionChatCheck(id, input);
    return result ? Response.json(result, { headers }) : Response.json({ error: "Bağlantı bulunamadı.", code: "connection_not_found" }, { status: 404, headers });
  } catch (error) {
    if (error instanceof ConnectionCheckConflictError) return Response.json({ error: "Deneme onayı veya bağlantı değişti. Bekleyen denemeyi kontrol edin.", code: `check_${error.reason}`, reason: error.reason }, { status: 409, headers });
    return Response.json({ error: "Sonuç doğrulanamadı. Aynı deneme kimliğiyle kaydı kontrol edin; otomatik tekrar yapılmadı.", code: "check_storage_unavailable" }, { status: 503, headers });
  }
}
export const POST = withLocalSession(sessionPOST);
export const GET = withLocalSession(sessionGET);
