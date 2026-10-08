import { withLocalSession } from "../../../../../../../lib/local-auth";
import { updateClaimEvidenceStateSchema } from "@deliberation-ai/contracts";
import {
  EvidenceRequirementError,
  updateDurableClaimEvidenceState,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionPATCH(
  request: Request,
  context: { params: Promise<{ id: string; claimId: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = updateClaimEvidenceStateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Kanıt durumu geçersiz." }, { status: 400 });
  }
  const { id, claimId } = await context.params;
  let run;
  try {
    run = await updateDurableClaimEvidenceState(id, claimId, parsed.data.evidenceState);
  } catch (error) {
    if (error instanceof EvidenceRequirementError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  if (!run) {
    return Response.json({ error: "Çalışma veya iddia bulunamadı." }, { status: 404 });
  }
  return Response.json(run);
}

export const PATCH = withLocalSession(sessionPATCH);
