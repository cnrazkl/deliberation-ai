import { resolveProviderOperationSchema } from "@deliberation-ai/contracts";
import {
  ProviderOperationResolutionError,
  resolveProviderOperation,
} from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Geçerli bir JSON gövdesi gerekli." }, { status: 400 });
  }
  const parsed = resolveProviderOperationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Operatör eylemi geçersiz." }, { status: 422 });
  }
  const { id } = await context.params;
  try {
    const result = await resolveProviderOperation(id, parsed.data.action);
    if (!result) {
      return Response.json({ error: "Sağlayıcı operasyonu bulunamadı." }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof ProviderOperationResolutionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: "Operatör eylemi tamamlanamadı." }, { status: 500 });
  }
}
