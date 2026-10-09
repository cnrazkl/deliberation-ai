import { previewProviderModelsSchema, type PreviewProviderModelsRequest } from "@deliberation-ai/contracts";

export class CatalogPreviewRequestError extends Error {
  constructor(readonly status: 400 | 413 | 415) { super("Model listesi isteği geçersiz."); }
}

export async function readCatalogPreviewRequest(request: Request): Promise<PreviewProviderModelsRequest> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") throw new CatalogPreviewRequestError(415);
  const reader = request.body?.getReader();
  if (!reader) throw new CatalogPreviewRequestError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8_192) { await reader.cancel(); throw new CatalogPreviewRequestError(413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const parsed = previewProviderModelsSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
    if (!parsed.success) throw new CatalogPreviewRequestError(400);
    return parsed.data;
  } catch { throw new CatalogPreviewRequestError(400); }
}
