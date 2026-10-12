import { createHash } from "node:crypto";
import { councilMembersSchema, councilTemplateContentSchema, createRunRequestSchema, type CouncilMemberConfig } from "@deliberation-ai/contracts";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { decryptJson, decryptText } from "./crypto";
import { getOwnerId } from "./owner";
import { councilTemplates, runs, conversationRuns, localSchedules, preflightDrafts, conversationPrivateBranches, providerOperations, providerConnections, providerPriceSnapshots, providerBillingRecords, billingStatementVersions } from "./schema";
import { hydrateProviderBilling } from "./provider-billing";
import { hydrateStatementVersion } from "./billing-statement-history";
import { decodePrivateBranchBody, privateDeliveryPending } from "./private-branches";
import { readProviderObservations } from "./provider-observations";
import type { ConversationTransaction } from "./conversation-membership";

export type ConnectionImpact = { connectionId: string; label: string; action: "update" | "delete"; removedModels: string[];
  transportChanged: boolean; references: { kind: string; id: string; label: string; models: string[]; status: string; blocking: boolean }[];
  blockedReasons: string[]; eligible: boolean; fingerprint: string };
export class ProviderConnectionImpactError extends Error {
  constructor(readonly impact: ConnectionImpact) { super(impact.eligible ? "Bu değişiklik bağlı kayıtları etkiliyor. Bağımlılıkları inceleyip onaylayın." : "Devam eden veya sonucu belirsiz işlemler nedeniyle bu değişiklik engellendi."); }
}
export class ProviderMemberUnavailableError extends Error {
  constructor() { super("Konseydeki bağlantı veya model artık kullanılabilir seçimler arasında değil. Konseyler menüsünden bağlantı ve model seçimlerini güncelleyip kaydedin."); }
}
export async function lockProviderBindings(tx: ConversationTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${getOwnerId()}), hashtext('provider-bindings-v1'))`);
}
export async function assertSelectedProviderMembers(tx: ConversationTransaction, members: CouncilMemberConfig[]) {
  await lockProviderBindings(tx);
  const ids = [...new Set(members.flatMap(member => member.provider !== "fake" && member.connectionId ? [member.connectionId] : []))];
  const rows = ids.length ? await tx.select().from(providerConnections).where(and(eq(providerConnections.ownerId, getOwnerId()), inArray(providerConnections.id, ids))).for("share") : [];
  for (const member of members) {
    if (member.provider === "fake" || !member.connectionId) continue; // Legacy environment-backed configurations have no local binding.
    const connection = rows.find(row => row.id === member.connectionId?.toLowerCase());
    if (!connection || connection.provider !== member.provider || !(connection.selectedModels ?? (connection.defaultModel ? [connection.defaultModel] : [])).includes(member.model)) throw new ProviderMemberUnavailableError();
  }
  return rows;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Owner-local, bounded reads; content is decrypted solely to inspect member bindings. Never return prompts/replies. */
export async function inspectConnectionImpact(tx: ConversationTransaction, row: typeof providerConnections.$inferSelect,
  next: { selectedModels: string[]; transportChanged: boolean; targetDigest: string } | null): Promise<ConnectionImpact> {
  const selected = row.selectedModels ?? (row.defaultModel ? [row.defaultModel] : []);
  const removedModels = next ? selected.filter(model => !next.selectedModels.includes(model)) : selected;
  const all = next === null || next.transportChanged;
  const impact: ConnectionImpact = { connectionId: row.id, label: row.label, action: next ? "update" : "delete", removedModels,
    transportChanged: next?.transportChanged ?? true, references: [], blockedReasons: [], eligible: true, fingerprint: "" };
  const evidence: unknown[] = [];
  const add = (kind: string, id: string, label: string, members: CouncilMemberConfig[], status: string, blocking: boolean, digest: unknown) => {
    const matches = members.filter(member => member.connectionId?.toLowerCase() === row.id);
    if (!matches.length) return;
    const affected = matches.some(member => all || removedModels.includes(member.model));
    impact.references.push({ kind, id, label, models: [...new Set(matches.map(member => member.model))], status, blocking: affected && blocking });
    evidence.push({ kind, id, status, affected, digest: hash(digest) });
  };
  try {
    // Aggregate byte/count bounds before transferring/decrypting any potentially large payload.
    const tables = [councilTemplates, runs, localSchedules, preflightDrafts, conversationPrivateBranches, providerBillingRecords, billingStatementVersions] as const;
    const columns = [councilTemplates.membersCiphertext, runs.membersCiphertext, localSchedules.membersCiphertext, preflightDrafts.requestCiphertext, conversationPrivateBranches.bodyCiphertext, providerBillingRecords.payloadCiphertext, billingStatementVersions.payloadCiphertext] as const;
    for (let index = 0; index < tables.length; index++) {
      const table = tables[index]!;
      const result = await tx.execute<{ count: string; bytes: string }>(sql`select count(*)::text as count, coalesce(sum(octet_length(${columns[index]!})),0)::text as bytes from ${table} where ${table.ownerId}=${getOwnerId()}`);
      if (Number(result.rows[0]?.count) > 1000 || Number(result.rows[0]?.bytes) > 16_777_216) throw new Error("Impact inspection bounds exceeded");
    }
    const templates = await tx.select().from(councilTemplates).where(and(eq(councilTemplates.ownerId, getOwnerId()), isNull(councilTemplates.deletedAt)));
    for (const template of templates) {
      const content = councilTemplateContentSchema.parse(decryptJson(template.membersCiphertext, `council-template:${template.id}:members`));
      add("Konsey Şablonu", template.id, template.name, Array.isArray(content) ? content : content.members, "Kayıtlı", false, template.membersCiphertext);
    }
    const runRows = await tx.select({ id: runs.id, membersCiphertext: runs.membersCiphertext, status: runs.status, updatedAt: runs.updatedAt }).from(runs).where(eq(runs.ownerId, getOwnerId()));
    const memberships = await tx.select({ runId: conversationRuns.runId, conversationId: conversationRuns.conversationId }).from(conversationRuns).where(eq(conversationRuns.ownerId, getOwnerId())).limit(1001);
    if (memberships.length > 1000) throw new Error("Membership bounds exceeded");
    const affectedRunMembers = new Map<string, string[]>();
    for (const run of runRows) {
      if (!run.membersCiphertext) continue;
      const members = councilMembersSchema.parse(decryptJson(run.membersCiphertext, `run:${run.id}:members`));
      const matches = members.filter(member => member.connectionId?.toLowerCase() === row.id && (all || removedModels.includes(member.model)));
      if (matches.length) affectedRunMembers.set(run.id, matches.map(member => member.id));
      const conversation = memberships.find(item => item.runId === run.id);
      add("Müzakere Çalışması", run.id, conversation ? `Müzakere ${conversation.conversationId.slice(0, 8)} · çalışma ${run.id.slice(0, 8)}` : `Çalışma ${run.id.slice(0, 8)}`, members, run.status, ["queued", "running"].includes(run.status), [run.membersCiphertext, run.updatedAt]);
    }
    const pendingOps = await tx.select({ id: providerOperations.id, runId: providerOperations.runId, memberId: providerOperations.memberId, model: providerOperations.model, status: providerOperations.status }).from(providerOperations).innerJoin(runs, eq(runs.id, providerOperations.runId))
      .where(and(eq(runs.ownerId, getOwnerId()), inArray(providerOperations.status, ["prepared", "submitted", "outcome_unknown", "retry_authorized"]),
        sql`not (${providerOperations.status}='retry_authorized' and exists(select 1 from provider_operations newer where newer.run_id=${providerOperations.runId} and newer.member_id=${providerOperations.memberId} and newer.round=${providerOperations.round} and newer.attempt>${providerOperations.attempt}))`)).limit(1001);
    if (pendingOps.length > 1000) throw new Error("Operation bounds exceeded");
    for (const operation of pendingOps) if (affectedRunMembers.get(operation.runId)?.includes(operation.memberId)) {
      impact.references.push({ kind: "Sağlayıcı İşlemi", id: operation.id, label: `İşlem ${operation.id.slice(0, 8)}`, models: [operation.model], status: operation.status, blocking: true }); evidence.push(operation);
    }
    for (const schedule of await tx.select().from(localSchedules).where(and(eq(localSchedules.ownerId, getOwnerId()), isNull(localSchedules.deletedAt)))) {
      add("Zamanlayıcı", schedule.id, decryptText(schedule.nameCiphertext, `local-schedule:${schedule.id}:name`), councilMembersSchema.parse(decryptJson(schedule.membersCiphertext, `local-schedule:${schedule.id}:members`)), schedule.status, schedule.status === "active", [schedule.membersCiphertext, schedule.status]);
    }
    for (const draft of await tx.select({ id: preflightDrafts.id, requestCiphertext: preflightDrafts.requestCiphertext }).from(preflightDrafts).where(and(eq(preflightDrafts.ownerId, getOwnerId()), eq(preflightDrafts.status, "awaiting_input")))) {
      if (!draft.requestCiphertext) throw new Error("Unreadable draft");
      const request = createRunRequestSchema.parse(decryptJson(draft.requestCiphertext, `preflight-draft:${draft.id}:request`));
      add("Bekleyen Soru", draft.id, `Ön değerlendirme ${draft.id.slice(0, 8)}`, request.members ?? [], "Başlatılmadı", false, draft.requestCiphertext);
    }
    for (const branch of await tx.select({ id: conversationPrivateBranches.id, conversationId: conversationPrivateBranches.conversationId, sourceRunId: conversationPrivateBranches.sourceRunId, sourceMemberId: conversationPrivateBranches.sourceMemberId, parentBranchId: conversationPrivateBranches.parentBranchId, revision: conversationPrivateBranches.revision, messageCount: conversationPrivateBranches.messageCount, bodyCiphertext: conversationPrivateBranches.bodyCiphertext }).from(conversationPrivateBranches).where(eq(conversationPrivateBranches.ownerId, getOwnerId()))) {
      const body = decodePrivateBranchBody(branch);
      add("Özel Müzakere", branch.id, `Özel dal ${branch.id.slice(0, 8)}`, [body.seed.member], privateDeliveryPending(body) ? "Gönderim bekliyor" : "Kayıtlı", privateDeliveryPending(body), branch.bodyCiphertext);
    }
    for (const check of readProviderObservations(row).generationChecks) if (["submitted", "outcome_unknown"].includes(check.status) && !check.acknowledgedAt && (all || removedModels.includes(check.model))) {
      impact.references.push({ kind: "Bağlantı Testi", id: check.id, label: `Test ${check.id.slice(0, 8)}`, models: [check.model], status: check.status, blocking: true }); evidence.push(check);
    }
    const prices = await tx.select({ id: providerPriceSnapshots.id, model: providerPriceSnapshots.model, revision: providerPriceSnapshots.connectionRevision }).from(providerPriceSnapshots).where(and(eq(providerPriceSnapshots.ownerId, getOwnerId()), eq(providerPriceSnapshots.connectionId, row.id))).limit(1001);
    if (prices.length > 1000) throw new Error("Price bounds exceeded");
    for (const price of prices) { impact.references.push({ kind: "Fiyat Kaydı", id: price.id, label: `Fiyat ${price.id.slice(0, 8)}`, models: [price.model], status: "Tarihsel kayıt korunur", blocking: false }); evidence.push(price); }
    for (const billing of await tx.select().from(providerBillingRecords).where(eq(providerBillingRecords.ownerId, getOwnerId()))) {
      const record = hydrateProviderBilling(billing);
      if (record.connectionId === row.id) { impact.references.push({ kind: "Fatura Kaydı", id: billing.id, label: `Fatura ${billing.id.slice(0, 8)}`, models: [record.model], status: "Tarihsel kayıt korunur", blocking: false }); evidence.push(billing.fingerprint); }
    }
    for (const statement of await tx.select().from(billingStatementVersions).where(eq(billingStatementVersions.ownerId, getOwnerId()))) {
      const record = hydrateStatementVersion(statement);
      if (record.input.connectionId === row.id) { impact.references.push({ kind: "Ekstre Kaydı", id: statement.id, label: `Ekstre ${statement.id.slice(0, 8)} · sürüm ${statement.sequence}`, models: [], status: "Tarihsel kayıt korunur", blocking: false }); evidence.push(statement.fingerprint); }
    }
  } catch { impact.blockedReasons.push("Bağımlılıkların tamamı güvenilir biçimde okunamadı; değişiklik yapılmadı."); }
  if (impact.references.some(reference => reference.blocking)) impact.blockedReasons.push("Devam eden çalışmaları bitirin, etkin zamanlayıcıları duraklatın ve sonucu belirsiz işlemleri değerlendirin.");
  impact.eligible = !impact.blockedReasons.length;
  impact.references.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  impact.fingerprint = hash({ owner: getOwnerId(), id: row.id, revision: row.revision, selected, next, evidence: evidence.map(item => hash(item)).sort(), blocked: impact.blockedReasons });
  return impact;
}
export function assertConnectionImpact(impact: ConnectionImpact, fingerprint?: string) {
  const affected = impact.transportChanged || impact.removedModels.length > 0;
  if (!impact.eligible || affected && impact.references.length > 0 && fingerprint !== impact.fingerprint) throw new ProviderConnectionImpactError(impact);
}
