import { z } from "zod";
import { ConversationDeletionBlockedError, ConversationDeletionStaleError,
  deleteEmptyConversation, previewConversationDeletion } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "../../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const confirmation = z.object({ conversationId: z.string().regex(uuid),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmMetadataDeletion: z.literal(true) }).strict();
type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Konuşma bulunamadı." }, 404);
  try {
    const preview = await previewConversationDeletion(id.toLowerCase());
    return preview ? json(preview) : json({ error: "Konuşma bulunamadı." }, 404);
  } catch { return json({ error: "Silme önizlemesi hazırlanamadı." }, 500); }
}

export async function POST(request: Request, context: Context) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) { rejected.headers.set("Cache-Control", "no-store"); return rejected; }
  const { id } = await context.params;
  if (!uuid.test(id)) return json({ error: "Konuşma bulunamadı." }, 404);
  // The confirmation carries no content. Bound the actual streamed bytes, not
  // just a caller-controlled Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Silme onayı geçersiz." }, 422);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4_096) { await reader.cancel(); return json({ error: "Silme onayı çok büyük." }, 413); }
      chunks.push(chunk.value);
    }
  } catch { return json({ error: "Silme onayı okunamadı." }, 422); }
  finally { reader.releaseLock(); }
  const parsed = confirmation.safeParse(await Promise.resolve().then(() => JSON.parse(Buffer.concat(chunks).toString("utf8"))).catch(() => null));
  if (!parsed.success || parsed.data.conversationId.toLowerCase() !== id.toLowerCase()) return json({ error: "Silme onayı geçersiz." }, 422);
  try {
    const result = await deleteEmptyConversation(id.toLowerCase(), parsed.data.fingerprint);
    return result ? json(result) : json({ error: "Konuşma bulunamadı veya zaten silindi." }, 404);
  } catch (error) {
    if (error instanceof ConversationDeletionStaleError) return json({ error: "Konuşma kaydı değişti. Yeni silme önizlemesini inceleyin." }, 409);
    if (error instanceof ConversationDeletionBlockedError) return json({ error: "Bu konuşma şu anda silinemez. Önizlemeyi yenileyin." }, 409);
    return json({ error: "Konuşma kaydı silinemedi." }, 500);
  }
}
