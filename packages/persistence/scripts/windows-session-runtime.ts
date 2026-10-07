import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, join, win32 } from "node:path";

export function sessionTaskName(root: string): string {
  return `DeliberationAI-session-${createHash("sha256").update(win32.resolve(root).toLowerCase()).digest("hex").slice(0, 20)}`;
}

export async function sessionRuntimeTask(root: string, action: "start" | "status" | "remove") {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) throw new Error("Session runtime requires Windows local storage.");
  // MSIX redirects this directory inside packaged processes. The scheduler must
  // receive its physical path so it reads the same PG data and backup directory.
  const localDataRoot = dirname(await realpath(join(process.env.LOCALAPPDATA, "DeliberationAI")));
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-File",
    join(root, "packages/persistence/scripts/windows-session-runtime.ps1"), "-Action", action,
    "-Root", root, "-NodePath", await realpath(process.execPath), "-LocalDataRoot", localDataRoot], {
    windowsHide: true, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("Windows session runtime action refused or failed.");
  const value = JSON.parse(result.stdout.trim()) as { taskName?: string; started?: boolean; registered?: boolean; running?: boolean; lastTaskResult?: number | null };
  if (value.taskName !== sessionTaskName(root)) throw new Error("Session task identity mismatch.");
  return value;
}
