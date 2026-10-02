import { listAwaitingPreflightDrafts } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ drafts: await listAwaitingPreflightDrafts() }, { headers: { "Cache-Control": "no-store" } });
}
