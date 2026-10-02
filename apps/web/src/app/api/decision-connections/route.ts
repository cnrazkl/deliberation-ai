import { saveDecisionConnectionSchema } from "@deliberation-ai/evaluation";
import {
  deleteDecisionConnection,
  DecisionConnectionInUseError,
  DecisionConnectionSecretRequiredError,
  listDecisionConnections,
  saveDecisionConnection,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({
    connections: await listDecisionConnections(),
    evaluatorEnabled: process.env.ENABLE_DECISION_EVALUATOR === "true",
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Bağlantı kimliği gerekli." }, { status: 400 });
  try {
    return Response.json({ deleted: await deleteDecisionConnection(id) });
  } catch (error) {
    if (error instanceof DecisionConnectionInUseError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = saveDecisionConnectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "TypeSafe bağlantı bilgileri veya tam sürümlü Jev model kimliği geçersiz." },
      { status: 400 },
    );
  }
  try {
    return Response.json(await saveDecisionConnection(parsed.data));
  } catch (error) {
    if (error instanceof DecisionConnectionSecretRequiredError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
