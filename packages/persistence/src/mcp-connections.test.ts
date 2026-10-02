import { expect, test } from "vitest";
import { rankToolContexts, type StoredMcpToolResult } from "./mcp-connections";

function result(id: string, content: string, createdAt: string): StoredMcpToolResult {
  return {
    id,
    connectionId: "11111111-1111-4111-8111-111111111111",
    connectionLabel: "Yerel bilgi",
    toolName: "search",
    content,
    sha256: "a".repeat(64),
    isError: false,
    createdAt,
  };
}

test("ranks owner-authorized local tool results deterministically by question overlap", () => {
  const ranked = rankToolContexts("PostgreSQL kuyruk dayanıklılığı nasıl sağlanır?", [
    result("11111111-1111-4111-8111-111111111111", "Görsel tasarım ve renk sistemi", "2026-09-20T00:00:00.000Z"),
    result("22222222-2222-4222-8222-222222222222", "PostgreSQL üzerinde dayanıklı pg-boss kuyruk işlemi", "2026-09-19T00:00:00.000Z"),
  ]);
  expect(ranked.map((item) => item.id)).toEqual(["22222222-2222-4222-8222-222222222222"]);
});
