import { createServer, type IncomingMessage, type RequestOptions } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ port: 0, proxiedRequests: 0 }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "1.1.1.1", family: 4 }]) }));
vi.mock("node:http", async (importActual) => {
  const actual = await importActual<typeof import("node:http")>();
  return { ...actual, request: (options: RequestOptions, listener: (response: IncomingMessage) => void) => {
    // Only the validated retriever is mapped to our local public-site fixture.
    // Chromium's own requests bypass this mock and would reach the private trap.
    if (options.hostname !== "public.fixture.test") throw new Error("Unexpected retriever target");
    fixture.proxiedRequests += 1;
    return actual.request({ ...options, hostname: "127.0.0.1", port: fixture.port,
      lookup: (_hostname, _options, callback) => callback(null, "127.0.0.1", 4) }, listener);
  } };
});

import { retrieveRenderedPublicDocument } from "./index";

// Requires the installed Playwright Chromium binary; remains opt-in in ordinary CI.
test.skipIf(process.env.RUN_RETRIEVAL_BROWSER_SECURITY !== "true")(
  "real Chromium cannot reach private HTTP or WebSocket traps through a popup", async () => {
    let privateHttpRequests = 0;
    let privateWebSockets = 0;
    const trap = createServer((_request, response) => { privateHttpRequests += 1; response.end("Private"); });
    trap.on("upgrade", (_request, socket) => { privateWebSockets += 1; socket.destroy(); });
    trap.listen(0, "127.0.0.1");
    await once(trap, "listening");
    const trapPort = (trap.address() as AddressInfo).port;
    const source = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<html><head><title>Controlled hostile source</title></head><body>Public fixture text<script>
        window.open("http://127.0.0.1:${trapPort}/popup");
        new WebSocket("ws://127.0.0.1:${trapPort}/socket");
        const image = new Image(); image.src = "http://127.0.0.1:${trapPort}/image";
        document.body.append(image);
      </script></body></html>`);
    });
    source.listen(0, "127.0.0.1");
    await once(source, "listening");
    fixture.port = (source.address() as AddressInfo).port;
    fixture.proxiedRequests = 0;
    try {
      await expect(retrieveRenderedPublicDocument("http://public.fixture.test/")).resolves.toMatchObject({
        title: "Controlled hostile source", content: "Public fixture text",
      });
      expect(fixture.proxiedRequests).toBe(1);
      expect(privateHttpRequests).toBe(0);
      expect(privateWebSockets).toBe(0);
    } finally {
      source.closeAllConnections(); trap.closeAllConnections();
      await Promise.all([new Promise<void>((resolve) => source.close(() => resolve())),
        new Promise<void>((resolve) => trap.close(() => resolve()))]);
    }
  }, 15_000,
);
