export function rejectCrossOriginMutation(request: Request): Response | undefined {
  const origin = request.headers.get("origin");
  if (!origin) return undefined;
  const expected = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000").origin;
  if (origin !== expected) {
    return Response.json({ error: "İstek kaynağı yerel uygulamayla eşleşmiyor." }, { status: 403 });
  }
  return undefined;
}

// Covers legacy JSON readers before JSON.parse or schema validation can allocate
// an unbounded body. Individual routes retain their smaller, operation-specific
// limits. The largest supported run/file packages fit below this transport cap.
export const MAX_APPLICATION_REQUEST_BYTES = 20 * 1_048_576;

export async function withBoundedApplicationBody(request: Request, work: (bounded: Request) => Promise<Response>): Promise<Response> {
  if (!request.body) return work(request);
  const tooLarge = () => Response.json({ error: "İstek gövdesi çok büyük." }, { status: 413, headers: { "Cache-Control": "no-store" } });
  const length = request.headers.get("content-length");
  if (length && /^\d+$/u.test(length) && Number(length) > MAX_APPLICATION_REQUEST_BYTES) {
    await request.body.cancel().catch(() => undefined);
    return tooLarge();
  }
  const reader = request.body.getReader();
  let bytes = 0, exceeded = false, finished = false;
  const cancel = async (reason?: unknown) => {
    if (finished) return;
    finished = true;
    try { await reader.cancel(reason); } catch { /* Cancellation must not expose transport errors. */ }
    finally { reader.releaseLock(); }
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { finished = true; reader.releaseLock(); controller.close(); return; }
        bytes += next.value.byteLength;
        if (bytes > MAX_APPLICATION_REQUEST_BYTES) {
          exceeded = true;
          await cancel();
          controller.error(new Error("Application request body limit exceeded"));
          return;
        }
        controller.enqueue(next.value);
      } catch (error) { await cancel(); controller.error(error); }
    },
    cancel,
  }, { highWaterMark: 0 });
  const bounded = new Request(request, { body, duplex: "half" } as RequestInit & { duplex: "half" });
  try {
    const response = await work(bounded);
    return exceeded ? tooLarge() : response;
  } catch (error) {
    if (exceeded) return tooLarge();
    throw error;
  } finally { await cancel(); }
}
