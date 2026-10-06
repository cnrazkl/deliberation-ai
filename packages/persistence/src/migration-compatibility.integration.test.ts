import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import journal from "../drizzle/meta/_journal.json";
import { getPool } from "./database";
import { assertDatabaseMigrationCompatibility } from "./migration-compatibility";

test("actual worker exits before queue or heartbeat writes with an incompatible ledger", async () => {
  if (!/^\/da_it_[a-f0-9]{16}$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Disposable database required.");
  await expect(assertDatabaseMigrationCompatibility()).resolves.toBeUndefined();
  const pool = getPool();
  const before = await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id");
  const queueSnapshot = async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'pgboss' ORDER BY tablename")).rows;
    const queues = tables.some((row) => row.tablename === "queue") ? (await pool.query("SELECT * FROM pgboss.queue ORDER BY name")).rows : [];
    return { tables, queues };
  };
  const queueBefore = await queueSnapshot();
  const heartbeatBefore = (await pool.query("SELECT count(*)::int AS total FROM public.worker_heartbeats")).rows;
  const last = journal.entries.at(-1)!.when;
  try {
    for (const mode of ["behind", "ahead"] as const) {
      if (mode === "behind") await pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [last]);
      else await pool.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", ["synthetic-future", last + 1]);
      const root = resolve(import.meta.dirname, "../../..");
      const child = spawnSync(process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "pnpm",
        process.platform === "win32" ? ["/d", "/s", "/c", "pnpm exec tsx apps/worker/src/index.ts"] : ["exec", "tsx", "apps/worker/src/index.ts"],
        { cwd: root, env: process.env, windowsHide: true, encoding: "utf8", timeout: 10_000 });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(1);
      expect(child.stderr).toContain("DatabaseMigrationCompatibilityError");
      expect(child.stdout).not.toContain("worker hazır");
      expect(await queueSnapshot()).toEqual(queueBefore);
      expect((await pool.query("SELECT count(*)::int AS total FROM public.worker_heartbeats")).rows).toEqual(heartbeatBefore);
      await pool.query("DELETE FROM drizzle.__drizzle_migrations");
      for (const row of before.rows) await pool.query("INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)", [row.id, row.hash, row.created_at]);
    }
    await expect(assertDatabaseMigrationCompatibility()).resolves.toBeUndefined();
  } finally {
    await pool.query("DELETE FROM drizzle.__drizzle_migrations");
    for (const row of before.rows) await pool.query("INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)", [row.id, row.hash, row.created_at]);
  }
}, 30_000);
