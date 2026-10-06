import journal from "../drizzle/meta/_journal.json";
import { getPool } from "./database";

export class DatabaseMigrationCompatibilityError extends Error {
  constructor() {
    super("Veritabanı migration geçmişi bu worker sürümü için doğrulanamadı. Uygulama sürümünü ve yedekli migration durumunu kontrol edin.");
    this.name = "DatabaseMigrationCompatibilityError";
  }
}

// Logical journal identity only: SQL hashes/DDL and historical binaries are not certified.
export function assertMigrationTimeline(applied: readonly number[], expected: readonly number[]): void {
  if (!expected.length || applied.length !== expected.length
    || expected.some((value, index) => !Number.isSafeInteger(value) || value <= 0 || (index > 0 && value <= expected[index - 1]!))
    || applied.some((value, index) => !Number.isSafeInteger(value) || value !== expected[index])) {
    throw new DatabaseMigrationCompatibilityError();
  }
}

export async function assertDatabaseMigrationCompatibility(): Promise<void> {
  const expected = journal.entries.map((entry) => entry.when);
  try {
    const query = {
      text: "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at LIMIT $1",
      values: [expected.length + 1], query_timeout: 5_000,
    };
    const result = await getPool().query<{ created_at: string | null }>(query);
    assertMigrationTimeline(result.rows.map((row) => Number(row.created_at)), expected);
  } catch {
    // No SQL, connection strings or database error messages escape this boundary.
    throw new DatabaseMigrationCompatibilityError();
  }
}
