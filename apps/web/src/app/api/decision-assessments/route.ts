import { withLocalSession } from "../../../lib/local-auth";
import { createDecisionAssessmentSchema } from "@deliberation-ai/evaluation";
import {
  createDecisionAssessment,
  DecisionAssessmentInputError,
  listDecisionAssessments,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(request: Request): Promise<Response> {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return Response.json({ error: "Çalışma kimliği gerekli." }, { status: 400 });
  const assessments = await listDecisionAssessments(runId);
  if (!assessments) return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  return Response.json({ assessments });
}

async function sessionPOST(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  if (process.env.ENABLE_DECISION_EVALUATOR !== "true") {
    return Response.json(
      { error: "Jev karar çağrıları canlı bağlantı testi yapılana kadar yerel ayarlarda kapalı." },
      { status: 409 },
    );
  }
  const parsed = createDecisionAssessmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Karar incelemesi geçersiz veya dış paylaşım açıkça onaylanmadı." },
      { status: 400 },
    );
  }
  try {
    return Response.json(await createDecisionAssessment(parsed.data), { status: 201 });
  } catch (error) {
    if (error instanceof DecisionAssessmentInputError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
