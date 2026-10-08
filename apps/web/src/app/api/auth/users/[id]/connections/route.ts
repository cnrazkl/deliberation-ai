import { listLocalUsers, withOwner, listProviderConnections, listMcpConnections, listDecisionConnections, LocalAuthError } from "@deliberation-ai/persistence";
import { authAction, authResponse, localSessionToken } from "../../../../../../lib/local-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authAction(request, async () => {
    const users = await listLocalUsers(localSessionToken(request) ?? "");
    const { id } = await context.params;
    const user = users.find(item => item.id === id);
    if (!user) throw new LocalAuthError("Kullanıcı bulunamadı.", 404);
    return withOwner(user.ownerId, async () => authResponse(request, {
      provider: await listProviderConnections(), mcp: await listMcpConnections(), decision: await listDecisionConnections(),
    }));
  });
}
