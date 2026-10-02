import { describe, expect, test, vi } from "vitest";
import { callLocalMcpTool, listLocalMcpTools, parseLocalMcpUrl } from "./index";

describe("local MCP boundary", () => {
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
