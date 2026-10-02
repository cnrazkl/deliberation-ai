import { IdempotencyConflictError, MissingContextError, RiskConfigurationError } from "@deliberation-ai/application";
import { createRunRequestSchema } from "@deliberation-ai/contracts";
import { ExecutionPlanLimitsError } from "@deliberation-ai/domain";
import { ContinuationUnavailableError, AttachmentValidationError, createAwaitingPreflightDraft, enqueueDurableRun, listDurableRuns, MemorySelectionError, PreflightMismatchError } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../lib/request-security";
import { ConversationPendingError } from "@deliberation-ai/persistence";
import { conversationError } from "../../../lib/conversation-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const before = new URL(request.url).searchParams.get("before");
  if (before !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before)) {
    return Response.json({ error: "Geçersiz çalışma geçmişi imleci." }, { status: 400 });
  }
  const page = await listDurableRuns(before ?? undefined);
  if (!page) return Response.json({ error: "Çalışma geçmişi imleci bulunamadı." }, { status: 404 });
  return Response.json(page, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Geçerli bir JSON gövdesi gerekli." }, { status: 400 });
  }

  const parsed = createRunRequestSchema.safeParse(body);
  if (!parsed.success) {
    const riskIssue = parsed.error.issues.find((issue) => issue.message.startsWith("Yüksek riskte"));
    return Response.json(
      { error: riskIssue?.message ?? "Soru 10–4000 karakter olmalı ve istek alanları geçerli olmalı." },
      { status: 422 },
    );
  }

  try {
    const run = await enqueueDurableRun(parsed.data);
    return Response.json(run, { status: 201 });
  } catch (error) {
    if (error instanceof ConversationPendingError) return conversationError(error);
    if (error instanceof ContinuationUnavailableError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof MissingContextError) {
      try {
        const draft = await createAwaitingPreflightDraft(parsed.data);
        return Response.json({ preflightDraft: draft }, { status: 202, headers: { "Cache-Control": "no-store" } });
      } catch (draftError) {
        if (draftError instanceof ExecutionPlanLimitsError) return Response.json({ error: draftError.message }, { status: 422 });
        if (draftError instanceof IdempotencyConflictError) return Response.json({ error: draftError.message }, { status: 409 });
        return Response.json({ error: "Bekleyen ön değerlendirme kaydedilemedi." }, { status: 500 });
      }
    }
    if (error instanceof RiskConfigurationError) {
      return Response.json({ error: error.message, riskAssessment: error.assessment }, { status: 422 });
    }
    if (error instanceof ExecutionPlanLimitsError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof IdempotencyConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof PreflightMismatchError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof MemorySelectionError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof AttachmentValidationError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    return Response.json({ error: "Konsey çalışması tamamlanamadı." }, { status: 500 });
  }
}
