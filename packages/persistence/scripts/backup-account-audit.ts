import type { Client } from "pg";

export async function auditRestoredAccounts(client: Client): Promise<{ users: number; roots: number; sessions: number } | null> {
  const schema = (await client.query<{ users: string | null; sessions: string | null; attempts: string | null }>(`SELECT
    to_regclass('public.local_users')::text AS users, to_regclass('public.local_sessions')::text AS sessions,
    to_regclass('public.local_login_attempts')::text AS attempts`)).rows[0]!;
  if (!schema.users && !schema.sessions && !schema.attempts) return null; // historical archive
  if (!schema.users || !schema.sessions || !schema.attempts) throw new Error("Restored account schema incomplete.");
  const invalid = (await client.query<{ invalid: number }>(`SELECT (
    (SELECT count(*) FROM local_users WHERE password_hash !~ '^scrypt-v1:[a-f0-9]{64}:[a-f0-9]{128}$' OR
      username !~ '^[a-z0-9][a-z0-9_.-]{2,31}$' OR NOT ((role='root' AND owner_id='local-owner' AND username='root') OR
      (role='user' AND owner_id='user:' || id::text AND username<>'root'))) +
    (SELECT count(*) FROM local_sessions s LEFT JOIN local_users u ON u.id=s.user_id LEFT JOIN local_users v ON v.id=s.scope_user_id
      WHERE s.token_hash !~ '^[a-f0-9]{64}$' OR u.id IS NULL OR v.id IS NULL OR (u.role<>'root' AND s.user_id<>s.scope_user_id)) +
    (SELECT count(*) FROM local_login_attempts WHERE identity_hash !~ '^[a-f0-9]{64}$' OR attempts < 1)
    )::int AS invalid`)).rows[0]!;
  if (invalid.invalid) throw new Error("Restored account credentials or session scope invalid.");
  const totals = (await client.query<{ users: number; roots: number; sessions: number }>(`SELECT count(*)::int AS users,
    count(*) FILTER(WHERE role='root')::int AS roots, (SELECT count(*)::int FROM local_sessions) AS sessions FROM local_users`)).rows[0]!;
  if (totals.users && totals.roots !== 1) throw new Error("Restored accounts require exactly one root.");
  return totals;
}
