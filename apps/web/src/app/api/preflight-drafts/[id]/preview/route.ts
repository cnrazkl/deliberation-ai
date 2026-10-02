import { ContinuationUnavailableError, preparePreflightDraft, PreflightDraftError, PreflightMismatchError } from "@deliberation-ai/persistence";
import { z } from "zod";
import { promptRevisionSchema } from "@deliberation-ai/contracts";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";
import { estimateTokenPreview } from "../../../../../lib/token-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  choice: z.enum(["answer", "original"]),
  answer: z.string().trim().max(1_500).optional(),
  promptRevision: promptRevisionSchema.optional(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Açıklama seçimi geçersiz." }, { status: 422 });
  try {
    const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Ön değerlendirme kimliği geçersiz." }, { status: 400 });
    const prepared = await preparePreflightDraft(id, parsed.data.choice, parsed.data.answer, parsed.data.promptRevision);
    const preview = estimateTokenPreview({
      question: prepared.question, members: prepared.members, documents: prepared.documents,
      continuationContext: prepared.continuationContext,
      images: prepared.previewImages, memoryContext: prepared.memoryContext, toolContext: prepared.toolContext,
      riskProfile: prepared.riskProfile, reviewRounds: prepared.reviewRounds,
    });
    if (preview.promptPlan?.fingerprint !== prepared.promptPlan.fingerprint ||
      preview.riskPreflight?.fingerprint !== prepared.riskPreflight.fingerprint) throw new PreflightMismatchError();
    return Response.json({ draft: prepared.draft, baseQuestion: prepared.baseQuestion, question: prepared.question,
      promptRevision: prepared.promptRevision, revisionAudit: prepared.revisionAudit, preview,
      imageDimensionsEstimated: prepared.imageDimensionsEstimated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ContinuationUnavailableError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof PreflightDraftError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof PreflightMismatchError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof Error && /Açıklama|4000 karakter/u.test(error.message)) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "Açıklama önizlemesi hazırlanamadı; seçili bağlamı kontrol edin." }, { status: 422 });
  }
}
