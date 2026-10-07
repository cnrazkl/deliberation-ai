import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test, vi } from "vitest";
import { applyLocalCopyCleanup, previewLocalCopyCleanup } from "./local-copy-cleanup";
test("deletes only reviewed selected copies, retains the latest backup, and replay preserves a replacement file", async () => {
  const root = await mkdtemp(join(tmpdir(), "da-copies-"));
  const roots = { backups: join(root, "backups"), exports: [join(root, "exports")], receipts: join(root, "receipts") };
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  try {
    await mkdir(roots.backups); await mkdir(roots.exports[0]!);
    const backup = async (stamp: string) => {
      const name = `deliberation-${stamp}-aaaaaaaaaaaa`, bytes = Buffer.from("synthetic archive");
      await writeFile(join(roots.backups, `${name}.dump`), bytes);
      await writeFile(join(roots.backups, `${name}.manifest.json`), JSON.stringify({ format: "deliberation-postgres-backup-v1", database: "deliberation_ai", archiveFile: `${name}.dump`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }));
      return join(roots.backups, `${name}.manifest.json`);
    };
    const older = await backup("20260101T000000Z"), newest = await backup("20260102T000000Z");
    await expect(previewLocalCopyCleanup({ requestId: randomUUID(), paths: [newest] }, roots)).rejects.toThrow("protected");
    const path = join(roots.exports[0]!, `deliberationai-report-${randomUUID()}.json`); await writeFile(path, "SENSITIVE EXPORT");
    const request = { requestId: randomUUID(), paths: [older, path] };
    const review = await previewLocalCopyCleanup(request, roots);
    expect(review.entries).toHaveLength(3); expect(JSON.stringify(review)).not.toContain("SENSITIVE EXPORT");
    expect(await applyLocalCopyCleanup(request, review.fingerprint, roots)).toMatchObject({ status: "completed", deleted: 3 });
    await writeFile(path, "NEW FILE MUST SURVIVE");
    expect(await applyLocalCopyCleanup(request, review.fingerprint, roots)).toMatchObject({ replay: true, status: "completed" });
    expect(await readFile(path, "utf8")).toBe("NEW FILE MUST SURVIVE"); expect(await readFile(newest, "utf8")).toContain("deliberation-postgres-backup-v1");
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});
test("refuses stale bytes, unrelated files, duplicate paths and redirected export roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "da-copies-"));
  const exports = join(root, "exports"), linked = join(root, "linked"); await mkdir(exports);
  const roots = { backups: join(root, "backups"), exports: [exports], receipts: join(root, "receipts") };
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
  try {
    const file = join(exports, `deliberationai-conversation-${randomUUID()}.md`); await writeFile(file, "reviewed");
    const request = { requestId: randomUUID(), paths: [file] }, review = await previewLocalCopyCleanup(request, roots);
    await writeFile(file, "changed"); await expect(applyLocalCopyCleanup(request, review.fingerprint, roots)).rejects.toThrow("stale");
    await expect(previewLocalCopyCleanup({ ...request, paths: [file, file] }, roots)).rejects.toThrow();
    await expect(previewLocalCopyCleanup({ ...request, paths: [join(exports, "secrets.env")] }, roots)).rejects.toThrow();
    await symlink(exports, linked, "junction");
    await expect(previewLocalCopyCleanup({ ...request, paths: [join(linked, file.slice(exports.length + 1))] }, { ...roots, exports: [linked] })).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("changed");
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});
