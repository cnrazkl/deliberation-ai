import { withLocalSession } from "../../../../../lib/local-auth";
import { getRunProviderUsage } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  }
  const usage = await getRunProviderUsage(id);
  if (!usage) return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  return Response.json(usage, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withLocalSession(sessionGET);
