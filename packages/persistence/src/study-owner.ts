import { getPool } from "./database";
import { withLiveOwner } from "./owner-lifecycle";

/** Administrative evaluation commands dispatch only within a live ordinary account. */
export async function withStudyOwner<T>(owner: string, work: () => Promise<T>): Promise<T> {
  if (!/^user:[a-f0-9-]{36}$/u.test(owner)) throw new Error("Ordinary study owner required.");
  return withLiveOwner(owner, async () => {
    const account = await getPool().query("SELECT role FROM local_users WHERE owner_id=$1", [owner]);
    if (account.rows.length !== 1 || account.rows[0]?.role !== "user") throw new Error("Live ordinary study account required.");
    return work();
  });
}
