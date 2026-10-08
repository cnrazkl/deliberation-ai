import { withLocalSession } from "../../../../../lib/local-auth";
import { listDurableRunEvents } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const rawAfter = new URL(request.url).searchParams.get("after") ?? "0";
  const after = Number(rawAfter);
  if (!Number.isSafeInteger(after) || after < 0) {
    return Response.json({ error: "after sıfır veya pozitif bir tam sayı olmalıdır." }, { status: 400 });
  }
  const replay = await listDurableRunEvents(id, after);
  if (!replay) return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  return Response.json(replay, { headers: { "cache-control": "no-store" } });
}

export const GET = withLocalSession(sessionGET);
