import { Pool } from "pg";
import { withOwner, LOCAL_OWNER_ID } from "./owner";
import { LocalAuthError } from "./local-auth";

declare global { var deliberationOwnerLeasePool: Pool | undefined; }
// A separate pool avoids starving application queries while entry points hold leases.
function leases() {
  return globalThis.deliberationOwnerLeasePool ??= new Pool({ connectionString: process.env.DATABASE_URL,
    application_name: "deliberation-ai-owner-lease", max: 20, connectionTimeoutMillis: 5000 });
}
export const ownerLeaseKey = (owner: string) => `local-account-lifecycle-v1:${owner}`;
export async function withLiveOwner<T>(owner: string, work: () => Promise<T>): Promise<T> {
  const client = await leases().connect();
  let locked = false;
  try {
    await client.query("SET lock_timeout='5s'");
    await client.query("SELECT pg_advisory_lock_shared(hashtextextended($1,0))", [ownerLeaseKey(owner)]); locked = true;
    // Historical CLI/test owners remain supported; web-issued user owners must exist.
    if (owner !== LOCAL_OWNER_ID && owner.startsWith("user:") &&
        !(await client.query("SELECT 1 FROM local_users WHERE owner_id=$1", [owner])).rowCount)
      throw new LocalAuthError("Hesap silinmiş. Yeniden giriş yapın.", 401);
    return await withOwner(owner, work);
  } finally {
    try { if (locked) await client.query("SELECT pg_advisory_unlock_shared(hashtextextended($1,0))", [ownerLeaseKey(owner)]); }
    finally { client.release(true); }
  }
}
export async function closeOwnerLeases() {
  if (globalThis.deliberationOwnerLeasePool) await globalThis.deliberationOwnerLeasePool.end();
  globalThis.deliberationOwnerLeasePool = undefined;
}
