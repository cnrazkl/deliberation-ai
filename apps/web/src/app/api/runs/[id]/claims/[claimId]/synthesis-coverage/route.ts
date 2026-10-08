import { withLocalSession } from "../../../../../../../lib/local-auth";
import { updateClaimSynthesisCoverageSchema } from "@deliberation-ai/contracts";
import { updateDurableClaimSynthesisCoverage } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionPATCH(
  request: Request,
  context: { params: Promise<{ id: string; claimId: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = updateClaimSynthesisCoverageSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "Sentez kapsamı geçersiz." }, { status: 400 });
  }
  const { id, claimId } = await context.params;
  const run = await updateDurableClaimSynthesisCoverage(
    id,
    claimId,
    parsed.data.synthesisCoverage,
  );
  if (!run) {
    return Response.json({ error: "Çalışma veya iddia bulunamadı." }, { status: 404 });
  }
  return Response.json(run);
}

export const PATCH = withLocalSession(sessionPATCH);
