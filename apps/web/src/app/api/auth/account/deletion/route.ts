import { deleteLocalAccount, previewLocalAccountDeletion } from "@deliberation-ai/persistence";
import { authAction, authJson, authResponse, localSessionToken } from "../../../../../lib/local-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return authAction(request, async () => authResponse(request, await previewLocalAccountDeletion(localSessionToken(request) ?? "")));
}
export async function POST(request: Request) {
  return authAction(request, async () => authResponse(request,
    await deleteLocalAccount(localSessionToken(request) ?? "", await authJson(request)), 200, undefined, true));
}
