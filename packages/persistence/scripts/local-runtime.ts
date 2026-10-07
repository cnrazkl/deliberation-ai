import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, closeSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

export type RuntimeRecord = { version: "local-runtime-v1"; identity: string; root: string; web: number; worker: number };
export async function interactivePortOccupied(port = 3000): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Local port invalid.");
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (value?: boolean) => { socket.destroy(); if (value === undefined) reject(new Error("Local listener state unavailable.")); else resolve(value); };
    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED" ? false : undefined));
    socket.setTimeout(1000, () => finish());
  });
}
export async function localEnvironment(root: string): Promise<NodeJS.ProcessEnv> {
  const text = await readFile(join(root, ".env.local"), "utf8");
  return { ...process.env, ...Object.fromEntries(text.split(/\r?\n/u).filter((line) => line && !line.startsWith("#")).map((line) => {
    const index = line.indexOf("="); if (index < 1) throw new Error("Local configuration invalid."); return [line.slice(0, index), line.slice(index + 1)];
  })) };
}
export async function runtimeHealthy(identity?: string): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:3000/api/local-diagnostics", { signal: AbortSignal.timeout(2000) });
    const value = await response.json() as { database?: string; readyWorkers?: number; operational?: { runtimeIdentity?: string } };
    return response.ok && value.database === "ready" && value.readyWorkers === 1 && (!identity || value.operational?.runtimeIdentity === identity);
  } catch { return false; }
}
export async function waitRuntime(identity: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await runtimeHealthy(identity)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Managed runtime did not become ready.");
}
export async function startManagedRuntime(root: string, env: NodeJS.ProcessEnv): Promise<RuntimeRecord> {
  root = resolve(root);
  // A slow/unhealthy HTTP response must never authorize a second process pair.
  if (await interactivePortOccupied()) throw new Error("Interactive port is already occupied.");
  const directory = join(root, ".local", "runtime"); await mkdir(directory, { recursive: true });
  const identity = randomUUID();
  const launch = (role: "web" | "worker") => {
    const out = openSync(join(directory, `${role}.stdout.log`), "a"), err = openSync(join(directory, `${role}.stderr.log`), "a");
    try {
      const child = spawn(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "packages/persistence/scripts/runtime-child.ts"), role, identity], {
        cwd: root, env: { ...env, DELIBERATION_RUNTIME_IDENTITY: identity }, windowsHide: true, detached: true, stdio: ["ignore", out, err],
      });
      child.on("error", () => undefined); if (!child.pid) throw new Error("Runtime process unavailable."); child.unref(); return child.pid;
    } finally { closeSync(out); closeSync(err); }
  };
  const record: RuntimeRecord = { version: "local-runtime-v1", identity, root, web: launch("web"), worker: 0 };
  try { record.worker = launch("worker"); await writeFile(join(directory, "managed.json"), JSON.stringify(record), { mode: 0o600 }); await waitRuntime(identity); return record; }
  catch { await stopManagedRuntime(record); throw new Error("Managed runtime startup failed."); }
}
export async function stopManagedRuntime(record: RuntimeRecord): Promise<void> {
  if (record.version !== "local-runtime-v1" || !/^[a-f0-9-]{36}$/u.test(record.identity)) throw new Error("Runtime identity invalid.");
  for (const pid of [record.web, record.worker]) {
    if (!pid) continue;
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Runtime process identity invalid.");
    if (process.platform !== "win32") throw new Error("Managed local runtime currently requires Windows.");
    // Refuse PID reuse: the wrapper's command line must contain this exact nonce.
    const command = `$r=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $r) { exit 0 }; if ($r.CommandLine -notlike '*${record.identity}*') { exit 2 }; taskkill.exe /PID ${pid} /T /F | Out-Null; exit $LASTEXITCODE`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: "ignore", timeout: 20_000 });
    if (result.error || result.status !== 0) throw new Error("Managed process stop refused or failed.");
  }
}

const here = resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === here) {
  const root = resolve(dirname(here), "../../..");
  const action = process.argv[2];
  try {
    if (process.argv.length !== 3 || !["start", "stop", "status"].includes(action ?? "")) throw new Error();
    if (action === "status") console.log(JSON.stringify({ ready: await runtimeHealthy() }));
    else if (action === "stop") {
      const diagnostics = await fetch("http://127.0.0.1:3000/api/local-diagnostics", { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null) as { runningRuns?: number; queuedRuns?: number; unresolvedProviderAttempts?: number; operational?: { unsettled?: number } } | null;
      if (!diagnostics || diagnostics.runningRuns || diagnostics.queuedRuns || diagnostics.unresolvedProviderAttempts || diagnostics.operational?.unsettled) throw new Error();
      const record = JSON.parse(await readFile(join(root, ".local/runtime/managed.json"), "utf8")) as RuntimeRecord;
      await stopManagedRuntime(record); console.log("Managed web/worker stopped; database and records retained.");
    } else if (await runtimeHealthy()) console.log("Local application already ready.");
    else {
      const managed = join(root, "packages/persistence/scripts/manage-portable-postgres.mjs");
      const status = spawnSync(process.execPath, [managed, "status"], { stdio: "ignore", windowsHide: true });
      if (status.status !== 0 && spawnSync(process.execPath, [managed, "start"], { stdio: "ignore", windowsHide: true }).status !== 0) throw new Error();
      if (!existsSync(join(root, ".env.local"))) throw new Error();
      await startManagedRuntime(root, await localEnvironment(root)); console.log("Local application ready at http://127.0.0.1:3000/.");
    }
  } catch { console.error("Local runtime action failed or was refused; inspect stopped processes and unresolved work."); process.exitCode = 1; }
}
