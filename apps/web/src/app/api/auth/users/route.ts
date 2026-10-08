import { listLocalUsers, registerLocalUser, LocalAuthError } from "@deliberation-ai/persistence";
import { authAction, authJson, authResponse, localSessionToken } from "../../../../lib/local-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return authAction(request, async () => authResponse(request, { users: await listLocalUsers(localSessionToken(request) ?? "") }));
}
export async function POST(request: Request) {
  return authAction(request, async () => {
    const token = localSessionToken(request); if (!token) throw new LocalAuthError("Oturum açmanız gerekiyor.", 401);
    await listLocalUsers(token);
    return authResponse(request, { user: await registerLocalUser(await authJson(request)) }, 201);
  });
}
