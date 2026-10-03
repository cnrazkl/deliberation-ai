import { findDurableRunById } from "@deliberation-ai/persistence";
import { createRunExport } from "../../../../../lib/run-export";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";
import { createSynthesisMarkdown, MarkdownExportSizeError } from "../../../../../lib/markdown-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "md") return Response.json({ error: "Dışa aktarım biçimi geçersiz." }, { status: 400 });

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  }
  const run = await findDurableRunById(id);
  if (!run) return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  if (!run.report || !["completed", "partially_completed", "failed", "cancelled"].includes(run.status)) {
    return Response.json({ error: "Bu çalışma için indirilebilir rapor henüz hazır değil." }, { status: 409 });
  }

  if (format === "md") {
    try {
      return new Response(createSynthesisMarkdown(createRunExport(run)), { headers: {
        "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="deliberationai-synthesis-${id}.md"`,
      } });
    } catch (error) {
      if (error instanceof MarkdownExportSizeError) return Response.json({ error: "Markdown dosyası boyut sınırını aşıyor; JSON biçimini kullanın." }, { status: 413 });
      throw error;
    }
  }

  return Response.json(createRunExport(run), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="deliberationai-report-${id}.json"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
