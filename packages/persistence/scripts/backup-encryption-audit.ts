import type { Client } from "pg";
import { knowledgeCollectionBodySchema, knowledgeSelectionSchema } from "@deliberation-ai/contracts";
import { decryptText } from "../src/crypto";
import { decodePrivateBranchBody } from "../src/private-branches";
import { decodePrivateBranchDeletion } from "../src/private-branch-deletion";
import { decodeRunDeletion } from "../src/run-deletion";
import { readPreflightDraftDeletion } from "../src/preflight-draft-deletion";
import { decodeLocalScheduleDeletion } from "../src/local-schedule-deletion";
import { decodeCouncilTemplateDeletion } from "../src/council-templates";

type EncryptedField = readonly [column: string, contextSuffix: string, format: "text" | "json"];
interface EncryptedTable {
  table: string;
  keys: readonly string[];
  contextPrefix: string;
  fields: readonly EncryptedField[];
  optional?: boolean;
  metadata?: readonly (readonly [column: string, alias: string])[];
}

// Keep this inventory exhaustive. A new ciphertext column must have an explicit
// authenticated context here before another archive can be published.
const encryptedTables: readonly EncryptedTable[] = [
  { table: "knowledge_collections", keys: ["id"], contextPrefix: "knowledge-collection", fields: [["body_ciphertext", "body", "json"]], optional: true },
  { table: "conversation_knowledge", keys: ["conversation_id", "revision"], contextPrefix: "conversation-knowledge", fields: [["selection_ciphertext", "selection", "json"]], optional: true },
  { table: "run_deletions", keys: ["id"], contextPrefix: "run-deletion", fields: [["audit_ciphertext", "audit", "json"]], optional: true,
    metadata: [["conversation_id", "conversationId"], ["deleted_at", "deletedAt"], ["intent_key_hash", "intentKeyHash"], ["owner_id", "ownerId"]] },
  { table: "private_branch_deletions", keys: ["id"], contextPrefix: "private-branch-deletion", fields: [["audit_ciphertext", "audit", "json"]], optional: true,
    metadata: [["conversation_id", "conversationId"], ["deleted_at", "deletedAt"], ["request_id", "requestId"]] },
  { table: "conversation_private_branches", keys: ["id"], contextPrefix: "private-branch", fields: [["body_ciphertext", "body", "json"]], optional: true,
    metadata: [["conversation_id", "conversationId"], ["source_run_id", "sourceRunId"], ["source_member_id", "sourceMemberId"],
      ["parent_branch_id", "parentBranchId"], ["revision", "revision"], ["message_count", "messageCount"]] },
  { table: "runs", keys: ["id"], contextPrefix: "run", fields: [
    ["question_ciphertext", "question", "text"], ["members_ciphertext", "members", "json"],
    ["memory_context_ciphertext", "memory-context", "json"], ["attachments_ciphertext", "attachments", "json"],
    ["tool_context_ciphertext", "tool-context", "json"], ["report_ciphertext", "report", "json"],
    ["risk_assessment_ciphertext", "risk-assessment", "json"], ["preflight_decision_ciphertext", "preflight-decision", "json"], ["prompt_revision_ciphertext", "prompt-revision", "json"], ["follow_up_ciphertext", "follow-up", "json"],
    ["execution_limits_ciphertext", "execution-limits", "json"],
    ["continuation_context_ciphertext", "continuation-context", "json"],
    ["continuation_archive_ciphertext", "continuation-archive", "json"],
  ] },
  { table: "preflight_drafts", keys: ["id"], contextPrefix: "preflight-draft", fields: [
    ["question_ciphertext", "question", "text"], ["request_ciphertext", "request", "json"],
  ], metadata: [["status", "draftStatus"], ["questions", "draftQuestions"]] },
  { table: "model_runs", keys: ["id"], contextPrefix: "model-run", fields: [
    ["raw_text_ciphertext", "raw", "text"], ["parsed_output_ciphertext", "parsed", "json"],
  ] },
  { table: "claims", keys: ["id"], contextPrefix: "claim", fields: [["statement_ciphertext", "statement", "text"]] },
  { table: "claim_occurrences", keys: ["claim_id", "model_run_id", "quote"], contextPrefix: "occurrence", fields: [
    ["quote_ciphertext", "", "text"],
  ] },
  { table: "provider_connections", keys: ["id"], contextPrefix: "provider-connection", fields: [
    ["secret_ciphertext", "secret", "text"], ["catalog_snapshot_ciphertext", "catalog-snapshot", "json"],
  ] },
  { table: "provider_operations", keys: ["id"], contextPrefix: "provider-operation", fields: [
    ["raw_text_ciphertext", "raw", "text"], ["parsed_output_ciphertext", "parsed", "json"],
    ["result_metadata_ciphertext", "metadata", "json"],
    ["cost_estimate_ciphertext", "cost-estimate", "json"],
  ] },
  { table: "provider_price_snapshots", keys: ["id"], contextPrefix: "provider-price", fields: [["payload_ciphertext", "payload", "json"]] },
  { table: "provider_billing_records", keys: ["id"], contextPrefix: "provider-billing", fields: [["payload_ciphertext", "payload", "json"]] },
  { table: "provider_billing_changes", keys: ["id"], contextPrefix: "provider-billing-change", fields: [["payload_ciphertext", "payload", "json"]] },
  { table: "provider_billing_reallocations", keys: ["id"], contextPrefix: "provider-billing-reallocation", fields: [["payload_ciphertext", "payload", "json"]] },
  { table: "billing_statement_versions", keys: ["id"], contextPrefix: "billing-statement-version", fields: [["payload_ciphertext", "payload", "json"]] },
  { table: "memory_entries", keys: ["id"], contextPrefix: "memory-entry", fields: [["content_ciphertext", "content", "text"]] },
  { table: "evidence_sources", keys: ["id"], contextPrefix: "evidence-source", fields: [
    ["title_ciphertext", "title", "text"], ["url_ciphertext", "url", "text"],
    ["excerpt_ciphertext", "excerpt", "text"], ["note_ciphertext", "note", "text"],
  ] },
  { table: "research_captures", keys: ["id"], contextPrefix: "research-capture", fields: [
    ["requested_url_ciphertext", "requested-url", "text"], ["final_url_ciphertext", "final-url", "text"],
    ["title_ciphertext", "title", "text"], ["content_ciphertext", "content", "text"],
  ] },
  { table: "local_schedules", keys: ["id"], contextPrefix: "local-schedule", fields: [
    ["name_ciphertext", "name", "text"], ["question_ciphertext", "question", "text"],
    ["members_ciphertext", "members", "json"],
    ["execution_limits_ciphertext", "execution-limits", "json"],
    ["deletion_receipt_ciphertext", "deletion-receipt", "json"],
  ], metadata: [["creation_request_id", "scheduleRequestId"], ["deleted_at::text", "scheduleDeletedAt"], ["status", "scheduleStatus"]] },
  { table: "mcp_connections", keys: ["id"], contextPrefix: "mcp-connection", fields: [
    ["label_ciphertext", "label", "text"], ["endpoint_ciphertext", "endpoint", "text"],
  ] },
  { table: "mcp_tool_results", keys: ["id"], contextPrefix: "mcp-tool-result", fields: [
    ["arguments_ciphertext", "arguments", "json"], ["content_ciphertext", "content", "text"],
  ] },
  { table: "council_templates", keys: ["id"], contextPrefix: "council-template", fields: [["members_ciphertext", "members", "json"],
    ["deletion_receipt_ciphertext", "deletion-receipt", "json"]], metadata: [["name", "templateName"], ["description", "templateDescription"],
    ["member_count::text", "templateMemberCount"], ["creation_request_id", "templateRequestId"], ["creation_request_hash", "templateRequestHash"], ["deleted_at::text", "templateDeletedAt"]] },
  { table: "decision_connections", keys: ["id"], contextPrefix: "decision-connection", fields: [["secret_ciphertext", "secret", "text"]] },
  { table: "decision_assessments", keys: ["id"], contextPrefix: "decision-assessment", fields: [
    ["input_ciphertext", "input", "json"], ["result_ciphertext", "result", "json"],
  ] },
  { table: "decision_operations", keys: ["id"], contextPrefix: "decision-operation", fields: [["result_ciphertext", "result", "json"]] },
];

export interface EncryptionAudit {
  rows: number;
  decryptedValues: number;
  populatedTables: number;
}

export async function auditRestoredEncryption(client: Client): Promise<EncryptionAudit> {
  const actual = await client.query<{ table_name: string; column_name: string }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
  );
  // Historical archives may predate the entire private-branch table. An
  // Except for the explicit complete pre-DA107 schedule era below, missing/new ciphertext fields fail closed.
  const tables = await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'");
  const presentTables = new Set(tables.rows.map((row) => row.table_name));
  const knowledgeTables = ["knowledge_collections", "knowledge_grants", "conversation_knowledge", "conversation_knowledge_selections"];
  const knowledgeCount = knowledgeTables.filter((table) => presentTables.has(table)).length;
  if (knowledgeCount !== 0 && knowledgeCount !== knowledgeTables.length) throw new Error("Restored knowledge scope schema is incomplete.");
  if (knowledgeCount === knowledgeTables.length) {
    const invalid = await client.query(`select 1 from knowledge_grants g left join knowledge_collections c on c.id = g.collection_id
      where c.id is null or c.owner_id <> g.owner_id or c.account_id <> 'local' or g.revision < 1 or g.status not in ('active', 'revoked')
      union all select 1 from conversation_knowledge_selections s left join conversation_knowledge h on h.conversation_id = s.conversation_id
      where h.conversation_id is null or h.owner_id <> s.owner_id limit 1`);
    if (invalid.rows.length) throw new Error("Restored knowledge scope relationships are invalid.");
  }
  const scheduleColumns = new Set(actual.rows.filter((row) => row.table_name === "local_schedules").map((row) => row.column_name));
  const added = ["creation_request_id", "creation_request_hash", "deleted_at", "deletion_receipt_ciphertext"].filter((column) => scheduleColumns.has(column));
  if (added.length !== 0 && added.length !== 4) throw new Error("Restored schedule deletion schema is incomplete.");
  const supportedTables = encryptedTables.filter((descriptor) => !descriptor.optional || presentTables.has(descriptor.table)).map((descriptor) =>
    descriptor.table === "local_schedules" && added.length === 0
      ? { ...descriptor, fields: descriptor.fields.filter(([column]) => column !== "deletion_receipt_ciphertext"), metadata: [] } : descriptor);
  const expected = new Set(supportedTables.flatMap(({ table, fields }) => fields.map(([column]) => `${table}.${column}`)));
  const found = new Set(actual.rows.filter(({ column_name }) => column_name.endsWith("_ciphertext")).map(({ table_name, column_name }) => `${table_name}.${column_name}`));
  if (expected.size !== found.size || [...expected].some((column) => !found.has(column))) {
    throw new Error("Restored encrypted-column inventory differs from the backup verifier contract.");
  }

  const audit: EncryptionAudit = { rows: 0, decryptedValues: 0, populatedTables: 0 };
  for (const descriptor of supportedTables) {
    let lastKey: string[] | undefined;
    let tableRows = 0;
    for (;;) {
      const keys = descriptor.keys;
      const columns = [...keys.map((key, index) => `${key}::text AS key_${index}`), ...descriptor.fields.map(([column]) => column),
        ...(descriptor.metadata ?? []).map(([column, alias]) => `${column} AS "${alias}"`)];
      const where = lastKey ? `WHERE (${keys.join(", ")}) > (${keys.map((_, index) => `$${index + 1}`).join(", ")})` : "";
      const page = await client.query<Record<string, string | null>>(
        `SELECT ${columns.join(", ")} FROM public.${descriptor.table} ${where} ORDER BY ${keys.join(", ")} LIMIT 100`,
        lastKey,
      );
      if (page.rows.length === 0) break;
      for (const row of page.rows) {
        const key = keys.map((_, index) => row[`key_${index}`]);
        if (key.some((part) => typeof part !== "string")) throw new Error("Restored encrypted-row key is missing.");
        const contextBase = `${descriptor.contextPrefix}:${key.join(":")}`;
        if (descriptor.table === "council_templates") {
          try { decodeCouncilTemplateDeletion({ id: key[0]!, name: row.templateName!, description: row.templateDescription!, memberCount: Number(row.templateMemberCount),
            creationRequestId: row.templateRequestId ?? null, creationRequestHash: row.templateRequestHash ?? null, deletedAt: row.templateDeletedAt ? new Date(row.templateDeletedAt) : null,
            deletionReceiptCiphertext: row.deletion_receipt_ciphertext ?? null, membersCiphertext: row.members_ciphertext! });
          } catch { throw new Error("Restored council-template deletion metadata is invalid."); }
        }
        if (descriptor.table === "local_schedules" && added.length === 4) {
          try { decodeLocalScheduleDeletion({ id: key[0]!, creationRequestId: row.scheduleRequestId ?? null,
            deletedAt: row.scheduleDeletedAt ? new Date(row.scheduleDeletedAt) : null, status: row.scheduleStatus!,
            deletionReceiptCiphertext: row.deletion_receipt_ciphertext ?? null, nameCiphertext: row.name_ciphertext!,
            questionCiphertext: row.question_ciphertext!, membersCiphertext: row.members_ciphertext!, executionLimitsCiphertext: row.execution_limits_ciphertext ?? null }); }
          catch { throw new Error("Restored schedule deletion receipt is invalid."); }
        }
        if (descriptor.table === "preflight_drafts") {
          try { readPreflightDraftDeletion({ id: key[0]!, status: row.draftStatus!, questions: row.draftQuestions,
            questionCiphertext: row.question_ciphertext ?? null, requestCiphertext: row.request_ciphertext ?? null }); }
          catch { throw new Error("Restored preflight deletion metadata is invalid."); }
        }
        for (const [column, suffix, format] of descriptor.fields) {
          const ciphertext = row[column];
          if (ciphertext === null) continue;
          if (typeof ciphertext !== "string") throw new Error("Restored ciphertext is not text.");
          try {
            const plaintext = decryptText(ciphertext, suffix ? `${contextBase}:${suffix}` : contextBase);
            if (format === "json") JSON.parse(plaintext);
            if (descriptor.table === "knowledge_collections") knowledgeCollectionBodySchema.parse(JSON.parse(plaintext));
            if (descriptor.table === "conversation_knowledge") {
              const selection = knowledgeSelectionSchema.parse(JSON.parse(plaintext));
              const head = await client.query<{ owner_id: string; conversation_owner: string }>(`select h.owner_id, c.owner_id as conversation_owner
                from conversation_knowledge h join conversations c on c.id = h.conversation_id where h.conversation_id = $1`, [key[0]]);
              const rows = await client.query<{ collection_id: string; grant_id: string; grant_revision: number; owner_id: string;
                collection_owner: string; account_id: string; grant_owner: string; grant_collection: string; current_revision: number }>(
                `select s.*, c.owner_id as collection_owner, c.account_id, g.owner_id as grant_owner, g.collection_id as grant_collection, g.revision as current_revision
                 from conversation_knowledge_selections s join knowledge_collections c on c.id = s.collection_id join knowledge_grants g on g.id = s.grant_id
                 where s.conversation_id = $1 limit 4`, [key[0]]);
              const owner = head.rows[0]?.owner_id;
              if (!owner || owner !== head.rows[0]?.conversation_owner || rows.rows.length !== selection.scopes.length
                || selection.scopes.some((scope) => scope.ownerId !== owner || !rows.rows.some((row) => row.collection_id === scope.collectionId
                  && row.grant_id === scope.grantId && row.grant_revision === scope.grantRevision && row.owner_id === owner
                  && row.collection_owner === owner && row.grant_owner === owner && row.account_id === scope.accountId
                  && row.grant_collection === scope.collectionId && row.current_revision >= scope.grantRevision))) throw new Error("Invalid knowledge selection metadata.");
            }
            if (descriptor.table === "run_deletions") decodeRunDeletion({ id: key[0]!, conversationId: row.conversationId!,
              ownerId: row.ownerId!, intentKeyHash: row.intentKeyHash!, deletedAt: new Date(row.deletedAt!), auditCiphertext: ciphertext });
            if (descriptor.table === "private_branch_deletions") decodePrivateBranchDeletion({ id: key[0]!, conversationId: row.conversationId!,
              requestId: row.requestId!, deletedAt: new Date(row.deletedAt!), auditCiphertext: ciphertext });
            if (descriptor.table === "conversation_private_branches") decodePrivateBranchBody({
              id: key[0]!, conversationId: row.conversationId!, sourceRunId: row.sourceRunId!, sourceMemberId: row.sourceMemberId!,
              parentBranchId: row.parentBranchId ?? null, revision: Number(row.revision), messageCount: Number(row.messageCount), bodyCiphertext: ciphertext,
            });
          } catch {
            // Do not print ciphertext, plaintext, credentials, or row identifiers.
            throw new Error(`Restored encryption audit failed at ${descriptor.table}.${column}, row ${tableRows + 1}.`);
          }
          audit.decryptedValues += 1;
        }
        tableRows += 1;
        audit.rows += 1;
      }
      lastKey = keys.map((_, index) => page.rows.at(-1)?.[`key_${index}`] ?? "");
      if (page.rows.length < 100) break;
    }
    if (tableRows > 0) audit.populatedTables += 1;
  }
  return audit;
}
