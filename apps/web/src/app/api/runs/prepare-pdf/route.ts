import { withLocalSession } from "../../../../lib/local-auth";
import { MAX_PDF_ATTACHMENT_BYTES } from "@deliberation-ai/contracts";
import { AttachmentValidationError, extractUploadedPdf } from "@deliberation-ai/persistence";
import { z } from "zod";
import { rejectCrossOriginMutation } from "../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  mimeType: z.literal("application/pdf"),
  dataBase64: z.string().min(1).max(Math.ceil(MAX_PDF_ATTACHMENT_BYTES * 4 / 3) + 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

async function sessionPOST(request: Request): Promise<Response> {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Geçerli PDF gövdesi gerekli." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "PDF adı, boyutu veya dosya özeti geçersiz." }, { status: 422 });
  }
  try {
    const extractedText = await extractUploadedPdf(parsed.data);
    return Response.json({ extractedText }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AttachmentValidationError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    return Response.json({ error: "PDF hazırlanamadı." }, { status: 500 });
  }
}

export const POST = withLocalSession(sessionPOST);
