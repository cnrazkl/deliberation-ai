import { readLocalSession } from "@deliberation-ai/persistence";
import { authAction, authResponse, localSessionToken } from "../../../../lib/local-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return authAction(request, async () => authResponse(request, { session: await readLocalSession(localSessionToken(request)) }));
}
