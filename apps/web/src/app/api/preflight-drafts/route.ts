import { withLocalSession } from "../../../lib/local-auth";
import { listAwaitingPreflightDrafts } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET() {
  return Response.json({ drafts: await listAwaitingPreflightDrafts() }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withLocalSession(sessionGET);
