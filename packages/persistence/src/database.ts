import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var deliberationPool: Pool | undefined;
  var deliberationDb: NodePgDatabase<typeof schema> | undefined;
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

export function getPool(): Pool {
  globalThis.deliberationPool ??= new Pool({
    connectionString: databaseUrl(),
    application_name: "deliberation-ai",
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
  return globalThis.deliberationPool;
}

export function getDatabase(): NodePgDatabase<typeof schema> {
  globalThis.deliberationDb ??= drizzle(getPool(), { schema });
  return globalThis.deliberationDb;
}

export async function closeDatabase(): Promise<void> {
  if (globalThis.deliberationOwnerLeasePool) await globalThis.deliberationOwnerLeasePool.end();
  globalThis.deliberationOwnerLeasePool = undefined;
  if (globalThis.deliberationPool) await globalThis.deliberationPool.end();
  globalThis.deliberationPool = undefined;
  globalThis.deliberationDb = undefined;
}
