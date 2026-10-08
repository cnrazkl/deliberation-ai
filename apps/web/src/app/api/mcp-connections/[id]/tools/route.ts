import { withLocalSession } from "../../../../../lib/local-auth";
import { discoverMcpTools } from "@deliberation-ai/persistence";
import { LocalMcpError } from "@deliberation-ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const tools = await discoverMcpTools(id);
    if (!tools) return Response.json({ error: "MCP bağlantısı bulunamadı." }, { status: 404 });
    return Response.json({ tools }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof LocalMcpError) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "MCP araçları alınamadı." }, { status: 500 });
  }
}

export const GET = withLocalSession(sessionGET);
