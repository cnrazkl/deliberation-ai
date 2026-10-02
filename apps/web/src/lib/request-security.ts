export function rejectCrossOriginMutation(request: Request): Response | undefined {
  const origin = request.headers.get("origin");
  if (!origin) return undefined;
  const expected = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000").origin;
  if (origin !== expected) {
    return Response.json({ error: "İstek kaynağı yerel uygulamayla eşleşmiyor." }, { status: 403 });
  }
  return undefined;
}
