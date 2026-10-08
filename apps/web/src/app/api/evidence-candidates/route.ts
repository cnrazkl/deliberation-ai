import { withLocalSession } from "../../../lib/local-auth";
import { createEvidenceCandidateSchema, evidenceSourceIdSchema } from "@deliberation-ai/contracts";
import { createEvidenceCandidate, listEvidenceCandidates, EvidenceCandidateConflictError, EvidenceSourceLimitError } from "@deliberation-ai/persistence";
import { KnowledgeAccessError } from "@deliberation-ai/application";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function sessionGET(request: Request) {
  const parsed = evidenceSourceIdSchema.safeParse(new URL(request.url).searchParams.get("runId"));
  if (!parsed.success) return response({ error: "Çalışma kimliği geçersiz." }, 400);
  const candidates = await listEvidenceCandidates(parsed.data);
  if (candidates && new URL(request.url).searchParams.get("download") === "1") return Response.json({ version: "evidence-candidate-export-v1", runId: parsed.data, exportedAt: new Date().toISOString(), candidates }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="deliberationai-candidates-${parsed.data}.json"` },
  });
  return candidates ? response({ candidates }) : response({ error: "Çalışma bulunamadı." }, 404);
}
async function sessionPOST(request: Request) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    if (!request.body) return response({ error: "İstek gerekli." }, 400);
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 32 * 1024) { await reader.cancel(); return response({ error: "Aday boyutu sınırı aşıldı." }, 413); } chunks.push(next.value); }
    const parsed = createEvidenceCandidateSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return response({ error: "Aday gönderisi geçersiz." }, 422);
    const candidate = await createEvidenceCandidate(parsed.data);
    return candidate ? response(candidate) : response({ error: "Çalışma veya iddia bulunamadı." }, 404);
  } catch (error) {
    if (error instanceof EvidenceCandidateConflictError || error instanceof EvidenceSourceLimitError) return response({ error: error.message }, 409);
    if (error instanceof KnowledgeAccessError) return response({ error: "Kaynak izni geçersiz; aday oluşturulamadı." }, 403);
    return response({ error: "Aday kaydedilemedi; gönderiyi ve kaynak iznini kontrol edin." }, 422);
  }
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
