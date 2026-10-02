import { ContinuationUnavailableError, loadRunContinuation, loadRunContinuationCompaction } from "@deliberation-ai/persistence";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Çalışma kimliği geçersiz." }, { status: 400 });
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode !== null && mode !== "compaction") return Response.json({ error: "Geçmiş seçimi geçersiz." }, { status: 400 });
  try {
    return Response.json(mode === "compaction" ? await loadRunContinuationCompaction(id) : await loadRunContinuation(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ContinuationUnavailableError) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "Devam bağlamı okunamadı." }, { status: 500 });
  }
}
