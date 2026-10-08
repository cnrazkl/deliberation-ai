import { randomUUID } from "node:crypto";
import type {
  EvidenceState,
  FrozenMemoryEntry,
  MemorySourceType,
  SaveMemoryEntryRequest,
} from "@deliberation-ai/contracts";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { decryptText, encryptText } from "./crypto";
import { getDatabase } from "./database";
import { getOwnerId } from "./owner";
import { claims, memoryEntries, runs } from "./schema";

export const MAX_STORED_MEMORY_ENTRIES = 20;
export const MAX_RUN_MEMORY_ENTRIES = 5;

export type SharedMemoryEntry = FrozenMemoryEntry & {
  sourceRunId: string;
  sourceClaimId: string;
  createdAt: string;
};

export class MemoryLimitError extends Error {
  constructor() {
    super(`En fazla ${MAX_STORED_MEMORY_ENTRIES} ortak bellek kaydı saklanabilir.`);
    this.name = "MemoryLimitError";
  }
}

export class MemorySelectionError extends Error {
  constructor() {
    super("Seçilen bellek kayıtlarından biri bulunamadı veya bu kullanıcıya ait değil.");
    this.name = "MemorySelectionError";
  }
}

function mapMemoryEntry(row: typeof memoryEntries.$inferSelect): SharedMemoryEntry {
  return {
    id: row.id,
    content: decryptText(row.contentCiphertext, `memory-entry:${row.id}:content`),
    evidenceState: row.evidenceState as EvidenceState,
    sourceType: row.sourceType as MemorySourceType,
    sourceRunId: row.sourceRunId,
    sourceClaimId: row.sourceClaimId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMemoryEntries(): Promise<SharedMemoryEntry[]> {
  const rows = await getDatabase()
    .select()
    .from(memoryEntries)
    .where(eq(memoryEntries.ownerId, getOwnerId()))
    .orderBy(asc(memoryEntries.createdAt));
  return rows.map(mapMemoryEntry);
}

export async function saveMemoryEntry(
  request: SaveMemoryEntryRequest,
): Promise<SharedMemoryEntry | undefined> {
  return getDatabase().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.ownerId, getOwnerId()),
          eq(memoryEntries.sourceRunId, request.runId),
          eq(memoryEntries.sourceClaimId, request.claimId),
        ),
      )
      .limit(1);
    if (existing) return mapMemoryEntry(existing);

    const [source] = await tx
      .select({
        id: claims.id,
        statement: claims.statement,
        statementCiphertext: claims.statementCiphertext,
        evidenceState: claims.evidenceState,
      })
      .from(claims)
      .innerJoin(runs, eq(claims.runId, runs.id))
      .where(
        and(
          eq(runs.ownerId, getOwnerId()),
          eq(claims.runId, request.runId),
          eq(claims.reportClaimId, request.claimId),
        ),
      )
      .limit(1);
    if (!source) return undefined;

    const [total] = await tx
      .select({ value: count() })
      .from(memoryEntries)
      .where(eq(memoryEntries.ownerId, getOwnerId()));
    if ((total?.value ?? 0) >= MAX_STORED_MEMORY_ENTRIES) throw new MemoryLimitError();

    const id = randomUUID();
    const content = source.statementCiphertext
      ? decryptText(source.statementCiphertext, `claim:${source.id}:statement`)
      : source.statement;
    const [saved] = await tx
      .insert(memoryEntries)
      .values({
        id,
        ownerId: getOwnerId(),
        sourceRunId: request.runId,
        sourceClaimId: request.claimId,
        sourceType: request.claimId.startsWith("red-team-")
          ? "red-team-challenge"
          : "analyst-claim",
        evidenceState: source.evidenceState,
        contentCiphertext: encryptText(content, `memory-entry:${id}:content`),
      })
      .returning();
    return saved ? mapMemoryEntry(saved) : undefined;
  });
}

export async function deleteMemoryEntry(memoryEntryId: string): Promise<boolean> {
  const deleted = await getDatabase()
    .delete(memoryEntries)
    .where(
      and(
        eq(memoryEntries.ownerId, getOwnerId()),
        eq(memoryEntries.id, memoryEntryId),
      ),
    )
    .returning({ id: memoryEntries.id });
  return deleted.length > 0;
}

export async function loadFrozenMemoryEntries(ids: string[]): Promise<FrozenMemoryEntry[]> {
  if (ids.length === 0) return [];
  if (ids.length > MAX_RUN_MEMORY_ENTRIES) throw new MemorySelectionError();
  const rows = await getDatabase()
    .select()
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.ownerId, getOwnerId()),
        inArray(memoryEntries.id, ids),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, mapMemoryEntry(row)]));
  if (byId.size !== ids.length) throw new MemorySelectionError();
  return ids.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new MemorySelectionError();
    return {
      id: entry.id,
      content: entry.content,
      evidenceState: entry.evidenceState,
      sourceType: entry.sourceType,
    };
  });
}
