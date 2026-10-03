import { exportConversation } from "@deliberation-ai/persistence";
import { conversationError } from "../../../../../lib/conversation-errors";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";
import { createConversationMarkdown, MarkdownExportSizeError } from "../../../../../lib/markdown-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "md") return Response.json({ error: "Dışa aktarım biçimi geçersiz." }, { status: 400 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
  try {
    const result = await exportConversation(id);
    if (!result) return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
    if (format === "md") return new Response(createConversationMarkdown(result), { headers: {
      "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="deliberationai-conversation-${id}.md"`,
    } });
    return Response.json(result, { headers: {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="deliberationai-conversation-${id}.json"`,
    } });
  } catch (error) {
    if (error instanceof MarkdownExportSizeError) return Response.json({ error: "Markdown dosyası boyut sınırını aşıyor; JSON biçimini kullanın." }, { status: 413 });
    return conversationError(error);
  }
}
