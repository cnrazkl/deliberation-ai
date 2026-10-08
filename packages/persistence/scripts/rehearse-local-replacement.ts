import { createHash, randomUUID, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import journal from "../drizzle/meta/_journal.json";
import { assertMigrationTimeline } from "../src/migration-compatibility";
import { encryptJson } from "../src/crypto";
import { auditRestoredEncryption } from "./backup-encryption-audit";
import { snapshotRecoveryDatabase, requireMatchingRecovery, changedRecoveryTables, inspectRecoveryWork, requireQuiescentRecovery, parkRestoredQueue, type RecoverySnapshot } from "./recovery-integrity";
import { interactivePortOccupied, localEnvironment, startManagedRuntime, startSessionRuntime, stopManagedRuntime, type RuntimeRecord } from "./local-runtime";
import { auditRestoredAccounts } from "./backup-account-audit";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const localRoot = join(process.env.LOCALAPPDATA ?? "", "DeliberationAI"), recoveryRoot = join(localRoot, "recovery");
// Keep dependency paths short and outside MSIX AppData virtualization. Receipts
// remain in application storage; disposable working files stay ignored here.
const workRoot = resolve(repo, ".local/recovery");
const identity = randomUUID(), target = resolve(workRoot, identity), checkout = join(target, "checkout");
const bin = join(localRoot, "postgresql-18.6/pgsql/bin");
const steps: Array<{ phase: string; elapsedMs: number }> = [];
let phase = "authorization", cluster = false, created = false, safeCleanup = true, replacementMayHaveChanges = false;
let runtime: RuntimeRecord | undefined, source: Client | undefined, restored: Client | undefined;
const run = (command: string, args: string[], cwd = repo, env: NodeJS.ProcessEnv = process.env) => {
  const result = spawnSync(command, args, { cwd, env, windowsHide: true, encoding: "utf8", timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
    // A daemon must not inherit a captured pipe and keep spawnSync waiting after
    // pg_ctl has exited. Its private log is already supplied explicitly.
    stdio: basename(command).toLowerCase() === "pg_ctl.exe" ? "ignore" : "pipe" });
  if (result.error || result.status !== 0) throw new Error("Replacement step failed."); return result.stdout ?? "";
};
const stamp = async (name: string, action: () => Promise<void>) => {
  phase = name; const start = performance.now(); await action(); steps.push({ phase: name, elapsedMs: Math.round(performance.now() - start) });
  phase = name; console.log(`Replacement phase passed: ${name}.`);
};
async function fileHash(path: string) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
function compare(source: RecoverySnapshot, restored: RecoverySnapshot, applicationOnly = false) {
  const changed = changedRecoveryTables(source, restored, applicationOnly);
  if (changed.length) console.error(JSON.stringify({ phase, changedTables: changed.map((name) => ({ name, sourceRows: source.tables[name]?.rows ?? null, restoredRows: restored.tables[name]?.rows ?? null })) }));
  requireMatchingRecovery(source, restored, applicationOnly);
}
let ownerEnv: NodeJS.ProcessEnv | undefined;
try {
  if (process.argv.length !== 3 || process.argv[2] !== "--live-owner" || process.platform !== "win32" || !process.env.LOCALAPPDATA) throw new Error();
  ownerEnv = await localEnvironment(repo);
  const ownerUrl = new URL(ownerEnv.DATABASE_URL ?? "");
  if (ownerUrl.protocol !== "postgresql:" || ownerUrl.hostname !== "127.0.0.1" || ownerUrl.port !== "5432" || ownerUrl.pathname !== "/deliberation_ai" || ownerUrl.username !== "deliberation" || !ownerUrl.password) throw new Error();
  Object.assign(process.env, { DATA_ENCRYPTION_KEY: ownerEnv.DATA_ENCRYPTION_KEY, KEY_VERSION: ownerEnv.KEY_VERSION ?? "1" });
  source = new Client({ connectionString: ownerUrl.toString() }); await source.connect();
  const live = await source.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'deliberation-ai-worker:%'");
  if (live.rows[0].count) throw new Error("Stop the source runtime first.");
  if (await interactivePortOccupied()) throw new Error("Stop the source runtime first.");
  requireQuiescentRecovery(await inspectRecoveryWork(source));
  const baseline = await snapshotRecoveryDatabase(source);
  run("git", ["diff", "--quiet"]); const tree = run("git", ["write-tree"]).trim();
  if (!/^[a-f0-9]{40,64}$/u.test(tree)) throw new Error();
  const inventory = run("git", ["ls-tree", "-r", "--name-only", tree]).trim().split(/\r?\n/u);
  if (inventory.some((path) => path.includes("\\") || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "node_modules" || part === ".local" || part.startsWith(".env") && part !== ".env.example"))
    || run("git", ["ls-tree", "-r", tree]).split(/\r?\n/u).some((line) => line.startsWith("120000 "))) throw new Error();
  await mkdir(recoveryRoot, { recursive: true }); await mkdir(workRoot, { recursive: true });
  if (resolve(await realpath(workRoot)).toLowerCase() !== workRoot.toLowerCase()) throw new Error();
  await mkdir(target); created = true; await mkdir(checkout);
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"].includes(key.toUpperCase())));
  Object.assign(cleanEnv, { HOME: join(target, "home"), USERPROFILE: join(target, "home"), APPDATA: join(target, "home/appdata"), LOCALAPPDATA: join(target, "home/local"),
    npm_config_userconfig: join(target, "empty.npmrc"), npm_config_globalconfig: join(target, "empty-global.npmrc"), npm_config_cache: join(target, "npm-cache"), CI: "true", COREPACK_ENABLE_PROJECT_SPEC: "0" });
  await mkdir(cleanEnv.HOME!, { recursive: true }); await writeFile(cleanEnv.npm_config_userconfig!, "", { flag: "wx" }); await writeFile(cleanEnv.npm_config_globalconfig!, "", { flag: "wx" });
  const pnpm = (command: string) => run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `pnpm ${command}`], checkout, cleanEnv);
  await stamp("clean-source-and-dependencies", async () => {
    run("git", ["archive", "--format=tar", "--output", join(target, "source.tar"), tree]); run("tar", ["-xf", join(target, "source.tar"), "-C", checkout]);
    phase = "clean-dependencies";
    pnpm("install --frozen-lockfile --ignore-scripts --store-dir=../store");
    phase = "clean-unit-checks"; pnpm("test"); phase = "clean-extraction-checks"; pnpm("knowledge:extraction:verify");
  });
  const backupRoot = join(localRoot, "backups");
  const names = (await readdir(backupRoot)).filter((name) => /^deliberation-\d{8}T\d{6}Z-[a-f0-9]{12}\.manifest\.json$/u.test(name)).sort();
  const name = names.at(-1); if (!name) throw new Error();
  const manifest = JSON.parse(await readFile(join(backupRoot, name), "utf8")) as { format: string; database: string; archiveFile: string; bytes: number; sha256: string };
  if (manifest.format !== "deliberation-postgres-backup-v1" || manifest.database !== "deliberation_ai" || !/^deliberation-\d{8}T\d{6}Z-[a-f0-9]{12}\.dump$/u.test(manifest.archiveFile)
    || !/^[a-f0-9]{64}$/u.test(manifest.sha256)) throw new Error();
  const archive = join(backupRoot, manifest.archiveFile);
  if ((await stat(archive)).size !== manifest.bytes || await fileHash(archive) !== manifest.sha256) throw new Error();
  const password = randomBytes(32).toString("hex"), passwordFile = join(target, "postgres-password.local"), data = join(target, "postgres-data");
  await writeFile(passwordFile, password, { flag: "wx", mode: 0o600 });
  await stamp("independent-postgres-installation", async () => {
    run(join(bin, "initdb.exe"), ["-D", data, "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C"]);
    cluster = true;
    run(join(bin, "pg_ctl.exe"), ["-D", data, "-l", join(target, "postgres.log"), "-o", "-h 127.0.0.1 -p 5433 -c log_min_error_statement=panic", "start", "-w"]);
    const admin = new Client({ host: "127.0.0.1", port: 5433, user: "postgres", password, database: "postgres" });
    await admin.connect(); try {
      const quoted = (await admin.query("SELECT quote_literal($1) AS value", [decodeURIComponent(ownerUrl.password)])).rows[0].value as string;
      await admin.query(`CREATE ROLE deliberation LOGIN PASSWORD ${quoted}`); await admin.query("CREATE DATABASE deliberation_ai OWNER deliberation TEMPLATE template0");
    } finally { await admin.end(); }
  });
  const replacementUrl = new URL(ownerUrl); replacementUrl.port = "5433";
  const pgEnv: NodeJS.ProcessEnv = { ...cleanEnv, PGHOST: "127.0.0.1", PGPORT: "5433", PGUSER: "deliberation", PGPASSWORD: decodeURIComponent(ownerUrl.password) };
  restored = new Client({ connectionString: replacementUrl.toString() });
  await stamp("restore-encryption-and-current-state", async () => {
    phase = "restore-archive";
    run(join(bin, "pg_restore.exe"), ["--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "--dbname=deliberation_ai", archive], checkout, pgEnv);
    await restored!.connect();
    phase = "verify-migration-history";
    assertMigrationTimeline((await restored!.query<{ created_at: string }>("SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows.map((row) => Number(row.created_at)), journal.entries.map((entry) => entry.when));
    phase = "verify-encrypted-fields"; await auditRestoredEncryption(restored!); await auditRestoredAccounts(restored!);
    phase = "compare-restored-records"; compare(baseline, await snapshotRecoveryDatabase(restored!));
    phase = "recheck-current-source"; compare(baseline, await snapshotRecoveryDatabase(source!));
    phase = "inspect-restored-work"; requireQuiescentRecovery(await inspectRecoveryWork(restored!));
  });
  let parked = 0;
  const runtimeEnv = { ...ownerEnv, DATABASE_URL: replacementUrl.toString(), APP_ORIGIN: "http://127.0.0.1:3000", ENABLE_DECISION_EVALUATOR: "false", DELIBERATION_RECOVERY_HOLD: "true", DELIBERATION_RECOVERY_FORBID_GENERATION: "true" };
  await stamp("real-port-cutover-with-dispatch-held", async () => {
    runtime = await startManagedRuntime(checkout, runtimeEnv);
    const response = await fetch("http://127.0.0.1:3000/api/provider-connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) });
    if (response.status !== 503) throw new Error();
    requireMatchingRecovery(baseline, await snapshotRecoveryDatabase(restored!));
    await stopManagedRuntime(runtime!); runtime = undefined;
  });
  await stamp("reviewed-queue-parking-and-operational-cutover", async () => {
    parked = await parkRestoredQueue(restored!, true);
    replacementMayHaveChanges = true;
    // This host-admin probe has direct access to the already verified clone. Its
    // short-lived root session is removed before comparing retained records.
    const rootAccount = (await restored!.query<{ id: string }>("SELECT id FROM local_users WHERE role='root'")).rows[0];
    if (!rootAccount) throw new Error("Provisioned root is required for authenticated recovery verification.");
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
    await restored!.query("INSERT INTO local_sessions(token_hash,user_id,scope_user_id,expires_at) VALUES($1,$2,$2,now()+interval '10 minutes')", [sessionHash, rootAccount.id]);
    const accountHeaders = { Cookie: `deliberation-session=${sessionToken}`, "X-Deliberation-Owner": "local-owner", Origin: "http://127.0.0.1:3000" };
    runtime = await startManagedRuntime(checkout, { ...runtimeEnv, DELIBERATION_RECOVERY_HOLD: "false" });
    let fixture: string | undefined;
    try {
      const response = await fetch("http://127.0.0.1:3000/api/provider-connections", { method: "POST", headers: { ...accountHeaders, "Content-Type": "application/json" }, body: JSON.stringify({
        provider: "openai-compatible", label: `Recovery verification ${identity}`, defaultModel: "local-fixture", apiKey: "", baseUrl: "http://127.0.0.1:1/v1", endpointPreset: "ollama", reasoningProtocol: "none", structuredOutputMode: "json-object",
      }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(); fixture = ((await response.json()) as { id: string }).id;
    } finally {
      try {
        if (fixture && !(await fetch(`http://127.0.0.1:3000/api/provider-connections?id=${fixture}`, { method: "DELETE", headers: accountHeaders, signal: AbortSignal.timeout(10_000) })).ok) throw new Error();
      } finally { await restored!.query("DELETE FROM local_sessions WHERE token_hash=$1", [sessionHash]); }
    }
    await stopManagedRuntime(runtime!); runtime = undefined;
    requireMatchingRecovery(baseline, await snapshotRecoveryDatabase(restored!), true);
    replacementMayHaveChanges = false;
    requireMatchingRecovery(baseline, await snapshotRecoveryDatabase(source!));
  });
  await stamp("rollback-to-preserved-original", async () => {
    await startSessionRuntime(repo);
    requireMatchingRecovery(baseline, await snapshotRecoveryDatabase(source!), true);
  });
  await writeFile(join(recoveryRoot, `${identity}.receipt.enc`), encryptJson({ version: "local-replacement-receipt-v1", identity, completedAt: new Date().toISOString(), sourceTree: tree,
    archiveSha256: manifest.sha256, baselineFingerprint: baseline.fingerprint, parkedRestoredJobs: parked, steps, cutover: "verified", rollback: "verified", separateMachine: "not_assessed", providerCalls: 0 }, `local-replacement:${identity}:receipt`), { flag: "wx", mode: 0o600, flush: true });
  console.log(JSON.stringify({ sourceTree: tree, cutover: "verified", rollback: "verified", parkedRestoredJobs: parked, providerCalls: 0, steps }));
} catch {
  // Keep a changed replacement and its runtime for manual reconciliation; never
  // lose post-cutover writes by silently rolling back or dropping that cluster.
  safeCleanup = !runtime && !replacementMayHaveChanges;
  console.error(`Local replacement failed during ${phase}; no automatic resend. ${safeCleanup ? "Original database retained." : "Replacement retained for reconciliation; do not remove it."}`);
  process.exitCode = 1;
} finally {
  await restored?.end().catch(() => undefined); await source?.end().catch(() => undefined);
  if (created && safeCleanup) {
    if (cluster) run(join(bin, "pg_ctl.exe"), ["-D", join(target, "postgres-data"), "stop", "-m", "fast", "-w"]);
    if (dirname(target) !== workRoot || basename(target) !== identity || resolve(await realpath(target)).toLowerCase() !== target.toLowerCase()) throw new Error("Unexpected replacement cleanup target.");
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
  }
}
