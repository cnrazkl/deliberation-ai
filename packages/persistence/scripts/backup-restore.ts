import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Client } from "pg";
import { auditRestoredEncryption, type EncryptionAudit } from "./backup-encryption-audit";
import { inspectAdditionalRecovery, type AdditionalRecoveryInventory } from "./backup-recovery-inventory";

const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error("LOCALAPPDATA is required for local backup operations.");
const localRoot = join(localAppData, "DeliberationAI");
const backupDirectory = join(localRoot, "backups");
const postgresBin = join(localRoot, "postgresql-18.6", "pgsql", "bin");
const manifestFormat = "deliberation-postgres-backup-v1";

interface BackupManifest {
  format: typeof manifestFormat;
  createdAt: string;
  database: "deliberation_ai";
  archiveFile: string;
  bytes: number;
  sha256: string;
}

interface RecoveryInspection extends AdditionalRecoveryInventory {
  conversations: { count: number; members: number; unavailableMembers: number; privateBranches: number } | null;
  runs: number;
  encryptionAudit: EncryptionAudit;
  runStatuses: Record<string, number>;
  providerOperationStatuses: Record<string, number>;
  activeSchedules: number;
}

function localDatabaseUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required.");
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
      url.port !== "5432" || url.pathname !== "/deliberation_ai" ||
      decodeURIComponent(url.username) !== "deliberation" || !url.password) {
    throw new Error("Backup commands require the provisioned local deliberation_ai database.");
  }
  return url;
}

function pgEnvironment(url: URL): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  delete environment.DATA_ENCRYPTION_KEY;
  environment.PGHOST = "127.0.0.1";
  environment.PGPORT = "5432";
  environment.PGUSER = "deliberation";
  environment.PGPASSWORD = decodeURIComponent(url.password);
  environment.PGDATABASE = "deliberation_ai";
  return environment;
}

function runPostgresTool(tool: "pg_dump" | "pg_restore", args: string[], environment: NodeJS.ProcessEnv): void {
  const executable = join(postgresBin, `${tool}.exe`);
  if (!existsSync(executable)) throw new Error(`${tool} is missing from the portable PostgreSQL installation.`);
  const result = spawnSync(executable, args, {
    env: environment,
    shell: false,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 1024 * 1024,
  });
  // PostgreSQL errors can contain SQL and stored values; do not forward child output to general logs.
  if (result.error || result.status !== 0) {
    throw new Error(`${tool} failed (exit ${result.status ?? "unknown"}).`);
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function parseManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== "object") throw new Error("Backup manifest is invalid.");
  const candidate = value as Partial<BackupManifest>;
  if (candidate.format !== manifestFormat || candidate.database !== "deliberation_ai" ||
      typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt)) ||
      typeof candidate.archiveFile !== "string" ||
      !/^deliberation-\d{8}T\d{6}Z-[a-f0-9]{12}\.dump$/u.test(candidate.archiveFile) ||
      !Number.isSafeInteger(candidate.bytes) || (candidate.bytes ?? 0) < 1 ||
      typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.sha256)) {
    throw new Error("Backup manifest is invalid.");
  }
  return candidate as BackupManifest;
}

async function latestManifestPath(): Promise<string> {
  const filenames = (await readdir(backupDirectory))
    .filter((name) => /^deliberation-\d{8}T\d{6}Z-[a-f0-9]{12}\.manifest\.json$/u.test(name))
    .sort();
  const latest = filenames.at(-1);
  if (!latest) throw new Error("No local backup manifest was found.");
  return join(backupDirectory, latest);
}

async function readAdminPassword(): Promise<string> {
  const lines = (await readFile(join(localRoot, "postgres-admin.local"), "utf8")).split(/\r?\n/u);
  const entry = lines.find((line) => line.startsWith("POSTGRES_SUPERUSER_PASSWORD="));
  const password = entry?.slice("POSTGRES_SUPERUSER_PASSWORD=".length);
  if (!password) throw new Error("The local PostgreSQL administrator secret is unavailable.");
  return password;
}

async function statusCounts(client: Client, table: "runs" | "provider_operations"): Promise<Record<string, number>> {
  const result = await client.query<{ status: string; total: string }>(
    `SELECT status::text, count(*)::text AS total FROM public.${table} GROUP BY status`,
  );
  return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.total)]));
}

async function verifyBackup(manifestPath: string, sourceUrl: URL): Promise<RecoveryInspection> {
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  const archivePath = join(dirname(manifestPath), manifest.archiveFile);
  const archiveStats = await stat(archivePath);
  if (!archiveStats.isFile() || archiveStats.size !== manifest.bytes ||
      (await sha256File(archivePath)) !== manifest.sha256) {
    throw new Error("Backup archive size or SHA-256 does not match its manifest.");
  }
  const environment = pgEnvironment(sourceUrl);
  runPostgresTool("pg_restore", ["--list", archivePath], environment);

  const scratchName = `deliberation_verify_${randomBytes(6).toString("hex")}`;
  const admin = new Client({
    host: "127.0.0.1", port: 5432, user: "postgres", database: "postgres",
    password: await readAdminPassword(),
  });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${scratchName}" OWNER "deliberation"`);
    created = true;
    runPostgresTool("pg_restore", [
      "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges",
      `--dbname=${scratchName}`, archivePath,
    ], environment);

    const restoredUrl = new URL(sourceUrl);
    restoredUrl.pathname = `/${scratchName}`;
    const restored = new Client({ connectionString: restoredUrl.toString() });
    await restored.connect();
    try {
      const schema = await restored.query<{
        runs_table: string | null;
        connections_table: string | null;
        queue_table: string | null;
      }>("SELECT to_regclass('public.runs')::text AS runs_table, to_regclass('public.provider_connections')::text AS connections_table, to_regclass('pgboss.job')::text AS queue_table");
      if (!schema.rows[0]?.runs_table || !schema.rows[0].connections_table || !schema.rows[0].queue_table) {
        throw new Error("Restored database is missing an application or queue table.");
      }
      const runStatuses = await statusCounts(restored, "runs");
      const providerOperationStatuses = await statusCounts(restored, "provider_operations");
      const schedules = await restored.query<{ total: string }>(
        "SELECT count(*)::text AS total FROM public.local_schedules WHERE status = 'active'",
      );
      const encryptionAudit = await auditRestoredEncryption(restored);
      const conversationSchema = await restored.query<{ conversations: string | null; members: string | null }>(
        "select to_regclass('public.conversations')::text as conversations, to_regclass('public.conversation_runs')::text as members",
      );
      const conversationTables = conversationSchema.rows[0]!;
      if (Boolean(conversationTables.conversations) !== Boolean(conversationTables.members)) throw new Error("Incomplete conversation schema in restored database.");
      let conversationInventory: RecoveryInspection["conversations"] = null;
      if (conversationTables.conversations) {
        const invalid = await restored.query<{ invalid: string }>(`select count(*)::text as invalid
          from conversation_runs cr left join conversations c on c.id = cr.conversation_id
          left join runs r on r.id = cr.run_id and r.owner_id = cr.owner_id
          where c.id is null or c.owner_id <> cr.owner_id or (r.id is not null and
            (r.branch_index_version <> 1 or r.branch_source_run_id is distinct from cr.source_run_id
             or r.branch_kind is distinct from cr.kind or r.created_at <> cr.created_at))`);
        if (Number(invalid.rows[0]?.invalid) !== 0) throw new Error("Restored conversation membership is inconsistent.");
        const inventory = await restored.query<{ count: string; members: string; unavailable: string }>(`select
          (select count(*) from conversations)::text as count,
          count(*)::text as members,
          count(*) filter (where r.id is null)::text as unavailable
          from conversation_runs cr left join runs r on r.id = cr.run_id and r.owner_id = cr.owner_id`);
        conversationInventory = { count: Number(inventory.rows[0]!.count), members: Number(inventory.rows[0]!.members), unavailableMembers: Number(inventory.rows[0]!.unavailable), privateBranches: 0 };
      }
      const privateSchema = await restored.query<{ present: boolean }>("select to_regclass('public.conversation_private_branches') is not null as present");
      if (privateSchema.rows[0]?.present) {
        if (!conversationInventory) throw new Error("Private branches require conversation metadata.");
        const invalid = await restored.query<{ invalid: string }>(`select count(*)::text as invalid
          from conversation_private_branches b left join conversations c on c.id = b.conversation_id
          left join conversation_runs cr on cr.run_id = b.source_run_id and cr.owner_id = b.owner_id
          left join conversation_private_branches p on p.id = b.parent_branch_id
          where c.id is null or c.owner_id <> b.owner_id or cr.conversation_id is distinct from b.conversation_id or
            (p.id is not null and (p.owner_id <> b.owner_id or p.conversation_id <> b.conversation_id or
              p.source_run_id <> b.source_run_id or p.source_member_id <> b.source_member_id))`);
        if (Number(invalid.rows[0]?.invalid) !== 0) throw new Error("Restored private branch membership is inconsistent.");
        const count = await restored.query<{ total: string }>("select count(*)::text as total from conversation_private_branches");
        conversationInventory.privateBranches = Number(count.rows[0]!.total);
      }
      return {
        ...await inspectAdditionalRecovery(restored),
        conversations: conversationInventory,
        runs: Object.values(runStatuses).reduce((total, count) => total + count, 0),
        encryptionAudit,
        runStatuses,
        providerOperationStatuses,
        activeSchedules: Number(schedules.rows[0]?.total ?? 0),
      };
    } finally {
      await restored.end();
    }
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${scratchName}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

async function createBackup(sourceUrl: URL): Promise<{ manifestPath: string; pendingPath: string; archivePath: string }> {
  await mkdir(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  const base = `deliberation-${stamp}-${randomBytes(6).toString("hex")}`;
  const archiveFile = `${base}.dump`;
  const archivePath = join(backupDirectory, archiveFile);
  const partialPath = `${archivePath}.partial`;
  try {
    runPostgresTool("pg_dump", ["--format=custom", "--no-privileges", "--file", partialPath, "--dbname=deliberation_ai"], pgEnvironment(sourceUrl));
    const bytes = (await stat(partialPath)).size;
    const sha256 = await sha256File(partialPath);
    await rename(partialPath, archivePath);
    const manifest: BackupManifest = {
      format: manifestFormat,
      createdAt: new Date().toISOString(),
      database: "deliberation_ai",
      archiveFile,
      bytes,
      sha256,
    };
    const manifestPath = join(backupDirectory, `${base}.manifest.json`);
    const pendingPath = `${manifestPath}.pending`;
    await writeFile(pendingPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return { manifestPath, pendingPath, archivePath };
  } catch (error) {
    await rm(archivePath, { force: true });
    throw error;
  } finally {
    await rm(partialPath, { force: true });
  }
}

const action = process.argv[2];
if ((action !== "backup" && action !== "verify" && action !== "rehearse") || process.argv.length > 3) {
  throw new Error("Expected exactly one action: backup, verify, or rehearse.");
}
const sourceUrl = localDatabaseUrl();
const configuredManifest = process.env.DELIBERATION_BACKUP_MANIFEST;
let manifestPath: string;
let result: RecoveryInspection;
if (action === "backup") {
  const created = await createBackup(sourceUrl);
  try {
    result = await verifyBackup(created.pendingPath, sourceUrl);
    await rename(created.pendingPath, created.manifestPath);
    manifestPath = created.manifestPath;
  } catch (error) {
    await rm(created.pendingPath, { force: true });
    await rm(created.archivePath, { force: true });
    throw error;
  }
} else {
  manifestPath = configuredManifest ? resolve(configuredManifest) : await latestManifestPath();
  result = await verifyBackup(manifestPath, sourceUrl);
}
console.log(`Backup verified in a temporary database: ${basename(manifestPath)}; runs=${result.runs}; encrypted rows=${result.encryptionAudit.rows}; decrypted values=${result.encryptionAudit.decryptedValues}; populated tables=${result.encryptionAudit.populatedTables}.`);
if (result.conversations) console.log(`Restored conversation inventory: ${JSON.stringify(result.conversations)}.`);
if (action === "backup") console.log(`Backup saved at ${manifestPath}. Preserve .env.local separately with the same backup.`);
if (action === "rehearse") {
  console.log(`Recovery inventory: run statuses=${JSON.stringify(result.runStatuses)}; provider operation statuses=${JSON.stringify(result.providerOperationStatuses)}; active schedules=${result.activeSchedules}.`);
  console.log(`Decision recovery inventory: assessment statuses=${JSON.stringify(result.decisionAssessmentStatuses)}; operation statuses=${JSON.stringify(result.decisionOperationStatuses)}.`);
  console.log(`Private recovery inventory: ${JSON.stringify(result.privateBranches)}. Copied deliveries are historical snapshots, not additional dispatches; deleted-branch receipts are excluded. Null means the archive predates that schema.`);
  console.log("Review queued/running runs and decision assessments, prepared/submitted/outcome_unknown/retry_authorized operations, copied private outcomes, and active schedules before any replacement cutover. Counts describe this archive, not live state. This rehearsal did not start a worker or replace the live database.");
}
