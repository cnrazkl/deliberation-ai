import type { APIRequestContext } from "@playwright/test";
/** Explicitly confirm deletion of generated test connections after reviewing owner-local dependencies. */
export async function deleteGeneratedConnection(request: APIRequestContext, url: string) {
  const response = await request.delete(url);
  if (response.status() !== 409) return response;
  const body = await response.json();
  if (body.code !== "connection_impact_required" || !body.impact?.eligible) return response;
  return request.delete(`${url}&impactFingerprint=${body.impact.fingerprint}`);
}
