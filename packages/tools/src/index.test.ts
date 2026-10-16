import { describe, expect, test, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { callLocalMcpTool, listLocalMcpTools, parseLocalMcpUrl } from "./index";

describe("local MCP boundary", () => {
  test("the real MCP transport never follows a server-selected redirect", async () => {
    let forwardedRequests = 0;
    const destination = createServer((_request, response) => {
      forwardedRequests += 1;
      response.writeHead(400);
      response.end();
    });
    destination.listen(0, "127.0.0.1");
    await once(destination, "listening");
    const source = createServer((_request, response) => {
      response.writeHead(307, { location: `http://127.0.0.1:${(destination.address() as AddressInfo).port}/redirected` });
      response.end();
    });
    source.listen(0, "127.0.0.1");
    await once(source, "listening");
    const endpoint = `http://127.0.0.1:${(source.address() as AddressInfo).port}/mcp`;
    const close = async (server: Server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    };
    try {
      await expect(listLocalMcpTools(endpoint)).rejects.toMatchObject({ code: "connection_failed" });
      expect(forwardedRequests).toBe(0);
    } finally {
      await close(source);
      await close(destination);
    }
  });
  test.each(["https://127.0.0.1:3001/mcp", "http://192.168.1.5/mcp", "http://example.com/mcp"])(
    "rejects non-loopback endpoint %s",
    (endpoint) => expect(() => parseLocalMcpUrl(endpoint)).toThrow(),
  );

  test("lists and calls only a currently advertised tool", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const client = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: "lookup", description: "Local lookup", inputSchema: { type: "object" } }],
      }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "local result" }] }),
    };
    const factory = vi.fn().mockResolvedValue({ client, close });
    await expect(listLocalMcpTools("http://127.0.0.1:3333/mcp", factory as never)).resolves.toEqual([
      { name: "lookup", description: "Local lookup", inputSchema: { type: "object" } },
    ]);
    await expect(callLocalMcpTool("http://127.0.0.1:3333/mcp", "lookup", { q: "test" }, factory as never))
      .resolves.toEqual({ text: "local result", isError: false });
    expect(client.callTool).toHaveBeenCalledWith({ name: "lookup", arguments: { q: "test" } });
    expect(close).toHaveBeenCalledTimes(2);
  });
});
