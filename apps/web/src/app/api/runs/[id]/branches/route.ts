import { withLocalSession } from "../../../../../lib/local-auth";
import { loadRunBranches, RunBranchIndexPendingError } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sessionGET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const search = new URL(request.url).searchParams;
  const childrenBefore = search.get("childrenBefore");
  const siblingsBefore = search.get("siblingsBefore");
  if (!uuid.test(id) || [childrenBefore, siblingsBefore].some((value) => value !== null && !uuid.test(value))) {
    return Response.json({ error: "Geçersiz çalışma bağlantısı." }, { status: 400 });
  }
  try {
    const result = await loadRunBranches(id, {
      ...(childrenBefore ? { childrenBefore } : {}), ...(siblingsBefore ? { siblingsBefore } : {}),
    });
    if (!result) return Response.json({ error: "Çalışma veya bağlantı imleci bulunamadı." }, { status: 404 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof RunBranchIndexPendingError
      ? "Geçmiş çalışma bağlantıları hazırlanmayı bekliyor."
      : "Çalışma bağlantıları doğrulanamadı." }, { status: error instanceof RunBranchIndexPendingError ? 503 : 500 });
  }
}

export const GET = withLocalSession(sessionGET);
