import { withLocalSession } from "../../../lib/local-auth";
import { createScheduleSchema, updateScheduleSchema } from "@deliberation-ai/contracts";
import { IdempotencyConflictError, MissingContextError, RiskConfigurationError } from "@deliberation-ai/application";
import { ExecutionPlanLimitsError } from "@deliberation-ai/domain";
import { createLocalSchedule, listLocalSchedules, updateLocalSchedule } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET() {
  return Response.json({ schedules: await listLocalSchedules() }, { headers: { "cache-control": "no-store" } });
}

async function sessionPOST(request: Request) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = createScheduleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.find((issue) => issue.message.startsWith("Yüksek riskte"))?.message ?? "Zamanlama alanları geçersiz." }, { status: 422 });
  if (!parsed.data.requestId) return Response.json({ error: "Oluşturma isteğinin kimliği gerekli." }, { status: 422 });
  try {
    return Response.json(await createLocalSchedule(parsed.data), { status: 201 });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return Response.json({ error: "Oluşturma isteği değişmiş veya zamanlama silinmiş." }, { status: 409 });
    if (error instanceof ExecutionPlanLimitsError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof RiskConfigurationError) return Response.json({ error: error.message, riskAssessment: error.assessment }, { status: 422 });
    if (error instanceof MissingContextError) return Response.json({ error: error.message, questions: error.questions }, { status: 422 });
    return Response.json({ error: "Yerel zamanlama oluşturulamadı." }, { status: 500 });
  }
}

async function sessionPATCH(request: Request) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const id = new URL(request.url).searchParams.get("id");
  const parsed = updateScheduleSchema.safeParse(await request.json().catch(() => null));
  if (!id || !parsed.success) return Response.json({ error: "Zamanlama güncellemesi geçersiz." }, { status: 422 });
  try {
    const schedule = await updateLocalSchedule(id, parsed.data);
    return schedule ? Response.json(schedule) : Response.json({ error: "Zamanlama bulunamadı." }, { status: 404 });
  } catch (error) {
    if (error instanceof ExecutionPlanLimitsError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof RiskConfigurationError) return Response.json({ error: error.message, riskAssessment: error.assessment }, { status: 422 });
    if (error instanceof MissingContextError) return Response.json({ error: error.message, questions: error.questions }, { status: 422 });
    return Response.json({ error: "Zamanlama güncellenemedi." }, { status: 500 });
  }
}

async function sessionDELETE(request: Request) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Zamanlama kimliği gerekli." }, { status: 422 });
  return Response.json({ error: "Zamanlamayı silmek için önizlemeyi inceleyip onaylayın." }, { status: 409, headers: { "Cache-Control": "no-store" } });
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
export const PATCH = withLocalSession(sessionPATCH);
export const DELETE = withLocalSession(sessionDELETE);
