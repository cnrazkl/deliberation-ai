import { z } from "zod";
import { evidencePublicationCommitSchema, evidencePublicationPreviewRequestSchema } from "@deliberation-ai/contracts";
import { previewEvidencePublication, commitEvidencePublication, listEvidencePublications, acknowledgeManualEvidencePublication,
  EvidencePublicationConflictError, KnowledgeCapacityError, KnowledgeIntakeBusyError } from "@deliberation-ai/persistence";
import { KnowledgeAccessError } from "@deliberation-ai/application";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const mutation = z.discriminatedUnion("action", [
  evidencePublicationPreviewRequestSchema.extend({ action: z.literal("preview") }).strict(),
  evidencePublicationCommitSchema.extend({ action: z.literal("commit") }).strict(),
  z.object({ action: z.literal("acknowledge"), id: z.string().uuid(), consent: z.literal(true) }).strict(),
]);
export async function GET(request: Request) {
  const url = new URL(request.url), runId = z.string().uuid().safeParse(url.searchParams.get("runId"));
  if (!runId.success) return json({ error: "Çalışma kimliği geçersiz." }, 400);
  const publications = await listEvidencePublications(runId.data);
  const id = url.searchParams.get("download");
  if (id) {
    const publication = publications.find((value) => value.id === id);
    if (!publication) return json({ error: "Kayıt bulunamadı." }, 404);
    return Response.json(publication, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="deliberationai-evidence-${publication.id}.json"` } });
  }
  return json({ publications });
}
export async function POST(request: Request) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    if (!request.body) return json({ error: "İstek gerekli." }, 400);
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
      if (bytes > 16 * 1024) { await reader.cancel(); return json({ error: "İstek sınırı aşıldı." }, 413); } chunks.push(next.value); }
    const parsed = mutation.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return json({ error: "Kaydetme isteği geçersiz." }, 422);
    const { action, ...body } = parsed.data;
    if (action === "preview") return json(await previewEvidencePublication(evidencePublicationPreviewRequestSchema.parse(body)));
    if (action === "commit") return json(await commitEvidencePublication(evidencePublicationCommitSchema.parse(body)));
    return json(await acknowledgeManualEvidencePublication(z.object({ id: z.string().uuid() }).parse(body).id));
  } catch (error) {
    if (error instanceof KnowledgeAccessError) return json({ error: "Kaynak veya hedef izni geçersiz." }, 403);
    if (error instanceof EvidencePublicationConflictError || error instanceof KnowledgeCapacityError || error instanceof KnowledgeIntakeBusyError) return json({ error: error.message }, 409);
    return json({ error: "Kanıt kaydedilemedi; içerik ve hedefi yeniden inceleyin." }, 422);
  }
}
