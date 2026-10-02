import { saveMcpConnectionSchema } from "@deliberation-ai/contracts";
import { deleteMcpConnection, listMcpConnections, saveMcpConnection } from "@deliberation-ai/persistence";
import { LocalMcpError } from "@deliberation-ai/tools";
import { rejectCrossOriginMutation } from "../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ connections: await listMcpConnections() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = saveMcpConnectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "MCP bağlantı bilgileri geçersiz." }, { status: 422 });
  try {
    return Response.json(await saveMcpConnection(parsed.data), { status: parsed.data.id ? 200 : 201 });
  } catch (error) {
    if (error instanceof LocalMcpError) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "MCP bağlantısı kaydedilemedi." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Bağlantı kimliği gerekli." }, { status: 422 });
  return Response.json({ deleted: await deleteMcpConnection(id) });
}
