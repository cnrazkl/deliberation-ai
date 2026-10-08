import { deleteLocalAccount, previewLocalAccountDeletion, LocalAuthError } from "@deliberation-ai/persistence";
import { authAction, authJson, authResponse, localSessionToken } from "../../../../../../lib/local-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function id(context: { params: Promise<{ id: string }> }) {
  const value = (await context.params).id;
  if (!/^[a-f0-9-]{36}$/iu.test(value)) throw new LocalAuthError("Kullanıcı kimliği geçersiz.");
  return value;
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authAction(request, async () => authResponse(request, await previewLocalAccountDeletion(localSessionToken(request) ?? "", await id(context))));
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authAction(request, async () => authResponse(request, await deleteLocalAccount(localSessionToken(request) ?? "", await authJson(request), await id(context))));
}
