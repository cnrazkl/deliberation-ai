import { exportConversation } from "@deliberation-ai/persistence";
import { conversationError } from "../../../../../lib/conversation-errors";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
  try {
    const result = await exportConversation(id);
    if (!result) return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
    return Response.json(result, { headers: {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="deliberationai-conversation-${id}.json"`,
    } });
  } catch (error) { return conversationError(error); }
}
