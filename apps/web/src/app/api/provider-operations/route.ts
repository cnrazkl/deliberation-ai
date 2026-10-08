import { withLocalSession } from "../../../lib/local-auth";
import { listProviderOperationsNeedingAction } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(): Promise<Response> {
  return Response.json({ operations: await listProviderOperationsNeedingAction() });
}

export const GET = withLocalSession(sessionGET);
