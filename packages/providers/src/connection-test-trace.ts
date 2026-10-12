import { createHash } from "node:crypto";

const secretField = /^(?:authorization|proxy-authorization|x-api-key|x-goog-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|set-cookie|encrypted_content|thoughtSignature)$/iu;
export function redactConnectionTestText(text: string, apiKey: string): string {
  return (apiKey ? text.replaceAll(apiKey, "[REDACTED]") : text)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'<>}]+/giu, "$1[REDACTED]");
}
export function connectionTraceUrl(input: string): string {
  const url = new URL(input); url.username = ""; url.password = "";
  for (const key of url.searchParams.keys()) if (secretField.test(key) || /token|key|secret|credential/iu.test(key)) url.searchParams.set(key, "[REDACTED]");
  return url.toString().slice(0, 2048);
}
export function connectionTraceHeaders(headers: Headers | Record<string, string>, apiKey: string): Record<string, string> {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  return Object.fromEntries(entries.slice(0, 64).map(([key, value]) => [key.slice(0, 120), secretField.test(key) ? "[REDACTED]" : redactConnectionTestText(value, apiKey).slice(0, 4096)]));
}
function safeValue(value: unknown, apiKey: string, omitBinary: boolean, depth = 0, key = ""): unknown {
  if (secretField.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (omitBinary && (key === "data" || key === "file_data" || key === "url" && value.startsWith("data:"))) {
      const data = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
      return `[binary omitted: ${Buffer.from(data, "base64").length} bytes; sha256=${createHash("sha256").update(Buffer.from(data, "base64")).digest("hex")}]`;
    }
    return redactConnectionTestText(value, apiKey);
  }
  if (depth >= 16) return "[depth limit]";
  if (Array.isArray(value)) return value.map(item => safeValue(item, apiKey, omitBinary, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, safeValue(item, apiKey, omitBinary, depth + 1, name)]));
  return value;
}
export function connectionTraceBody(text: string, apiKey: string, omitBinary = false): string {
  try { return JSON.stringify(safeValue(JSON.parse(text) as unknown, apiKey, omitBinary)); }
  catch { return redactConnectionTestText(text, apiKey); }
}
