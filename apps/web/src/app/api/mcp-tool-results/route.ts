import { withLocalSession } from "../../../lib/local-auth";
import { invokeMcpToolSchema } from "@deliberation-ai/contracts";
import { deleteMcpToolResult, invokeMcpTool, listMcpToolResults } from "@deliberation-ai/persistence";
import { LocalMcpError } from "@deliberation-ai/tools";
import { rejectCrossOriginMutation } from "../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET() {
  return Response.json({ results: await listMcpToolResults() }, { headers: { "cache-control": "no-store" } });
}

async function sessionPOST(request: Request) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = invokeMcpToolSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "MCP araç çağrısı geçersiz." }, { status: 422 });
  try {
    const result = await invokeMcpTool(parsed.data);
    if (!result) return Response.json({ error: "MCP bağlantısı bulunamadı." }, { status: 404 });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LocalMcpError) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "MCP araç çağrısı tamamlanamadı." }, { status: 500 });
  }
}

async function sessionDELETE(request: Request) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Araç sonucu kimliği gerekli." }, { status: 422 });
  return Response.json({ deleted: await deleteMcpToolResult(id) });
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
export const DELETE = withLocalSession(sessionDELETE);
