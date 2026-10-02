import { randomUUID } from "node:crypto";
import { billingStatementChangeSchema, billingStatementInspectionSchema, type BillingStatementChangeInput, type BillingStatementVersion } from "@deliberation-ai/contracts";
import { foldStatementVersions, validateStatementChange } from "@deliberation-ai/domain";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { decryptJson, encryptJson } from "./crypto";
import { getDatabase } from "./database";
import { inspectStatementInSnapshot } from "./billing-statement";
import { LOCAL_OWNER_ID } from "./owner";
import { pricingFingerprint } from "./provider-pricing";
import { billingStatementVersions } from "./schema";

type Reader = Pick<ReturnType<typeof getDatabase>, "select">;
export function statementIdentity(input: Pick<BillingStatementChangeInput, "connectionId" | "statementId">): string {
  return pricingFingerprint({ connectionId: input.connectionId, statementId: input.statementId });
}
export function hydrateStatementVersion(row: typeof billingStatementVersions.$inferSelect): BillingStatementVersion {
  const payload = decryptJson<{ input: unknown; inspection: unknown }>(row.payloadCiphertext, `billing-statement-version:${row.id}:payload`);
  const input = billingStatementChangeSchema.parse(payload.input);
  const inspection = payload.inspection === null ? null : billingStatementInspectionSchema.parse(payload.inspection);
  if (statementIdentity(input) !== row.identityFingerprint || pricingFingerprint(input) !== row.requestFingerprint
    || pricingFingerprint({ input, inspection, sequence: row.sequence }) !== row.fingerprint
    || (input.action === "record" && inspection?.packetFingerprint !== pricingFingerprint(input.packet))) throw new Error("Statement version integrity check failed.");
  return { id: row.id, input, inspection, sequence: row.sequence, fingerprint: row.fingerprint, recordedAt: row.recordedAt.toISOString() };
}
async function readVersions(identity: string, db: Reader): Promise<BillingStatementVersion[]> {
  const rows = await db.select().from(billingStatementVersions).where(and(eq(billingStatementVersions.ownerId, LOCAL_OWNER_ID),
    eq(billingStatementVersions.identityFingerprint, identity))).orderBy(asc(billingStatementVersions.sequence));
  const versions = rows.map(hydrateStatementVersion);
  if (versions.length) foldStatementVersions(versions);
  return versions;
}
async function prepare(input: BillingStatementChangeInput, evidenceSha256: string, db: Reader) {
  validateStatementChange(input);
  if (input.documentSha256 !== evidenceSha256 || Date.parse(input.reviewedAt) > Date.now()) throw new Error("Statement evidence/review is invalid.");
  const versions = await readVersions(statementIdentity(input), db);
  const duplicate = versions.find((version) => pricingFingerprint(version.input) === pricingFingerprint(input));
  if (duplicate) return { input, sequence: duplicate.sequence, duplicate, inspection: duplicate.inspection };
  const previous = versions.at(-1);
  if (input.expectedFingerprint !== (previous?.fingerprint ?? null)) throw new Error("Statement revision is stale; review the current version first.");
  if (previous && Date.parse(input.reviewedAt) < Date.parse(previous.input.reviewedAt)) throw new Error("Statement reviews must be chronological.");
  if (!previous && input.action === "void") throw new Error("Statement must be recorded before withdrawal.");
  if (versions.length >= 100) throw new Error("Statement history limit is 100 versions.");
  const inspection = input.action === "record" ? billingStatementInspectionSchema.parse(await inspectStatementInSnapshot(input.packet, evidenceSha256, db)) : null;
  if (inspection && inspection.status !== "reconciled_owner_packet") throw new Error("Statement packet is incomplete; inspect and resolve its issues first.");
  return { input, sequence: versions.length + 1, duplicate: null, inspection };
}
export async function previewStatementVersion(value: BillingStatementChangeInput, evidenceSha256: string) {
  const input = billingStatementChangeSchema.parse(value);
  return getDatabase().transaction((tx) => prepare(input, evidenceSha256, tx), { isolationLevel: "repeatable read", accessMode: "read only" });
}
function retryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const wrapped = error as { code?: string; cause?: unknown };
  return ["40001", "23505"].includes(wrapped.code ?? "") || (!!wrapped.cause && wrapped.cause !== error && retryable(wrapped.cause));
}
export async function recordStatementVersion(value: BillingStatementChangeInput, evidenceSha256: string): Promise<BillingStatementVersion> {
  const input = billingStatementChangeSchema.parse(value);
  // Waiting for an advisory lock can leave a repeatable-read snapshot older than the preceding commit.
  // Unique sequence/request guards reject that snapshot; retry the entire transaction, never a partial append.
  for (let attempt = 0; ; attempt++) {
    try {
      return await getDatabase().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`statement-ledger:${LOCAL_OWNER_ID}:${statementIdentity(input)}`}, 0))`);
        const checked = await prepare(input, evidenceSha256, tx);
        if (checked.duplicate) return checked.duplicate;
        const id = randomUUID(); const inspection = checked.inspection;
        const [row] = await tx.insert(billingStatementVersions).values({ id, ownerId: LOCAL_OWNER_ID, identityFingerprint: statementIdentity(input),
          sequence: checked.sequence, requestFingerprint: pricingFingerprint(input), fingerprint: pricingFingerprint({ input, inspection, sequence: checked.sequence }),
          payloadCiphertext: encryptJson({ input, inspection }, `billing-statement-version:${id}:payload`) }).returning();
        return hydrateStatementVersion(row!);
      }, { isolationLevel: "repeatable read" });
    } catch (error) { if (attempt >= 2 || !retryable(error)) throw error; }
  }
}
export async function getStatementHistory(id: string) {
  return getDatabase().transaction((tx) => getStatementHistoryInSnapshot(id, tx), { isolationLevel: "repeatable read", accessMode: "read only" });
}
/** Caller owns the repeatable-read snapshot used for all live ledger checks. */
export async function getStatementHistoryInSnapshot(id: string, tx: Reader) {
    const [row] = await tx.select().from(billingStatementVersions).where(and(eq(billingStatementVersions.id, id), eq(billingStatementVersions.ownerId, LOCAL_OWNER_ID))).limit(1);
    if (!row) return undefined;
    const state = foldStatementVersions(await readVersions(row.identityFingerprint, tx));
    if (!state.packet || !state.effective) return { ...state, freshness: "voided" as const, liveInspection: null };
    try {
      const liveInspection = await inspectStatementInSnapshot(state.packet, state.packet.documentSha256, tx);
      const current = liveInspection.ledgerFingerprint === state.effective.ledgerFingerprint && liveInspection.status === "reconciled_owner_packet"
        && JSON.stringify(liveInspection.receiptChecks) === JSON.stringify(state.effective.receiptChecks);
      return { ...state, freshness: current ? "current" as const : "ledger_changed" as const, liveInspection };
    } catch {
      // Historical bytes are retained, but an unreadable live ledger cannot certify freshness.
      return { ...state, freshness: "inspection_unavailable" as const, liveInspection: null };
    }
}
export async function listStatementHeads() {
  return getDatabase().transaction(async (tx) => {
    const latest = tx.selectDistinctOn([billingStatementVersions.identityFingerprint]).from(billingStatementVersions)
      .where(eq(billingStatementVersions.ownerId, LOCAL_OWNER_ID)).orderBy(billingStatementVersions.identityFingerprint, desc(billingStatementVersions.sequence)).as("latest");
    const heads = await tx.select().from(latest).orderBy(desc(latest.recordedAt), desc(latest.id)).limit(100);
    const result = [];
    for (const head of heads) {
      const state = foldStatementVersions(await readVersions(head.identityFingerprint, tx));
      result.push({ id: state.head.id, connectionId: state.head.input.connectionId, statementId: state.head.input.statementId,
        currentFingerprint: state.head.fingerprint, sequence: state.head.sequence, status: state.status, recordedAt: state.head.recordedAt,
        freshness: "not_checked" as const, providerAuthenticity: "unverified" as const, paymentStatus: "unknown" as const });
    }
    return result;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
