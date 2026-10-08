"use client";
export async function accountRequest<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, { cache: "no-store", ...(body !== undefined ? {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Hesap işlemi tamamlanamadı.");
  return result;
}
export function announceSessionChange() { const channel = new BroadcastChannel("deliberation-accounts"); channel.postMessage("changed"); channel.close(); }
