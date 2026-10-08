import { updateLocalUser, LocalAuthError } from "@deliberation-ai/persistence";
import { authAction, authJson, authResponse, localSessionToken } from "../../../../../lib/local-auth";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authAction(request, async () => {
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/iu.test(id)) throw new LocalAuthError("Kullanıcı kimliği geçersiz.");
    return authResponse(request, { user: await updateLocalUser(localSessionToken(request) ?? "", id, await authJson(request)) });
  });
}
