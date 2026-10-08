import { registerLocalUser } from "@deliberation-ai/persistence";
import { authAction, authJson, authResponse } from "../../../../lib/local-auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return authAction(request, async () => authResponse(request, { user: await registerLocalUser(await authJson(request)) }, 201));
}
