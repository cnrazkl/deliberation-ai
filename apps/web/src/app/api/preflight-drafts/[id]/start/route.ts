import { IdempotencyConflictError, RiskConfigurationError } from "@deliberation-ai/application";
import { ContinuationUnavailableError, AttachmentValidationError, MemorySelectionError, PreflightDraftError, PreflightMismatchError, startPreflightDraft } from "@deliberation-ai/persistence";
import { z } from "zod";
import { promptRevisionSchema } from "@deliberation-ai/contracts";
import { ExecutionPlanLimitsError } from "@deliberation-ai/domain";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  choice: z.enum(["answer", "original"]), answer: z.string().trim().max(1_500).optional(),
  promptRevision: promptRevisionSchema.optional(),
  expectedPromptFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRiskFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Açıklama veya önizleme bilgisi geçersiz." }, { status: 422 });
  try {
    const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Ön değerlendirme kimliği geçersiz." }, { status: 400 });
    const run = await startPreflightDraft({ id, ...parsed.data });
    return Response.json(run, { status: 201 });
  } catch (error) {
    if (error instanceof ContinuationUnavailableError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof PreflightDraftError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof PreflightMismatchError || error instanceof IdempotencyConflictError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof RiskConfigurationError || error instanceof AttachmentValidationError || error instanceof MemorySelectionError || error instanceof ExecutionPlanLimitsError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof Error && /Açıklama|4000 karakter/u.test(error.message)) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "Ön değerlendirmeden çalışma başlatılamadı." }, { status: 500 });
  }
}
