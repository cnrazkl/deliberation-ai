import { z } from "zod";
import { IdempotencyConflictError } from "@deliberation-ai/application";
import { ExecutionPlanLimitsError } from "@deliberation-ai/domain";
import { enqueueSelectedMemberRerun, FollowUpUnavailableError } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";
import { ConversationPendingError } from "@deliberation-ai/persistence";
import { conversationError } from "../../../../../lib/conversation-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  memberId: z.string().min(1).max(80),
  idempotencyKey: z.string().min(8).max(128),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Geçersiz çalışma kimliği." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Geçerli bir JSON gövdesi gerekli." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Üye ve işlem kimliği geçersiz." }, { status: 422 });
  try {
    const run = await enqueueSelectedMemberRerun({ sourceRunId: id, ...parsed.data });
    return Response.json(run, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConversationPendingError) return conversationError(error);
    if (error instanceof ExecutionPlanLimitsError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof IdempotencyConflictError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof FollowUpUnavailableError) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "Üye tekrar çalıştırması başlatılamadı." }, { status: 500 });
  }
}
