import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export const MCP_TIMEOUT_MS = 15_000;
export const MAX_TOOL_RESULT_CHARACTERS = 64_000;

export type McpToolSummary = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolResult = {
  text: string;
  isError: boolean;
};

export class LocalMcpError extends Error {
  constructor(readonly code: "invalid_endpoint" | "timeout" | "connection_failed" | "invalid_result", message: string) {
    super(message);
    this.name = "LocalMcpError";
  }
}

export function parseLocalMcpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new LocalMcpError("invalid_endpoint", "Geçerli bir yerel MCP HTTP adresi gerekli.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new LocalMcpError("invalid_endpoint", "MCP bağlantısı yalnızca bu bilgisayardaki HTTP loopback adresine açılabilir.");
  }
  if (url.username || url.password || url.hash) {
    throw new LocalMcpError("invalid_endpoint", "MCP adresi gömülü kimlik bilgisi veya parça içeremez.");
  }
  return url;
}

type ClientSession = { client: Client; close: () => Promise<void> };
type SessionFactory = (url: URL) => Promise<ClientSession>;

async function defaultSessionFactory(url: URL): Promise<ClientSession> {
  const client = new Client({ name: "deliberation-ai", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);
  return { client, close: () => client.close() };
}

async function withinDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new LocalMcpError("timeout", "Yerel MCP işlemi zaman aşımına uğradı.")),
          MCP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function listLocalMcpTools(
  endpoint: string,
  sessionFactory: SessionFactory = defaultSessionFactory,
): Promise<McpToolSummary[]> {
  const url = parseLocalMcpUrl(endpoint);
  let session: ClientSession | undefined;
  try {
    session = await withinDeadline(sessionFactory(url));
    const response = await withinDeadline(session.client.listTools());
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  } catch (error) {
    if (error instanceof LocalMcpError) throw error;
    throw new LocalMcpError("connection_failed", "Yerel MCP sunucusuna bağlanılamadı.");
  } finally {
    await session?.close().catch(() => undefined);
  }
}

export async function callLocalMcpTool(
  endpoint: string,
  name: string,
  args: Record<string, unknown>,
  sessionFactory: SessionFactory = defaultSessionFactory,
): Promise<McpToolResult> {
  const url = parseLocalMcpUrl(endpoint);
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(name)) {
    throw new LocalMcpError("invalid_result", "MCP araç adı geçersiz.");
  }
  let session: ClientSession | undefined;
  try {
    session = await withinDeadline(sessionFactory(url));
    const listed = await withinDeadline(session.client.listTools());
    if (!listed.tools.some((tool) => tool.name === name)) {
      throw new LocalMcpError("invalid_result", "Seçilen araç bu MCP sunucusunun güncel listesinde yok.");
    }
    const result = await withinDeadline(session.client.callTool({ name, arguments: args }));
    const text = result.content
      .flatMap((item) => item.type === "text" ? [item.text] : [])
      .join("\n")
      .trim()
      .slice(0, MAX_TOOL_RESULT_CHARACTERS);
    if (!text) throw new LocalMcpError("invalid_result", "MCP aracı kullanılabilir metin sonucu döndürmedi.");
    return { text, isError: result.isError === true };
  } catch (error) {
    if (error instanceof LocalMcpError) throw error;
    throw new LocalMcpError("connection_failed", "Yerel MCP araç çağrısı tamamlanamadı.");
  } finally {
    await session?.close().catch(() => undefined);
  }
}
