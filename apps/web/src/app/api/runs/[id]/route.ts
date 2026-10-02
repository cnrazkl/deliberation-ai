import { findDurableRunById } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const run = await findDurableRunById(id);
  if (!run) {
    return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });
  }
  return Response.json(run);
}
