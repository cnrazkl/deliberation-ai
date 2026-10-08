import { withLocalSession } from "../../../../../lib/local-auth";
import { cancelDurableRun } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionPOST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await context.params;
  const run = await cancelDurableRun(id);
  if (!run) {
    return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  }
  return Response.json(run);
}

export const POST = withLocalSession(sessionPOST);
