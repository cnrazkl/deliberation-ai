import { withLocalSession } from "../../../lib/local-auth";
import { saveProviderConnectionSchema } from "@deliberation-ai/contracts";
import {
  deleteProviderConnection,
  listProviderConnections,
  ProviderConnectionSecretRequiredError,
  ProviderConnectionCheckPendingError,
  ProviderConnectionRevisionConflictError,
  saveProviderConnection,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(): Promise<Response> {
  return Response.json({ connections: await listProviderConnections() });
}

async function sessionPOST(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const parsed = saveProviderConnectionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Sağlayıcı bağlantı bilgileri geçersiz." }, { status: 400 });
  }
  try {
    return Response.json(await saveProviderConnection(parsed.data));
  } catch (error) {
    if (error instanceof ProviderConnectionRevisionConflictError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof ProviderConnectionSecretRequiredError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

async function sessionDELETE(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Bağlantı kimliği gerekli." }, { status: 400 });
  try { return Response.json({ deleted: await deleteProviderConnection(id) }); }
  catch (error) {
    if (error instanceof ProviderConnectionCheckPendingError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

export const GET = withLocalSession(sessionGET);
export const POST = withLocalSession(sessionPOST);
export const DELETE = withLocalSession(sessionDELETE);
