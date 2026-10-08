import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { expect, test, vi } from "vitest";
import { getOwnerId } from "../../../../packages/persistence/src/owner";
const { readSession } = vi.hoisted(() => ({ readSession: vi.fn() }));
vi.mock("@deliberation-ai/persistence", async () => {
  const owner = await import("../../../../packages/persistence/src/owner");
  return { ...owner, LOCAL_SESSION_COOKIE: "deliberation-session", LOCAL_SESSION_SECONDS: 28800,
    readLocalSession: readSession, withLiveOwner: owner.withOwner, LocalAuthError: class extends Error { constructor(message: string, readonly status = 400) { super(message); } } };
});
import { authJson, localSessionToken, withLocalSession } from "./local-auth";

test("all application routes have the central session guard; public account routes have the account guard", () => {
  const root = resolve("apps/web/src/app/api");
  const files = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : entry.name === "route.ts" ? [join(path, entry.name)] : []);
  const publicRoutes = new Set(["login", "register", "session", "logout", "password", "scope", "users", "users/[id]", "users/[id]/connections", "users/[id]/deletion", "account/deletion"]);
  for (const path of files(root)) {
    const source = readFileSync(path, "utf8");
    const auth = path.replaceAll("\\", "/").split("/api/auth/")[1]?.replace("/route.ts", "");
    if (auth) { expect(publicRoutes.has(auth), path).toBe(true); expect(source, path).toContain("authAction("); continue; }
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    let methods = 0;
    for (const statement of ast.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
        expect(statement.name?.text, path).not.toMatch(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/u);
      if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const variable of statement.declarationList.declarations) {
        if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/u.test(variable.name.getText(ast))) continue;
        methods++;
        expect(variable.initializer && ts.isCallExpression(variable.initializer) && variable.initializer.expression.getText(ast) === "withLocalSession", path).toBe(true);
      }
    }
    expect(methods, path).toBeGreaterThan(0);
  }
});
test("anonymous, stale scopes and cross-site requests never reach an application handler", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  const handler = vi.fn(async (request: Request) => Response.json({ owner: getOwnerId(), method: request.method }));
  const guarded = withLocalSession(handler);
  readSession.mockResolvedValue(null);
  expect((await guarded(new Request("http://127.0.0.1:3000/api/runs"))).status).toBe(401);
  readSession.mockResolvedValue({ user: { id: "alice", role: "user" }, scope: { id: "alice", ownerId: "user:alice" } });
  for (const headers of [{ "X-Deliberation-Owner": "user:bob" }, {}, { "Origin": "http://evil.test", "X-Deliberation-Owner": "user:alice" }])
    expect((await guarded(new Request("http://127.0.0.1:3000/api/runs", { method: "POST", headers }))).ok).toBe(false);
  expect(handler).not.toHaveBeenCalled();
  const response = await guarded(new Request("http://127.0.0.1:3000/api/runs", { method: "POST", headers: { "X-Deliberation-Owner": "user:alice" } }));
  expect(await response.json()).toEqual({ owner: "user:alice", method: "POST" }); expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await guarded(new Request("http://127.0.0.1:3000/api/runs/id/stream?owner=user:bob"))).status).toBe(409);
  vi.unstubAllEnvs();
});

test("root cannot read or generate conversations, even with a selected ordinary user scope", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  readSession.mockResolvedValue({ user: { id: "root", role: "root" }, scope: { id: "alice", ownerId: "user:alice" } });
  const handler = vi.fn((request: Request) => Response.json({ method: request.method }));
  for (const path of ["runs", "conversations", "knowledge", "private-branches", "local-schedules", "provider-connections/id/generation-check"])
    expect((await withLocalSession(handler)(new Request(`http://127.0.0.1:3000/api/${path}`))).status).toBe(403);
  expect(handler).not.toHaveBeenCalled();
  expect((await withLocalSession(handler)(new Request("http://127.0.0.1:3000/api/provider-connections"))).status).toBe(200);
  vi.unstubAllEnvs();
});
test("duplicate cookies and oversized authentication streams are rejected", async () => {
  expect(localSessionToken(new Request("http://localhost", { headers: { cookie: "deliberation-session=a; deliberation-session=b" } }))).toBeUndefined();
  await expect(authJson(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "x".repeat(3000) }) }))).rejects.toThrow("çok büyük");
});
