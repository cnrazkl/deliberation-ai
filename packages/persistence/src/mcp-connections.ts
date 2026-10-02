import { createHash, randomUUID } from "node:crypto";
import type {
  FrozenToolContext,
  InvokeMcpToolRequest,
  SaveMcpConnectionRequest,
} from "@deliberation-ai/contracts";
import { callLocalMcpTool, listLocalMcpTools, parseLocalMcpUrl, type McpToolSummary } from "@deliberation-ai/tools";
import { and, asc, eq } from "drizzle-orm";
import { decryptText, encryptJson, encryptText } from "./crypto";
import { getDatabase } from "./database";
import { LOCAL_OWNER_ID } from "./owner";
import { mcpConnections, mcpToolResults } from "./schema";

export type McpConnection = {
  id: string;
  label: string;
  endpoint: string;
  createdAt: string;
};

export type StoredMcpToolResult = FrozenToolContext & {
  connectionId: string;
  isError: boolean;
  createdAt: string;
};

function mapConnection(row: typeof mcpConnections.$inferSelect): McpConnection {
  return {
    id: row.id,
    label: decryptText(row.labelCiphertext, `mcp-connection:${row.id}:label`),
    endpoint: decryptText(row.endpointCiphertext, `mcp-connection:${row.id}:endpoint`),
    createdAt: row.createdAt.toISOString(),
  };
}

async function findConnection(id: string): Promise<McpConnection | undefined> {
  const [row] = await getDatabase().select().from(mcpConnections)
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.ownerId, LOCAL_OWNER_ID))).limit(1);
  return row ? mapConnection(row) : undefined;
}

export async function listMcpConnections(): Promise<McpConnection[]> {
  const rows = await getDatabase().select().from(mcpConnections)
    .where(eq(mcpConnections.ownerId, LOCAL_OWNER_ID)).orderBy(asc(mcpConnections.createdAt));
  return rows.map(mapConnection);
}

export async function saveMcpConnection(request: SaveMcpConnectionRequest): Promise<McpConnection> {
  const endpoint = parseLocalMcpUrl(request.endpoint).toString();
  const db = getDatabase();
  const id = request.id ?? randomUUID();
  const encrypted = {
    labelCiphertext: encryptText(request.label, `mcp-connection:${id}:label`),
    endpointCiphertext: encryptText(endpoint, `mcp-connection:${id}:endpoint`),
    updatedAt: new Date(),
  };
  const [row] = request.id
    ? await db.update(mcpConnections).set(encrypted)
        .where(and(eq(mcpConnections.id, id), eq(mcpConnections.ownerId, LOCAL_OWNER_ID))).returning()
    : await db.insert(mcpConnections).values({ id, ownerId: LOCAL_OWNER_ID, ...encrypted }).returning();
  if (!row) throw new Error("MCP connection could not be saved.");
  return mapConnection(row);
}

export async function deleteMcpConnection(id: string): Promise<boolean> {
  const deleted = await getDatabase().delete(mcpConnections)
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.ownerId, LOCAL_OWNER_ID)))
    .returning({ id: mcpConnections.id });
  return deleted.length > 0;
}

export async function discoverMcpTools(connectionId: string): Promise<McpToolSummary[] | undefined> {
  const connection = await findConnection(connectionId);
  return connection ? listLocalMcpTools(connection.endpoint) : undefined;
}

export async function invokeMcpTool(request: InvokeMcpToolRequest): Promise<StoredMcpToolResult | undefined> {
  const connection = await findConnection(request.connectionId);
  if (!connection) return undefined;
  const result = await callLocalMcpTool(connection.endpoint, request.toolName, request.arguments);
  const id = randomUUID();
  const sha256 = createHash("sha256").update(result.text).digest("hex");
  const [row] = await getDatabase().insert(mcpToolResults).values({
    id,
    ownerId: LOCAL_OWNER_ID,
    connectionId: connection.id,
    toolName: request.toolName,
    argumentsCiphertext: encryptJson(request.arguments, `mcp-tool-result:${id}:arguments`),
    contentCiphertext: encryptText(result.text, `mcp-tool-result:${id}:content`),
    contentSha256: sha256,
    isError: result.isError,
  }).returning();
  if (!row) throw new Error("MCP tool result could not be saved.");
  return {
    id: row.id,
    connectionId: row.connectionId,
    connectionLabel: connection.label,
    toolName: row.toolName,
    content: result.text,
    sha256,
    isError: row.isError,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMcpToolResults(): Promise<StoredMcpToolResult[]> {
  const db = getDatabase();
  const rows = await db.select({ result: mcpToolResults, connection: mcpConnections })
    .from(mcpToolResults)
    .innerJoin(mcpConnections, eq(mcpToolResults.connectionId, mcpConnections.id))
    .where(eq(mcpToolResults.ownerId, LOCAL_OWNER_ID))
    .orderBy(asc(mcpToolResults.createdAt));
  return rows.map(({ result, connection }) => ({
    id: result.id,
    connectionId: result.connectionId,
    connectionLabel: decryptText(connection.labelCiphertext, `mcp-connection:${connection.id}:label`),
    toolName: result.toolName,
    content: decryptText(result.contentCiphertext, `mcp-tool-result:${result.id}:content`),
    sha256: result.contentSha256,
    isError: result.isError,
    createdAt: result.createdAt.toISOString(),
  }));
}

export async function deleteMcpToolResult(id: string): Promise<boolean> {
  const deleted = await getDatabase().delete(mcpToolResults)
    .where(and(eq(mcpToolResults.id, id), eq(mcpToolResults.ownerId, LOCAL_OWNER_ID)))
    .returning({ id: mcpToolResults.id });
  return deleted.length > 0;
}

export async function loadFrozenToolContexts(ids: string[]): Promise<FrozenToolContext[]> {
  if (ids.length === 0) return [];
  const results = await listMcpToolResults();
  const byId = new Map(results.filter((item) => ids.includes(item.id) && !item.isError).map((item) => [item.id, item]));
  if (byId.size !== ids.length) throw new Error("Seçilen yerel araç sonuçlarından biri bulunamadı veya hatalı.");
  return ids.map((id) => {
    const item = byId.get(id)!;
    return {
      id: item.id,
      connectionLabel: item.connectionLabel,
      toolName: item.toolName,
      content: item.content,
      sha256: item.sha256,
    };
  });
}

function terms(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("tr-TR").match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

export function rankToolContexts(question: string, results: StoredMcpToolResult[], limit = 3): FrozenToolContext[] {
  const query = terms(question);
  if (query.size === 0) return [];
  return results
    .filter((item) => !item.isError)
    .map((item) => {
      const heading = terms(`${item.connectionLabel} ${item.toolName}`);
      const content = terms(item.content);
      let score = 0;
      for (const term of query) {
        if (heading.has(term)) score += 3;
        if (content.has(term)) score += 1;
      }
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.item.createdAt.localeCompare(left.item.createdAt))
    .slice(0, limit)
    .map(({ item }) => ({
      id: item.id,
      connectionLabel: item.connectionLabel,
      toolName: item.toolName,
      content: item.content,
      sha256: item.sha256,
    }));
}

export async function loadRelevantToolContexts(question: string, limit = 3): Promise<FrozenToolContext[]> {
  return rankToolContexts(question, await listMcpToolResults(), limit);
}
