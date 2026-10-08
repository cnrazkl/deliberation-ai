import { withLocalSession } from "../../../lib/local-auth";
import { readLocalDiagnostics } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionGET(): Promise<Response> {
  try {
    return Response.json(await readLocalDiagnostics(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Yerel çalışma durumu okunamadı. Veritabanı bağlantısını kontrol edin." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = withLocalSession(sessionGET);
