import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  anchorRunId: uuid("anchor_run_id").notNull(),
  origin: text("origin").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("conversations_owner_anchor_uq").on(table.ownerId, table.anchorRunId),
  check("conversations_origin_valid", sql`${table.origin} in ('native', 'legacy-reconstructed')`),
]);

// Membership metadata survives run retention. It retains no question or output.
export const conversationRuns = pgTable("conversation_runs", {
  ownerId: text("owner_id").notNull(),
  runId: uuid("run_id").notNull(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id),
  sourceRunId: uuid("source_run_id"),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.runId] }),
  index("conversation_runs_owner_conversation_created_idx").on(table.ownerId, table.conversationId, table.createdAt, table.runId),
  check("conversation_runs_kind_valid", sql`(${table.kind} = 'independent' and ${table.sourceRunId} is null) or
    (${table.kind} in ('continuation-full', 'continuation-compacted', 'member-rerun') and ${table.sourceRunId} is not null and ${table.sourceRunId} <> ${table.runId})`),
]);

// No run or parent cascade: frozen seed/messages survive source retention.
export const conversationPrivateBranches = pgTable("conversation_private_branches", {
  id: uuid("id").primaryKey().defaultRandom(), ownerId: text("owner_id").notNull(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id),
  sourceRunId: uuid("source_run_id").notNull(), sourceMemberId: text("source_member_id").notNull(),
  parentBranchId: uuid("parent_branch_id"), requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(),
  revision: integer("revision").notNull().default(1), messageCount: integer("message_count").notNull().default(0),
  bodyCiphertext: text("body_ciphertext").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("private_branches_owner_request_uq").on(table.ownerId, table.requestId),
  index("private_branches_owner_conversation_created_idx").on(table.ownerId, table.conversationId, table.createdAt, table.id),
  check("private_branches_bounds", sql`${table.revision} between 1 and 65 and ${table.messageCount} between 0 and 64`),
  check("private_branches_parent_valid", sql`${table.parentBranchId} is null or ${table.parentBranchId} <> ${table.id}`),
]);

// Content-free deletion/usage evidence survives branch and conversation removal.
// Logical identities only: no cascade or foreign key to deleted content.
export const privateBranchDeletions = pgTable("private_branch_deletions", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), conversationId: uuid("conversation_id").notNull(),
  requestId: uuid("request_id").notNull(),
  auditCiphertext: text("audit_ciphertext").notNull(), deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
}, (table) => [index("private_branch_deletions_owner_conversation_idx").on(table.ownerId, table.conversationId, table.id),
  uniqueIndex("private_branch_deletions_owner_request_uq").on(table.ownerId, table.requestId)]);

// Content-free usage and intent evidence survives reviewed run-body removal.
export const runDeletions = pgTable("run_deletions", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), conversationId: uuid("conversation_id").notNull(),
  intentKeyHash: text("intent_key_hash").notNull(), auditCiphertext: text("audit_ciphertext").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("run_deletions_owner_intent_uq").on(table.ownerId, table.intentKeyHash),
  index("run_deletions_owner_conversation_idx").on(table.ownerId, table.conversationId, table.id)]);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    question: text("question").notNull(),
    questionCiphertext: text("question_ciphertext"),
    scenario: text("scenario").notNull().default("success"),
    providerMode: text("provider_mode").notNull().default("fake"),
    riskProfile: text("risk_profile").notNull().default("standard"),
    riskAssessmentCiphertext: text("risk_assessment_ciphertext"),
    preflightDecisionCiphertext: text("preflight_decision_ciphertext"),
    promptRevisionCiphertext: text("prompt_revision_ciphertext"),
    followUpCiphertext: text("follow_up_ciphertext"),
    continuationContextCiphertext: text("continuation_context_ciphertext"),
    continuationArchiveCiphertext: text("continuation_archive_ciphertext"),
    branchSourceRunId: uuid("branch_source_run_id"),
    branchKind: text("branch_kind"),
    branchIndexVersion: integer("branch_index_version").notNull().default(0),
    executionLimitsCiphertext: text("execution_limits_ciphertext"),
    promptVersion: text("prompt_version").notNull().default("council-v1"),
    promptFingerprint: text("prompt_fingerprint"),
    reviewRounds: integer("review_rounds").notNull().default(0),
    selfRevisionEnabled: boolean("self_revision_enabled").notNull().default(false),
    membersCiphertext: text("members_ciphertext"),
    memberCount: integer("member_count").notNull().default(2),
    memoryContextCiphertext: text("memory_context_ciphertext"),
    memoryEntryCount: integer("memory_entry_count").notNull().default(0),
    attachmentsCiphertext: text("attachments_ciphertext"),
    attachmentCount: integer("attachment_count").notNull().default(0),
    toolContextCiphertext: text("tool_context_ciphertext"),
    toolResultCount: integer("tool_result_count").notNull().default(0),
    snapshotId: uuid("snapshot_id").notNull(),
    queueJobId: text("queue_job_id"),
    status: runStatus("status").notNull().default("queued"),
    report: jsonb("report"),
    reportCiphertext: text("report_ciphertext"),
    stateVersion: integer("state_version").notNull().default(1),
    lastSequence: integer("last_sequence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("runs_owner_idempotency_key_uq").on(table.ownerId, table.idempotencyKey),
    index("runs_owner_created_id_idx").on(table.ownerId, table.createdAt, table.id),
    index("runs_owner_branch_source_created_id_idx").on(table.ownerId, table.branchSourceRunId, table.createdAt, table.id),
    check("runs_branch_index_valid", sql`(${table.branchIndexVersion} = 0 and ${table.branchKind} is null and ${table.branchSourceRunId} is null) or
      (${table.branchIndexVersion} = 1 and ${table.branchKind} is not null and (
        (${table.branchKind} = 'independent' and ${table.branchSourceRunId} is null) or
        (${table.branchKind} in ('continuation-full', 'continuation-compacted', 'member-rerun') and ${table.branchSourceRunId} is not null and ${table.branchSourceRunId} <> ${table.id})))`),
    check("runs_state_version_positive", sql`${table.stateVersion} > 0`),
    check("runs_last_sequence_nonnegative", sql`${table.lastSequence} >= 0`),
    check("runs_member_count_range", sql`${table.memberCount} between 2 and 6`),
    check("runs_risk_profile_valid", sql`${table.riskProfile} in ('standard', 'high')`),
    check("runs_memory_entry_count_range", sql`${table.memoryEntryCount} between 0 and 5`),
    check("runs_attachment_count_range", sql`${table.attachmentCount} between 0 and 6`),
    check("runs_tool_result_count_range", sql`${table.toolResultCount} between 0 and 3`),
    check("runs_review_rounds_valid", sql`${table.reviewRounds} between 0 and 3`),
  ],
);

export const preflightDrafts = pgTable("preflight_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  questionCiphertext: text("question_ciphertext"),
  requestCiphertext: text("request_ciphertext"),
  questions: jsonb("questions").notNull(),
  status: text("status").notNull().default("awaiting_input"),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("preflight_drafts_owner_key_uq").on(table.ownerId, table.idempotencyKey),
  index("preflight_drafts_owner_status_created_idx").on(table.ownerId, table.status, table.createdAt),
  check("preflight_drafts_status_valid", sql`${table.status} in ('awaiting_input', 'started', 'cancelled')`),
]);

export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    labelCiphertext: text("label_ciphertext").notNull(),
    endpointCiphertext: text("endpoint_ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("mcp_connections_owner_created_idx").on(table.ownerId, table.createdAt)],
);

export const mcpToolResults = pgTable(
  "mcp_tool_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    connectionId: uuid("connection_id").notNull().references(() => mcpConnections.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    argumentsCiphertext: text("arguments_ciphertext").notNull(),
    contentCiphertext: text("content_ciphertext").notNull(),
    contentSha256: text("content_sha256").notNull(),
    isError: boolean("is_error").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("mcp_tool_results_owner_created_idx").on(table.ownerId, table.createdAt)],
);

export const localSchedules = pgTable(
  "local_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creationRequestId: uuid("creation_request_id"),
    creationRequestHash: text("creation_request_hash"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletionReceiptCiphertext: text("deletion_receipt_ciphertext"),
    ownerId: text("owner_id").notNull(),
    nameCiphertext: text("name_ciphertext").notNull(),
    questionCiphertext: text("question_ciphertext").notNull(),
    membersCiphertext: text("members_ciphertext").notNull(),
    providerMode: text("provider_mode").notNull(),
    riskProfile: text("risk_profile").notNull().default("standard"),
    reviewRounds: integer("review_rounds").notNull().default(1),
    selfRevisionEnabled: boolean("self_revision_enabled").notNull().default(false),
    executionLimitsCiphertext: text("execution_limits_ciphertext"),
    cadence: text("cadence").notNull(),
    status: text("status").notNull().default("paused"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastRunId: uuid("last_run_id").references(() => runs.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("local_schedules_owner_next_idx").on(table.ownerId, table.status, table.nextRunAt),
    uniqueIndex("local_schedules_owner_request_uq").on(table.ownerId, table.creationRequestId),
    check("local_schedules_deletion_valid", sql`(${table.deletedAt} is null and ${table.deletionReceiptCiphertext} is null) or (${table.deletedAt} is not null and ${table.deletionReceiptCiphertext} is not null and ${table.status} = 'paused')`),
    check("local_schedules_provider_mode_valid", sql`${table.providerMode} in ('fake', 'remote')`),
    check("local_schedules_risk_profile_valid", sql`${table.riskProfile} in ('standard', 'high')`),
    check("local_schedules_review_rounds_valid", sql`${table.reviewRounds} between 0 and 3`),
    check("local_schedules_cadence_valid", sql`${table.cadence} in ('daily', 'weekly')`),
    check("local_schedules_status_valid", sql`${table.status} in ('active', 'paused')`),
  ],
);

export const modelRuns = pgTable(
  "model_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    memberId: text("member_id").notNull(),
    memberLabel: text("member_label").notNull(),
    councilRole: text("council_role").notNull().default("analyst"),
    round: integer("round").notNull().default(0),
    rawText: text("raw_text"),
    rawTextCiphertext: text("raw_text_ciphertext"),
    parsedOutput: jsonb("parsed_output"),
    parsedOutputCiphertext: text("parsed_output_ciphertext"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("model_runs_run_member_round_uq").on(table.runId, table.memberId, table.round),
    check("model_runs_round_range", sql`${table.round} between 0 and 3`),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    statementCiphertext: text("statement_ciphertext"),
    disposition: text("disposition").notNull(),
    reportClaimId: text("report_claim_id"),
    evidenceState: text("evidence_state").notNull().default("unsupported"),
    synthesisCoverage: text("synthesis_coverage").notNull().default("unresolved"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("claims_run_idx").on(table.runId),
    uniqueIndex("claims_run_report_claim_uq").on(table.runId, table.reportClaimId),
    check(
      "claims_evidence_state_valid",
      sql`${table.evidenceState} in ('unsupported', 'model-supported', 'externally-verified', 'contradicted', 'stale')`,
    ),
    check(
      "claims_synthesis_coverage_valid",
      sql`${table.synthesisCoverage} in ('included', 'omitted', 'unresolved')`,
    ),
  ],
);

export const claimOccurrences = pgTable(
  "claim_occurrences",
  {
    claimId: uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    modelRunId: uuid("model_run_id").notNull().references(() => modelRuns.id, { onDelete: "cascade" }),
    quote: text("quote").notNull(),
    quoteCiphertext: text("quote_ciphertext"),
    kind: text("kind").notNull(),
  },
  (table) => [primaryKey({ columns: [table.claimId, table.modelRunId, table.quote] })],
);

export const memoryEntries = pgTable(
  "memory_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    sourceRunId: uuid("source_run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    sourceClaimId: text("source_claim_id").notNull(),
    sourceType: text("source_type").notNull(),
    evidenceState: text("evidence_state").notNull(),
    contentCiphertext: text("content_ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memory_entries_owner_source_uq").on(
      table.ownerId,
      table.sourceRunId,
      table.sourceClaimId,
    ),
    index("memory_entries_owner_created_idx").on(table.ownerId, table.createdAt),
    check(
      "memory_entries_source_type_valid",
      sql`${table.sourceType} in ('analyst-claim', 'red-team-challenge')`,
    ),
    check(
      "memory_entries_evidence_state_valid",
      sql`${table.evidenceState} in ('unsupported', 'model-supported', 'externally-verified', 'contradicted', 'stale')`,
    ),
  ],
);

export const evidenceSources = pgTable(
  "evidence_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    reportClaimId: text("report_claim_id").notNull(),
    relation: text("relation").notNull(),
    reviewStatus: text("review_status").notNull().default("unreviewed"),
    titleCiphertext: text("title_ciphertext").notNull(),
    urlCiphertext: text("url_ciphertext").notNull(),
    excerptCiphertext: text("excerpt_ciphertext"),
    noteCiphertext: text("note_ciphertext").notNull(),
    publishedAt: date("published_at"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    freshnessStatus: text("freshness_status").notNull().default("unreviewed"),
    freshnessReviewedAt: timestamp("freshness_reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("evidence_sources_run_claim_idx").on(table.runId, table.reportClaimId),
    check(
      "evidence_sources_relation_valid",
      sql`${table.relation} in ('supports', 'contradicts', 'context')`,
    ),
    check(
      "evidence_sources_review_status_valid",
      sql`${table.reviewStatus} in ('unreviewed', 'verified', 'rejected')`,
    ),
    check(
      "evidence_sources_freshness_status_valid",
      sql`${table.freshnessStatus} in ('unreviewed', 'current', 'needs-review', 'stale')`,
    ),
  ],
);

export const researchCaptures = pgTable(
  "research_captures",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    reportClaimId: text("report_claim_id").notNull(),
    requestedUrlCiphertext: text("requested_url_ciphertext").notNull(),
    finalUrlCiphertext: text("final_url_ciphertext").notNull(),
    titleCiphertext: text("title_ciphertext").notNull(),
    contentCiphertext: text("content_ciphertext").notNull(),
    contentType: text("content_type").notNull(),
    byteLength: integer("byte_length").notNull(),
    contentSha256: text("content_sha256").notNull(),
    redirectCount: integer("redirect_count").notNull().default(0),
    reviewStatus: text("review_status").notNull().default("unreviewed"),
    evidenceSourceId: uuid("evidence_source_id").references(() => evidenceSources.id, { onDelete: "set null" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("research_captures_run_claim_idx").on(table.runId, table.reportClaimId),
    index("research_captures_owner_captured_idx").on(table.ownerId, table.capturedAt),
    check("research_captures_byte_length_positive", sql`${table.byteLength} > 0`),
    check("research_captures_redirect_count_range", sql`${table.redirectCount} between 0 and 3`),
    check(
      "research_captures_review_status_valid",
      sql`${table.reviewStatus} in ('unreviewed', 'accepted', 'rejected')`,
    ),
  ],
);

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    defaultModel: text("default_model").notNull(),
    baseUrl: text("base_url"),
    endpointPreset: text("endpoint_preset").notNull().default("custom"),
    reasoningProtocol: text("reasoning_protocol").notNull().default("none"),
    structuredOutputMode: text("structured_output_mode").notNull().default("json-object"),
    secretCiphertext: text("secret_ciphertext").notNull(),
    catalogSnapshotCiphertext: text("catalog_snapshot_ciphertext"),
    revision: integer("revision").notNull().default(1),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_connections_owner_label_uq").on(table.ownerId, table.label),
    index("provider_connections_owner_provider_idx").on(table.ownerId, table.provider),
  ],
);

export const decisionConnections = pgTable(
  "decision_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    provider: text("provider").notNull().default("typesafe"),
    label: text("label").notNull(),
    defaultModel: text("default_model").notNull().default("jev-1.13.0"),
    secretCiphertext: text("secret_ciphertext").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("decision_connections_owner_label_uq").on(table.ownerId, table.label),
    check("decision_connections_provider_valid", sql`${table.provider} = 'typesafe'`),
  ],
);

export const decisionAssessments = pgTable(
  "decision_assessments",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    reportClaimId: text("report_claim_id").notNull(),
    sourceId: uuid("source_id").notNull().references(() => evidenceSources.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull().references(() => decisionConnections.id, { onDelete: "restrict" }),
    mode: text("mode").notNull().default("shadow"),
    status: text("status").notNull().default("queued"),
    rubricVersion: text("rubric_version").notNull(),
    requestedModel: text("requested_model").notNull(),
    returnedModel: text("returned_model"),
    runStateVersion: integer("run_state_version").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    inputCiphertext: text("input_ciphertext").notNull(),
    resultCiphertext: text("result_ciphertext"),
    errorCode: text("error_code"),
    queueJobId: text("queue_job_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("decision_assessments_run_claim_idx").on(table.runId, table.reportClaimId),
    index("decision_assessments_owner_created_idx").on(table.ownerId, table.createdAt),
    check("decision_assessments_mode_valid", sql`${table.mode} in ('shadow', 'advisory')`),
    check(
      "decision_assessments_status_valid",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'outcome_unknown', 'cancelled')`,
    ),
    check("decision_assessments_run_version_positive", sql`${table.runStateVersion} > 0`),
  ],
);

export const decisionOperations = pgTable(
  "decision_operations",
  {
    id: uuid("id").primaryKey(),
    assessmentId: uuid("assessment_id").notNull().references(() => decisionAssessments.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull().default("single"),
    attempt: integer("attempt").notNull().default(1),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    resultCiphertext: text("result_ciphertext"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("decision_operations_assessment_batch_attempt_uq").on(
      table.assessmentId,
      table.batchId,
      table.attempt,
    ),
    check("decision_operations_attempt_positive", sql`${table.attempt} > 0`),
    check(
      "decision_operations_status_valid",
      sql`${table.status} in ('prepared', 'submitted', 'succeeded', 'failed', 'outcome_unknown', 'discarded', 'retry_authorized')`,
    ),
  ],
);

export const councilTemplates = pgTable(
  "council_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    membersCiphertext: text("members_ciphertext").notNull(),
    memberCount: integer("member_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    creationRequestId: uuid("creation_request_id"),
    creationRequestHash: text("creation_request_hash"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletionReceiptCiphertext: text("deletion_receipt_ciphertext"),
  },
  (table) => [
    uniqueIndex("council_templates_owner_name_uq").on(table.ownerId, table.name).where(sql`${table.deletedAt} is null`),
    uniqueIndex("council_templates_owner_request_uq").on(table.ownerId, table.creationRequestId),
    check("council_templates_member_count_range", sql`${table.memberCount} between 2 and 6`),
  ],
);

export const providerBillingRecords = pgTable("provider_billing_records", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  // Logical references retain accounting provenance after run/connection retention.
  operationId: uuid("operation_id").notNull(),
  runId: uuid("run_id").notNull(),
  sourceLineFingerprint: text("source_line_fingerprint").notNull(),
  remoteIdentityFingerprint: text("remote_identity_fingerprint").notNull(),
  fingerprint: text("fingerprint").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("provider_billing_records_owner_operation_idx").on(table.ownerId, table.operationId),
  uniqueIndex("provider_billing_records_owner_fingerprint_uq").on(table.ownerId, table.fingerprint),
  index("provider_billing_records_owner_run_idx").on(table.ownerId, table.runId),
]);

export const providerBillingChanges = pgTable("provider_billing_changes", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(),
  recordId: uuid("record_id").notNull().references(() => providerBillingRecords.id, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull(), requestFingerprint: text("request_fingerprint").notNull(),
  fingerprint: text("fingerprint").notNull(), payloadCiphertext: text("payload_ciphertext").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("provider_billing_changes_record_sequence_uq").on(table.recordId, table.sequence),
  uniqueIndex("provider_billing_changes_record_request_uq").on(table.recordId, table.requestFingerprint),
  check("provider_billing_changes_sequence_range", sql`${table.sequence} between 1 and 100`),
]);

export const providerBillingClaims = pgTable("provider_billing_claims", {
  recordId: uuid("record_id").primaryKey().references(() => providerBillingRecords.id, { onDelete: "restrict" }),
  ownerId: text("owner_id").notNull(), operationId: uuid("operation_id").notNull(),
  sourceLineFingerprint: text("source_line_fingerprint").notNull(), remoteIdentityFingerprint: text("remote_identity_fingerprint").notNull(),
}, (table) => [
  uniqueIndex("provider_billing_claims_owner_operation_uq").on(table.ownerId, table.operationId),
  uniqueIndex("provider_billing_claims_owner_source_uq").on(table.ownerId, table.sourceLineFingerprint),
  uniqueIndex("provider_billing_claims_owner_remote_uq").on(table.ownerId, table.remoteIdentityFingerprint),
]);

export const providerBillingReallocations = pgTable("provider_billing_reallocations", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(),
  sourceRecordId: uuid("source_record_id").notNull().references(() => providerBillingRecords.id, { onDelete: "restrict" }),
  targetRecordId: uuid("target_record_id").notNull().references(() => providerBillingRecords.id, { onDelete: "restrict" }),
  requestFingerprint: text("request_fingerprint").notNull(), fingerprint: text("fingerprint").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("provider_billing_reallocations_source_uq").on(table.sourceRecordId),
  uniqueIndex("provider_billing_reallocations_target_uq").on(table.targetRecordId),
  uniqueIndex("provider_billing_reallocations_request_uq").on(table.ownerId, table.requestFingerprint),
]);

export const billingStatementVersions = pgTable("billing_statement_versions", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(),
  // Logical identity survives run/connection retention; statement payloads remain encrypted.
  identityFingerprint: text("identity_fingerprint").notNull(), sequence: integer("sequence").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(), fingerprint: text("fingerprint").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("billing_statement_versions_identity_sequence_uq").on(table.ownerId, table.identityFingerprint, table.sequence),
  uniqueIndex("billing_statement_versions_identity_request_uq").on(table.ownerId, table.identityFingerprint, table.requestFingerprint),
  index("billing_statement_versions_owner_recorded_idx").on(table.ownerId, table.recordedAt, table.id),
  check("billing_statement_versions_sequence_range", sql`${table.sequence} between 1 and 100`),
]);

export const providerPriceSnapshots = pgTable("provider_price_snapshots", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  // No connection FK: historical prices survive connection deletion and edits.
  connectionId: uuid("connection_id").notNull(),
  connectionRevision: integer("connection_revision").notNull(),
  model: text("model").notNull(),
  fingerprint: text("fingerprint").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("provider_price_snapshots_owner_fingerprint_uq").on(table.ownerId, table.fingerprint),
  index("provider_price_snapshots_lookup_idx").on(table.ownerId, table.connectionId, table.connectionRevision, table.model, table.recordedAt),
  check("provider_price_snapshots_revision_positive", sql`${table.connectionRevision} > 0`),
]);

export const providerOperations = pgTable(
  "provider_operations",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    memberId: text("member_id").notNull(),
    round: integer("round").notNull().default(0),
    attempt: integer("attempt").notNull().default(1),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    remoteResponseId: text("remote_response_id"),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    reservedOutputTokens: integer("reserved_output_tokens"),
    priceSnapshotId: uuid("price_snapshot_id").references(() => providerPriceSnapshots.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    costEstimateCiphertext: text("cost_estimate_ciphertext"),
    rawTextCiphertext: text("raw_text_ciphertext"),
    parsedOutputCiphertext: text("parsed_output_ciphertext"),
    resultMetadataCiphertext: text("result_metadata_ciphertext"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("provider_operations_run_member_round_attempt_uq").on(
      table.runId,
      table.memberId,
      table.round,
      table.attempt,
    ),
    check("provider_operations_round_range", sql`${table.round} between 0 and 3`),
    check("provider_operations_attempt_positive", sql`${table.attempt} > 0`),
    check("provider_operations_reserved_output_range", sql`${table.reservedOutputTokens} is null or ${table.reservedOutputTokens} between 128 and 32768`),
    check(
      "provider_operations_status_valid",
      sql`${table.status} in ('prepared', 'submitted', 'succeeded', 'failed', 'outcome_unknown', 'discarded', 'retry_authorized')`,
    ),
  ],
);

export const workerHeartbeats = pgTable(
  "worker_heartbeats",
  {
    id: uuid("id").primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (table) => [index("worker_heartbeats_heartbeat_idx").on(table.heartbeatAt)],
);

export const knowledgeCollections = pgTable("knowledge_collections", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), accountId: text("account_id").notNull(),
  bodyCiphertext: text("body_ciphertext").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("knowledge_collections_owner_idx").on(table.ownerId)]);
export const knowledgeGrants = pgTable("knowledge_grants", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(),
  collectionId: uuid("collection_id").notNull().references(() => knowledgeCollections.id),
  revision: integer("revision").notNull().default(1), status: text("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("knowledge_grants_collection_uq").on(table.collectionId),
  check("knowledge_grants_revision_positive", sql`${table.revision} > 0`),
  check("knowledge_grants_status_valid", sql`${table.status} in ('active', 'revoked')`)]);
export const conversationKnowledge = pgTable("conversation_knowledge", {
  conversationId: uuid("conversation_id").primaryKey().references(() => conversations.id),
  ownerId: text("owner_id").notNull(), revision: uuid("revision").notNull(),
  selectionCiphertext: text("selection_ciphertext").notNull(),
}, (table) => [index("conversation_knowledge_owner_idx").on(table.ownerId)]);
export const conversationKnowledgeSelections = pgTable("conversation_knowledge_selections", {
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id), ownerId: text("owner_id").notNull(),
  collectionId: uuid("collection_id").notNull().references(() => knowledgeCollections.id),
  grantId: uuid("grant_id").notNull().references(() => knowledgeGrants.id), grantRevision: integer("grant_revision").notNull(),
}, (table) => [primaryKey({ columns: [table.conversationId, table.collectionId] }),
  check("conversation_knowledge_selections_revision_positive", sql`${table.grantRevision} > 0`)]);

export const runEvents = pgTable(
  "run_events",
  {
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.sequence] }),
    check("run_events_sequence_positive", sql`${table.sequence} > 0`),
  ],
);
