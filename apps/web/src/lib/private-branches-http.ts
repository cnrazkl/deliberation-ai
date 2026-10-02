import { z } from "zod";
import { ConversationIntegrityError, ConversationPendingError, ConversationSizeError, PrivateBranchConflictError, PrivateBranchSourceError, PrivateDeliveryBlockedError } from "@deliberation-ai/persistence";
import { rejectCrossOriginMutation } from "./request-security";
export const privateBranchUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const privateBranchJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function privateBranchOrigin(request: Request) {
  const response = rejectCrossOriginMutation(request);
  response?.headers.set("Cache-Control", "no-store"); return response;
}
export async function privateBranchRequest<T>(request: Request, schema: z.ZodType<T>): Promise<{ data: T } | { response: Response }> {
  const reader = request.body?.getReader();
  if (!reader) return { response: privateBranchJson({ error: "İstek geçersiz." }, 422) };
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65_536) { await reader.cancel(); return { response: privateBranchJson({ error: "İstek çok büyük." }, 413) }; }
      chunks.push(chunk.value);
    }
    const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return parsed.success ? { data: parsed.data } : { response: privateBranchJson({ error: "İstek geçersiz." }, 422) };
  } catch { return { response: privateBranchJson({ error: "İstek okunamadı." }, 422) }; }
  finally { reader.releaseLock(); }
}
export function privateBranchError(error: unknown) {
  if (error instanceof PrivateDeliveryBlockedError) return privateBranchJson({ error: "Bu gönderim destek, risk veya kapasite sınırları nedeniyle engellendi. Önizlemeyi yenileyin." }, 422);
  if (error instanceof PrivateBranchConflictError) return privateBranchJson({ error: "Kaynak veya dal değişti. Güncel kaydı inceleyip tekrar deneyin." }, 409);
  if (error instanceof PrivateBranchSourceError) return privateBranchJson({ error: "Tamamlanmış ve okunabilir bir ilk yanıt gerekli." }, 409);
  if (error instanceof ConversationPendingError) return privateBranchJson({ error: "Konuşma indeksinin tamamlanması gerekiyor." }, 503);
  if (error instanceof ConversationSizeError) return privateBranchJson({ error: "Dal veya konuşma bu işlem için çok büyük." }, 413);
  if (error instanceof ConversationIntegrityError) return privateBranchJson({ error: "Kayıt tutarlılığı doğrulanamadı." }, 409);
  return privateBranchJson({ error: "Özel dal işlemi tamamlanamadı." }, 500);
}
