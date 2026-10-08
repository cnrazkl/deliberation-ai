import { changeLocalPassword } from "@deliberation-ai/persistence";
import { authAction, authJson, authResponse, localSessionToken } from "../../../../lib/local-auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return authAction(request, async () => {
    const result = await changeLocalPassword(localSessionToken(request) ?? "", await authJson(request));
    return authResponse(request, result.session, 200, result.token);
  });
}
