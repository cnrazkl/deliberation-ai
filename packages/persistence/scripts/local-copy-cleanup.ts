import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localCopyCleanupRequestSchema } from "@deliberation-ai/contracts";
import { decryptJson, encryptJson } from "../src/crypto";
import { localEnvironment } from "./local-runtime";

export const localCopyRequest = localCopyCleanupRequestSchema;
type Request = ReturnType<typeof localCopyCleanupRequestSchema.parse>;
export type CopyRoots = { backups: string; exports: string[]; receipts: string };
type Entry = { path: string; bytes: number; sha256: string; inode: number; device: number; modified: number };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
async function inspectFile(path: string): Promise<Entry> {
  const value = await lstat(path);
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 || value.size > 512 * 1024 * 1024 || !same(await realpath(path), path)) throw new Error("Local copy boundary refused.");
  const sha = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += Buffer.byteLength(chunk); if (bytes > 512 * 1024 * 1024) throw new Error(); sha.update(chunk); }
  const after = await lstat(path);
  if (after.ino !== value.ino || after.dev !== value.dev || after.mtimeMs !== value.mtimeMs || after.size !== bytes) throw new Error("Local copy changed.");
  return { path: resolve(path), bytes, sha256: sha.digest("hex"), inode: value.ino, device: value.dev, modified: value.mtimeMs };
}
async function backupPair(path: string, root: string): Promise<Entry[]> {
  if (!same(dirname(path), root) || !/^deliberation-\d{8}T\d{6}Z-[a-f0-9]{12}\.manifest\.json$/u.test(basename(path))) throw new Error();
  const file = await inspectFile(path); if (file.bytes > 8192) throw new Error();
  const body = JSON.parse(await readFile(path, "utf8")) as { format?: string; database?: string; archiveFile?: string; bytes?: number; sha256?: string };
  if (body.format !== "deliberation-postgres-backup-v1" || body.database !== "deliberation_ai" || body.archiveFile !== basename(path).replace(".manifest.json", ".dump")) throw new Error();
  const archive = await inspectFile(join(root, body.archiveFile));
  if (archive.bytes !== body.bytes || archive.sha256 !== body.sha256) throw new Error();
  return [file, archive];
}
export async function previewLocalCopyCleanup(input: unknown, roots: CopyRoots) {
  const request = localCopyRequest.parse(input); const entries: Entry[] = [];
  if (new Set(request.paths.map((path) => resolve(path).toLowerCase())).size !== request.paths.length) throw new Error();
  const backupNames = (await readdir(roots.backups).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; }))
    .filter((name) => /^deliberation-\d{8}T\d{6}Z-[a-f0-9]{12}\.manifest\.json$/u.test(name)).sort();
  for (const raw of request.paths) {
    const path = resolve(raw);
    if (same(dirname(path), roots.backups)) {
      const newest = backupNames.at(-1); if (!newest || basename(path) === newest) throw new Error("Latest backup is protected.");
      await backupPair(join(roots.backups, newest), roots.backups);
      entries.push(...await backupPair(path, roots.backups));
    } else {
      if (!roots.exports.some((root) => same(dirname(path), root)) || !/^deliberationai-(report|synthesis|conversation|private-branch|candidates|evidence)-[a-f0-9-]+(?: \(\d+\))?\.(json|md)$/iu.test(basename(path))) throw new Error("Only explicitly selected application exports are supported.");
      entries.push(await inspectFile(path));
    }
  }
  if (new Set(entries.map((entry) => entry.path.toLowerCase())).size !== entries.length) throw new Error();
  return { version: "local-copy-cleanup-v1" as const, requestId: request.requestId, entries, fingerprint: hash({ request, entries }), externalCopies: "unknown" as const };
}
export async function applyLocalCopyCleanup(input: unknown, fingerprint: string, roots: CopyRoots) {
  const request: Request = localCopyRequest.parse(input);
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) throw new Error();
  await mkdir(roots.receipts, { recursive: true });
  if (!same(await realpath(roots.receipts), roots.receipts)) throw new Error();
  const path = join(roots.receipts, `${request.requestId}.receipt.enc`), context = `local-copy-cleanup:${request.requestId}:receipt`;
  const old = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (old) {
    const previous = decryptJson<{ fingerprint: string; status: string; deleted: number; inputHash: string }>(old, context);
    if (previous.fingerprint !== fingerprint || previous.inputHash !== hash(request)) throw new Error();
    return { replay: true, status: previous.status, deleted: previous.deleted };
  }
  const review = await previewLocalCopyCleanup(request, roots);
  if (review.fingerprint !== fingerprint) throw new Error("Local copy review is stale.");
  const receipt = { version: "local-copy-cleanup-receipt-v1", inputHash: hash(request), fingerprint, status: "submitted", deleted: 0, reviewedFiles: review.entries.length, at: new Date().toISOString() };
  await writeFile(path, encryptJson(receipt, context), { flag: "wx", mode: 0o600, flush: true });
  try {
    for (const entry of review.entries) {
      if (JSON.stringify(await inspectFile(entry.path)) !== JSON.stringify(entry)) throw new Error();
      await unlink(entry.path); receipt.deleted++;
      await writeFile(path, encryptJson(receipt, context), { mode: 0o600, flush: true });
    }
    receipt.status = "completed";
  } catch { receipt.status = "outcome_unknown"; }
  await writeFile(path, encryptJson(receipt, context), { mode: 0o600, flush: true });
  return { replay: false, status: receipt.status, deleted: receipt.deleted };
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && same(process.argv[1], here)) {
  try {
    const root = resolve(dirname(here), "../../..");
    const env = await localEnvironment(root); process.env.DATA_ENCRYPTION_KEY = env.DATA_ENCRYPTION_KEY; process.env.KEY_VERSION = env.KEY_VERSION ?? "1";
    const local = join(process.env.LOCALAPPDATA ?? "", "DeliberationAI");
    const roots = { backups: join(local, "backups"), exports: [join(local, "exports"), join(process.env.USERPROFILE ?? "", "Downloads")], receipts: join(local, "copy-cleanup") };
    const [action, file, fingerprint] = process.argv.slice(2);
    if (!file || !["preview", "apply"].includes(action ?? "") || process.argv.length !== (action === "preview" ? 4 : 5)) throw new Error();
    const info = await lstat(file); if (!info.isFile() || info.size > 24_576) throw new Error();
    const input = JSON.parse(await readFile(file, "utf8"));
    if (action === "apply") console.log(JSON.stringify(await applyLocalCopyCleanup(input, fingerprint!, roots)));
    else { const value = await previewLocalCopyCleanup(input, roots); console.log(JSON.stringify({ version: value.version, requestId: value.requestId, fingerprint: value.fingerprint,
      files: value.entries.map((entry) => ({ name: basename(entry.path), bytes: entry.bytes })), externalCopies: value.externalCopies })); }
  } catch { console.error("Local copy action refused or failed; no automatic retry. Review selected files and receipt."); process.exitCode = 1; }
}
