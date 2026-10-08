import { LOCAL_SESSION_COOKIE, LOCAL_SESSION_SECONDS, readLocalSession, withOwner, LOCAL_OWNER_ID,
  LocalAuthError } from "@deliberation-ai/persistence";
import { verifyRuntimeReadToken } from "../../../../packages/persistence/src/runtime-read-auth";

export function localSessionToken(request: Request): string | undefined {
  const cookies = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${LOCAL_SESSION_COOKIE}=`));
  return cookies.length === 1 ? cookies[0]!.slice(LOCAL_SESSION_COOKIE.length + 1) : undefined;
}
export function rejectAuthOrigin(request: Request): Response | null {
  const url = new URL(request.url);
  const configured = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000");
  const expected = configured.origin;
  const origin = request.headers.get("origin");
  // Next reconstructs development URLs with localhost internally. Validate the
  // incoming Host against the configured authority rather than that rewrite.
  if ((request.headers.get("host") ?? url.host) !== configured.host)
    return Response.json({ error: "Uygulama adresi doğrulanamadı." }, { status: 403 });
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected))
    return Response.json({ error: "İstek kaynağı uygulamayla eşleşmiyor." }, { status: 403 });
  return null;
}
export function sessionCookie(request: Request, token: string, clear = false): string {
  return `${LOCAL_SESSION_COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : LOCAL_SESSION_SECONDS}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export function authResponse(request: Request, body: unknown, status = 200, token?: string, clear = false): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...(token !== undefined || clear ? { "Set-Cookie": sessionCookie(request, token ?? "", clear) } : {}) } });
}
export async function authJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new LocalAuthError("JSON isteği gerekiyor.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new LocalAuthError("İstek geçersiz.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); throw new LocalAuthError("İstek çok büyük.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(text) as unknown; } catch { throw new LocalAuthError("İstek geçersiz."); }
}
export async function authAction(request: Request, work: () => Promise<Response>): Promise<Response> {
  const rejected = rejectAuthOrigin(request); if (rejected) return rejected;
  try { return await work(); }
  catch (error) {
    return authResponse(request, { error: error instanceof LocalAuthError ? error.message : "Hesap işlemi tamamlanamadı." }, error instanceof LocalAuthError ? error.status : 503);
  }
}
export function withLocalSession<Args extends unknown[]>(handler: (...args: Args) => Response | Promise<Response>): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    const request = args[0] as Request;
    if (!(request instanceof Request)) return Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
    const rejected = rejectAuthOrigin(request); if (rejected) return rejected;
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/local-diagnostics" &&
        verifyRuntimeReadToken(process.env.DATA_ENCRYPTION_KEY, request.headers.get("x-deliberation-runtime-read"))) {
      return withOwner(LOCAL_OWNER_ID, () => handler(...args));
    }
    let session;
    try { session = await readLocalSession(localSessionToken(request)); }
    catch { return authResponse(request, { error: "Oturum doğrulanamadı." }, 503); }
    if (!session) return Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const expected = request.headers.get("x-deliberation-owner") ?? (path.endsWith("/stream") ? new URL(request.url).searchParams.get("owner") : null);
    if ((expected && expected !== session.scope.ownerId) || (!expected && !["GET", "HEAD", "OPTIONS"].includes(request.method)))
      return Response.json({ error: "Hesap alanı değişti. Sayfayı yenileyin." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const response = await withOwner(session.scope.ownerId, () => handler(...args));
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}
