import { listDurableRunEvents } from "@deliberation-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const terminalStatuses = new Set(["completed", "partially_completed", "failed", "cancelled"]);
const encoder = new TextEncoder();

function parseCursor(request: Request): number | undefined {
  const urlCursor = new URL(request.url).searchParams.get("after") ?? "0";
  const eventCursor = request.headers.get("last-event-id");
  const after = Number(eventCursor ?? urlCursor);
  return Number.isSafeInteger(after) && after >= 0 ? after : undefined;
}

function wait(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, durationMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const initialCursor = parseCursor(request);
  if (initialCursor === undefined) {
    return Response.json({ error: "after sıfır veya pozitif bir tam sayı olmalıdır." }, { status: 400 });
  }

  const initial = await listDurableRunEvents(id, initialCursor);
  if (!initial) return Response.json({ error: "Çalışma bulunamadı." }, { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let after = initialCursor;
        let replay = initial;
        let lastWriteAt = 0;

        for (let attempt = 0; attempt < 240 && !request.signal.aborted; attempt += 1) {
          const lastEvent = replay.events.at(-1);
          if (lastEvent) after = lastEvent.sequence;
          const terminal = terminalStatuses.has(replay.run.status);

          if (attempt === 0 || replay.events.length > 0 || terminal) {
            controller.enqueue(encoder.encode(
              `id: ${after}\nevent: run\ndata: ${JSON.stringify(replay)}\n\n`,
            ));
            lastWriteAt = Date.now();
          } else if (Date.now() - lastWriteAt >= 15_000) {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
            lastWriteAt = Date.now();
          }

          if (terminal) break;
          await wait(250, request.signal);
          if (request.signal.aborted) break;
          replay = (await listDurableRunEvents(id, after)) ?? replay;
        }

        if (!request.signal.aborted) controller.close();
      })().catch(() => {
        if (!request.signal.aborted) controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
