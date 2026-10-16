import { expect, test, vi } from "vitest";
import { readCatalogPreviewRequest } from "./model-catalog-preview";
import { MAX_APPLICATION_REQUEST_BYTES, withBoundedApplicationBody } from "./request-security";

function streamedRequest(body: ReadableStream<Uint8Array>, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/runs", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

test("rejects an oversized declared body without entering the handler or reading its contents", async () => {
  const pull = vi.fn(), cancel = vi.fn();
  const request = streamedRequest(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
    "content-length": String(MAX_APPLICATION_REQUEST_BYTES + 1),
  });
  const handler = vi.fn(async () => Response.json({ saved: true }));
  const response = await withBoundedApplicationBody(request, handler);
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(handler).not.toHaveBeenCalled(); expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
});

test.each([undefined, "1"])("bounds streamed JSON before parsing or side effects with Content-Length %s", async contentLength => {
  const chunk = new TextEncoder().encode(" ".repeat(1_048_576));
  let reads = 0;
  const cancel = vi.fn(), persist = vi.fn();
  const request = streamedRequest(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(chunk); }, cancel,
  }, { highWaterMark: 0 }), contentLength ? { "content-length": contentLength } : {});
  const response = await withBoundedApplicationBody(request, async bounded => {
    try { const value: unknown = await bounded.json(); persist(value); return Response.json({ saved: true }); }
    catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  });
  expect(response.status).toBe(413);
  expect(persist).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(reads).toBe(21);
});

test("preserves bodies up to the ceiling without buffering them again in the guard", async () => {
  const chunk = new Uint8Array(1_048_576);
  let reads = 0;
  const request = streamedRequest(new ReadableStream({
    pull(controller) { if (++reads <= 20) controller.enqueue(chunk); else controller.close(); },
  }, { highWaterMark: 0 }), { "content-type": "application/json", "x-deliberation-owner": "user:alice" });
  const response = await withBoundedApplicationBody(request, async bounded => {
    expect(bounded.method).toBe("POST"); expect(bounded.url).toBe(request.url);
    expect(bounded.headers.get("x-deliberation-owner")).toBe("user:alice");
    const reader = bounded.body!.getReader(); let bytes = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; expect(next.value).toBe(chunk); bytes += next.value.byteLength; }
    reader.releaseLock();
    return Response.json({ bytes });
  });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ bytes: MAX_APPLICATION_REQUEST_BYTES });
});

test("retains stricter route stream limits and propagates their cancellation", async () => {
  let reads = 0;
  const cancel = vi.fn();
  const request = streamedRequest(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(4_096)); }, cancel,
  }, { highWaterMark: 0 }), { "content-type": "application/json" });
  const response = await withBoundedApplicationBody(request, async bounded => {
    try { await readCatalogPreviewRequest(bounded); return Response.json({ accepted: true }); }
    catch (error) { return Response.json({ error: "Invalid catalog request" }, { status: (error as { status: number }).status }); }
  });
  expect(response.status).toBe(413); expect(reads).toBe(3); expect(cancel).toHaveBeenCalledOnce();
});

test("closes unread bodies and preserves request abort signals and bodyless requests", async () => {
  const cancel = vi.fn();
  const controller = new AbortController();
  const request = new Request("http://localhost/api/runs", { method: "POST", signal: controller.signal,
    body: new ReadableStream({ cancel }, { highWaterMark: 0 }), duplex: "half" } as RequestInit);
  await withBoundedApplicationBody(request, async bounded => {
    controller.abort(); expect(bounded.signal.aborted).toBe(true); return Response.json({ accepted: false });
  });
  expect(cancel).toHaveBeenCalledOnce();
  const get = new Request("http://localhost/api/runs");
  await withBoundedApplicationBody(get, async bounded => { expect(bounded).toBe(get); return Response.json({ ok: true }); });
});
