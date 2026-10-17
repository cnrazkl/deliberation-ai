import { authJson, withLocalSession } from "../../../lib/local-auth";
import { listConversations, setConversationArchived } from "@deliberation-ai/persistence";
import { conversationError } from "../../../lib/conversation-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(request: Request) {
  const params = new URL(request.url).searchParams;
  const before = params.get("before");
  const archived = params.get("archived");
  if (archived !== null && archived !== "true" && archived !== "false") return Response.json({ error: "Geçersiz arşiv filtresi." }, { status: 400 });
  if (before !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before)) {
    return Response.json({ error: "Geçersiz müzakere listesi imleci." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const page = await listConversations(before ?? undefined, archived === "true");
    if (!page) return Response.json({ error: "Müzakere listesi imleci bulunamadı." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return conversationError(error); }
}

export const GET = withLocalSession(sessionGET);

async function sessionPATCH(request: Request) {
  const body = await authJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Geçersiz arşiv isteği." }, { status: 400 });
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== "conversationId" && key !== "archived") ||
      typeof value.conversationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.conversationId) ||
      typeof value.archived !== "boolean") return Response.json({ error: "Geçersiz arşiv isteği." }, { status: 400 });
  try {
    const found = await setConversationArchived(value.conversationId, value.archived);
    return found ? Response.json({ archived: value.archived }) : Response.json({ error: "Müzakere bulunamadı." }, { status: 404 });
  } catch (error) { return conversationError(error); }
}
export const PATCH = withLocalSession(sessionPATCH);
