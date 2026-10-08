import { logoutLocalUser } from "@deliberation-ai/persistence";
import { authAction, authResponse, localSessionToken } from "../../../../lib/local-auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return authAction(request, async () => { await logoutLocalUser(localSessionToken(request)); return authResponse(request, { loggedOut: true }, 200, undefined, true); });
}
