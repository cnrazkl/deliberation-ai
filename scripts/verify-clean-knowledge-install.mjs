import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = resolve(repo, ".local", "clean-install-verification");
const identity = randomUUID();
const target = resolve(scratch, identity);
const checkout = join(target, "checkout");
const steps = [];
let phase = "source-inventory";
let created = false;

// No application env, user npm configuration, owner database or shared pnpm store.
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"].includes(key.toUpperCase())));
const run = (command, args, cwd = repo, env = childEnv) => {
  const result = spawnSync(command, args, { cwd, env, windowsHide: true, encoding: "utf8", timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Verification step failed.");
  return result.stdout;
};
const pnpm = (args) => process.platform === "win32"
  ? run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `pnpm ${args}`], checkout, isolatedEnv)
  : run("pnpm", args.split(" "), checkout, isolatedEnv);
const isolatedEnv = { ...childEnv, HOME: join(target, "home"), USERPROFILE: join(target, "home"),
  APPDATA: join(target, "home", "appdata"), LOCALAPPDATA: join(target, "home", "local"),
  npm_config_userconfig: join(target, "empty.npmrc"), npm_config_globalconfig: join(target, "empty-global.npmrc"),
  npm_config_cache: join(target, "home", "npm-cache"),
  CI: "true", COREPACK_ENABLE_PROJECT_SPEC: "0" };

try {
  if (process.argv.length !== 2) throw new Error("Unsupported arguments.");
  // Use the reviewed index, including this increment; refuse unstaged tracked edits.
  run("git", ["diff", "--quiet"]);
  const tree = run("git", ["write-tree"]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(tree)) throw new Error("Invalid source tree.");
  const inventory = run("git", ["ls-tree", "-r", "--name-only", tree]).trim().split("\n");
  if (inventory.some((path) => path.startsWith("/") || path.includes("\\") || path.split("/").some((part) =>
    part === ".." || part === ".local" || part === "node_modules" || (part.startsWith(".env") && part !== ".env.example")))) throw new Error("Private source inventory refused.");
  if (run("git", ["ls-tree", "-r", tree]).split("\n").some((line) => line.startsWith("120000 "))) throw new Error("Source symlinks refused.");
  await mkdir(scratch, { recursive: true });
  await mkdir(target); created = true;
  await mkdir(checkout);
  await mkdir(isolatedEnv.HOME, { recursive: true });
  await writeFile(isolatedEnv.npm_config_userconfig, "", { flag: "wx" });
  await writeFile(isolatedEnv.npm_config_globalconfig, "", { flag: "wx" });
  run("git", ["archive", "--format=tar", "--output", join(target, "source.tar"), tree]);
  run("tar", ["-xf", join(target, "source.tar"), "-C", checkout]);
  for (const path of ["node_modules", ".env.local", ".local", ".git"]) {
    await stat(join(checkout, path)).then(() => { throw new Error("Private state copied."); }, (error) => { if (error.code !== "ENOENT") throw error; });
  }
  // Every pnpm command uses this previously absent isolated store.
  const pnpmVersion = pnpm("--version").trim();
  if (!/^11\.\d+\.\d+$/.test(pnpmVersion)) throw new Error("Supported pnpm major required.");
  const storeArg = "--store-dir=../store";
  for (const [name, command] of [
    ["frozen-install", `install --frozen-lockfile --ignore-scripts ${storeArg}`],
    ["knowledge-status", "knowledge:status"],
    ["extraction", "knowledge:extraction:verify"],
    ["unit-tests", "test"],
    ["lint-compatibility", "test:lint-dependencies"],
  ]) {
    phase = name; const start = performance.now(); const output = pnpm(command);
    if (name === "unit-tests") phase = "unit-test-summary";
    const plainOutput = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
    const passedTests = name === "unit-tests" ? Number(plainOutput.match(/Tests\s+(\d+) passed/)?.[1]) : null;
    if (name === "unit-tests" && (!Number.isSafeInteger(passedTests) || passedTests < 1)) throw new Error("Missing test summary.");
    steps.push({ step: name, durationMs: Math.round(performance.now() - start), passed: true, passedTests });
    console.log(`Clean installation step passed: ${name}.`);
  }
  console.log(JSON.stringify({ sourceTree: tree, platform: process.platform, node: process.version, pnpm: pnpmVersion, steps,
    cleanMachineAcceptance: "not_assessed", ownerDatabase: "not_used", modelMeasurements: "not_assessed" }, null, 2));
} catch {
  console.error(`Clean installation verification failed during ${phase}; owner data was not used.`);
  process.exitCode = 1;
} finally {
  if (created) {
    if (dirname(target) !== scratch || basename(target) !== identity) throw new Error("Unexpected cleanup target.");
    try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 }); }
    catch { console.error("Clean installation temporary directory cleanup failed."); process.exitCode = 1; }
  }
}
