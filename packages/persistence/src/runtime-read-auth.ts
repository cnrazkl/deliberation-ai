import { createHmac, timingSafeEqual } from "node:crypto";

export function createRuntimeReadToken(encodedKey: string, at = Date.now()): string {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("Runtime read key invalid.");
  return `${at}.${createHmac("sha256", key).update(`local-diagnostics-read-v1:${at}`).digest("hex")}`;
}
export function verifyRuntimeReadToken(encodedKey: string | undefined, token: string | null, now = Date.now()): boolean {
  if (!encodedKey || !token || !/^\d{13}\.[a-f0-9]{64}$/u.test(token)) return false;
  const at = Number(token.split(".")[0]);
  if (at > now + 1_000 || now - at > 15_000) return false;
  try { return timingSafeEqual(Buffer.from(token), Buffer.from(createRuntimeReadToken(encodedKey, at))); }
  catch { return false; }
}
