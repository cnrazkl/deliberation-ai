import { findDurableRunById } from "@deliberation-ai/persistence";
import { createRunExport } from "../../../../../lib/run-export";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  }
  const run = await findDurableRunById(id);
  if (!run) return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  if (!run.report) {
    return Response.json({ error: "Bu çalışma için indirilebilir rapor henüz hazır değil." }, { status: 409 });
  }

  return Response.json(createRunExport(run), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="deliberationai-report-${id}.json"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
