import { withLocalSession } from "../../../lib/local-auth";
import { listDecisionOperationsNeedingAction } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(): Promise<Response> {
  return Response.json({ operations: await listDecisionOperationsNeedingAction() });
}

export const GET = withLocalSession(sessionGET);
