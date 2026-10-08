import { withLocalSession } from "../../../lib/local-auth";
import { listConversations } from "@deliberation-ai/persistence";
import { conversationError } from "../../../lib/conversation-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(request: Request) {
  const before = new URL(request.url).searchParams.get("before");
  if (before !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before)) {
    return Response.json({ error: "Geçersiz konuşma listesi imleci." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const page = await listConversations(before ?? undefined);
    if (!page) return Response.json({ error: "Konuşma listesi imleci bulunamadı." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return conversationError(error); }
}

export const GET = withLocalSession(sessionGET);
