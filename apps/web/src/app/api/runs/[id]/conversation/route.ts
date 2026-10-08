import { withLocalSession } from "../../../../../lib/local-auth";
import { loadRunConversation } from "@deliberation-ai/persistence";
import { conversationError } from "../../../../../lib/conversation-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function sessionGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
  try {
    const result = await loadRunConversation(id);
    if (!result) return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return conversationError(error); }
}

export const GET = withLocalSession(sessionGET);
