import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { backupHealth } from "./operational-diagnostics";
test("backup metadata distinguishes missing, invalid and present records without claiming restore verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "da-backup-health-"));
  try {
    expect((await backupHealth(join(root, "absent"))).state).toBe("missing");
    const dir = join(root, "backups"); await mkdir(dir);
    const base = "deliberation-20260101T000000Z-aaaaaaaaaaaa"; await writeFile(join(dir, `${base}.dump`), "fixture");
    const path = join(dir, `${base}.manifest.json`);
    await writeFile(path, JSON.stringify({ format: "deliberation-postgres-backup-v1", createdAt: "2026-01-01T00:00:00Z", archiveFile: `${base}.dump`, bytes: 7, sha256: "a".repeat(64) }));
    expect(await backupHealth(dir)).toMatchObject({ state: "metadata_only", count: 1, bytes: 7 });
    await writeFile(path, "SENSITIVE INVALID JSON");
    expect(await backupHealth(dir)).toMatchObject({ state: "unavailable", latestAt: null });
  } finally { await rm(root, { recursive: true, force: true }); }
});
