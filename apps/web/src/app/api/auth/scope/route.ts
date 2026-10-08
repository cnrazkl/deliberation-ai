import { selectLocalUserScope, LocalAuthError } from "@deliberation-ai/persistence";
import { authAction, authJson, authResponse, localSessionToken } from "../../../../lib/local-auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return authAction(request, async () => {
    const input = await authJson(request);
    if (!input || typeof input !== "object" || Object.keys(input).some(key => key !== "userId") || !("userId" in input) ||
      typeof input.userId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(input.userId)) throw new LocalAuthError("Kullanıcı seçimi geçersiz.");
    return authResponse(request, await selectLocalUserScope(localSessionToken(request) ?? "", input.userId));
  });
}
