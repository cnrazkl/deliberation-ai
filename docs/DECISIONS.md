# Decisions

DA-123 reuses the existing evidence source review boundary with frozen candidate
origin/provenance, separate observed availability and additive changed-source links.
No automatic truth annotation or reusable publication is admitted.
[ADR-0038](adr/0038-evidence-candidate-inbox.md).

DA-121 accepts encrypted immutable local source versions, page/hash-bound old quotes,
bounded transient lexical reads and explicit immutable transient-failure retries.
No external service is required or admitted. [ADR-0036](adr/0036-local-knowledge-source-versions.md).

DA-119 accepts a local-first trial contract and individual-file-only initial import,
with exact-plan owner approval and independent human/model acceptance still open.
The offline preparation does not enable ingestion or admit a connector.
[ADR-0034](adr/0034-local-knowledge-trial-contract.md), [evidence](DA119_ACCEPTANCE.md).

## Proposed knowledge-service decision — 5 October 2026

Owner-directed reliability policy: exclude brittle cookie/private-API notebook bridges; security, quality and maintainability outrank a vendor choice. Proposed implementation remains unbuilt: local-first reusable evidence behind a separate knowledge boundary, exact grants, frozen excerpts and reviewed publication. Notion is outside scope; official NotebookLM is deferred; Open Notebook/RAGFlow must pass optional adapter admission. Preserve portable originals/evidence, upgrade/recovery tests and a vendor-independent local path. NVIDIA remains on the compatible protocol. [Proposal](KNOWLEDGE_SOURCES.md), [research](research/KNOWLEDGE_CONNECTORS_2026_10_05.md); DA-119–DA-126 stay open.

DA-103 implements [ADR-0030](adr/0030-next-lint-glob-mitigation.md): exact Next lint parent-scoped dependency replacement and lock-hashed utility adaptation, with complete rule-settings preservation and clean-install/path/violation regressions. Keep full dependency and secret gates; remove/adapt alias and patch together after upstream review. This is a tooling maintenance obligation, not a runtime security certification.

DA-102 implements [ADR-0029](adr/0029-reviewed-run-body-deletion.md): owned terminal leaf content removal with retained usage/intent audit, existing worker fence and exact cascade review. Preserve memberships and independent inputs/billing; exclude decision aggregates without a fence. Its original full dependency gate is resolved by DA-103 without an advisory exception.

DA-101 accepts [ADR-0028](adr/0028-reviewed-private-branch-deletion.md): reviewed leaf-first private content removal with encrypted content-free usage/provenance and replay retention. Keep logical audit identifiers after later empty-conversation metadata deletion. Do not cascade into copies, clear unknown work, erase external archives or imply a refund.

DA-100 extends [ADR-0027](adr/0027-reviewed-private-delivery.md) to reviewed native Gemini generateContent text. Reuse existing versions/locks/allowances, refuse unsupported output and keep candidate/thought conventions distinct. Drop opaque signatures from reconstructed history, preserve unfinished uncertainty and add no blind resend. Richer settings, provider-managed continuity, erasure and live acceptance remain separate; earlier provider-absence notes describe historical increments.

DA-099 extends [ADR-0027](adr/0027-reviewed-private-delivery.md) to native Responses with stateless reviewed text, existing private versions and separate council state. Validate output boundaries, exclude opaque reasoning from retained history, expose inclusive counts and preserve remote-pending uncertainty. Gemini, richer continuation/settings and live acceptance remain separate.

DA-098 extends [ADR-0027](adr/0027-reviewed-private-delivery.md) to native Claude/Anthropic without changing request/result versions or council orchestration. Preserve reviewed stateless turn text/order, accept only bounded text replies and expose native cache conventions. Other native adapters/settings, cloud acceptance and erasure remain separate increments.

DA-097 accepts ADR-0027: separate preview-bound private delivery, durable no-blind-retry receipts, bounded local request/output capacity and no promotion into council authority or billing. Supported compatible settings only; broader providers, live acceptance and content erasure remain separate.

DA-096 accepts [ADR-0026: selected-member private drafts](adr/0026-selected-member-private-drafts.md): a separate encrypted owner-draft aggregate, source-bound reply seed, immutable versioned messages and copied-prefix forks retain provenance without creating model responses or weakening council invariants. Private content blocks metadata deletion and enters explicit exports/backup verification. Actual single-model dispatch and private-content deletion remain open.

DA-095 accepts [ADR-0025: reviewed empty conversation metadata deletion](adr/0025-empty-conversation-metadata-deletion.md): retain metadata by default, remove one reviewed identity only after all body rows/references are absent, reject changed/oversized/foreign/schema-drifted targets and preserve independent backup/export copies. Available conversations and future model-private messages require separate deletion policy.

DA-094 decision, 2 October 2026: discover owned conversations through a bounded read-only projection ordered by immutable conversation creation time. Keep metadata-only entries explicit, reuse saved-run opening without changing the draft, compare paging cursors at database precision and invalidate stale history responses on refresh. The list does not certify the complete graph or add model-private messages or deletion policy. Primary verification is recorded in [the audit](REPO_AUDIT_2026_10_02.md).

DA-093 accepts [ADR-0024: durable run conversations](adr/0024-durable-run-conversations.md): preserve minimal owned membership beyond run retention, inherit identity atomically and export complete recorded membership in one bounded snapshot. Conversation libraries, model-private messages and metadata deletion remain separate work.

DA-092 accepts [ADR-0023: authenticated run branch navigation](adr/0023-run-branch-navigation.md): immediate-source indexes, authenticated legacy backfill and owner-scoped navigation preserve saved inputs through ancestor retention; conversation identity/export remain separate work.

DA-089 decision, 1 October 2026: compare exact-invoice payment/refund evidence only after re-inspecting the current owned invoice. Bind locally hashed sources and reject duplicate transactions/lines, unsupported allocation and stale or incomplete invoices. A supported evidence subtotal cannot certify provider/bank settlement; preserve unknown payment status and forbid monetary dispatch. Keep durable payment claims and authoritative account acceptance separate. [Design](BILLING_PAYMENT.md).

DA-088 decision, 1 October 2026: add account-scope technical inspection before claiming settled invoices. Bind each declared connection to a current reviewed statement slice of the same source invoice, reconcile exact totals and reject repeated source lines/remote responses across connections. Expose unknown aggregate/receipt availability explicitly and retain owner-declared account identity. Keep provider/payment authentication and durable account history separate. [Design](BILLING_ACCOUNT.md).

DA-087 decision, 1 October 2026: correct mistaken attribution identities by appending a new immutable root and an encrypted source-to-target event, while transferring only current uniqueness claims. Preserve original ciphertext and correction history; exclude superseded evidence without inferring zero spend or a refund. Serialize competing moves and keep exact old retries historical. Require new review for affected statement versions. Occupied-target merging/swapping and authoritative payment/account reconciliation remain outside this increment. [Design](BILLING_REALLOCATION.md).

DA-086 decision, 1 October 2026: preserve statement/shared-charge evidence in encrypted immutable versions rather than overwrite a locally balanced packet. Bind each revision to the reviewed head and save its complete ledger inspection in the insertion snapshot. Retain old evidence, fold one effective version and expose currentness separately. Withdrawal never certifies zero charges; actual provider/payment reconciliation and monetary controls remain separate. [Design](BILLING_STATEMENT_HISTORY.md).

DA-085 decision, 1 October 2026: inspect complete owner-reviewed statement packets without persisting or claiming authoritative settlement. Keep unallocated charges separate, use exact signed USD arithmetic and bind each attempt to its current reviewed fingerprint. Scan the full owned ledger under one read-only snapshot; detect omissions and explicitly report retained receipts unavailable. Account/payment evidence and monetary dispatch remain separate. [Rationale](BILLING_STATEMENTS.md).

DA-084 decision, 1 October 2026: replace same-attribution amounts/documents or void evidence only through appended, version-bound changes; retain the original ciphertext and receipt/source identity. Fold one effective record rather than sum historical amounts. Keep voided calls pending rather than infer a remote refund. Limit each chain to 100 changes, show ten recent changes in usage and retain complete operator history after run pruning. Real settlement, identity reallocation and monetary enforcement remain open. [Design](BILLING_CORRECTIONS.md).

DA-083 decision, 1 October 2026: add a bounded owner-reviewed evidence ledger instead of converting token estimates or aggregate costs into settled invoices. Require document digest, exact owned submitted receipt/frozen connection, explicit complete-attempt attribution and exact component arithmetic. Preserve immutable provenance and prevent duplicate source/response charges. Retain evidence after run pruning; source bytes, corrections/deletion, authoritative provider import/payment acceptance and monetary caps remain separate work. [Rationale](PROVIDER_BILLING.md).

DA-081 decision, 30 September 2026: enforce optional local council call/output dispatch capacity with frozen encrypted limits and permanent reservations claimed atomically with submission. Do not refund from observed usage or operator resolution, because an unknown remote outcome may have consumed output. Replay successful receipts without another reservation; require capacity for every new manual attempt. Keep fresh per-occurrence and child-run allowances explicit, and leave input/tool pricing, settled invoice cost and monetary enforcement open. Complete acceptance verification is pending. [Contract and limitations](EXECUTION_LIMITS.md).

DA-080 decision, 29 September 2026: preserve received usage as native observations with versioned detail and per-field completeness, including known output-validation failures. Do not add overlapping cache/reasoning counts or infer missing totals/prices. Use existing encrypted metadata rather than a schema migration. Serialize owner/idempotency intent inside enqueue transactions and retain an unchanged browser key across uncertain responses. [Policy](PROVIDER_USAGE_DETAILS.md), [audit fixes](REPO_AUDIT_2026_09_29.md).

DA-071 decision, 28 September 2026: provide owner-controlled prompt revisions with a deterministic, additive default rather than claiming unmeasured LLM optimization. Preserve the original verbatim, show exact additions, require selected candidates to contain the original once, and recompute risk/prompt previews before enqueue. Store the chosen revision and mechanical audit encrypted; keep semantic optimization and independent semantic drift evaluation open. [Decision scope](PROMPT_REVISIONS.md).

DA-070 decision, 28 September 2026: use a small deterministic missing-context gate over the owner's original question, persist an encrypted `awaiting_input` draft before creating any model job, and require an explicit answer/original choice plus fresh prompt/risk preview before continuing. Preserve the original and decision as encrypted run provenance, scrub the draft payload transactionally, and reject/pause non-interactive schedules rather than guessing an answer. No semantic completeness, model coaching or prompt optimization is implied. [Workflow](MISSING_CONTEXT_PREFLIGHT.md).

DA-069 decision, 27 September 2026: implement a local, conservative lexical risk floor before the deferred coaching/transformation workflow. Scan only delivered context, treat uninspected images as high, allow manual escalation but no rule downgrade, enforce the result at run/schedule boundaries and retain a versioned encrypted assessment. The user explicitly adds any missing member/review controls after seeing the reason; no silent model call or question rewrite occurs. Preserve null legacy assessments and no-digest request hashes. This supersedes ADR-0024's declared-profile-only limitation without claiming semantic classification accuracy. [Policy and remaining work](RISK_PREFLIGHT.md).

| ID | Status | Decision |
|---|---|---|
| ADR-0001 | accepted | TypeScript modular monolith: Next.js BFF, separate Node worker, PostgreSQL/Drizzle, pg-boss |
| ADR-0002 | accepted | Provider SDKs remain behind a normalized adapter contract |
| ADR-0003 | accepted | Durable jobs use short database transactions; real providers require explicit outcome certainty |
| ADR-0004 | accepted | REST commands plus durable cursor event replay; SSE is the primary browser transport and polling is the reconnect fallback |
| ADR-0005 | accepted | Credentials and sensitive artifacts require encryption and bounded retention before real providers |
| ADR-0006 | accepted | Local sensitive fields use application-layer AES-256-GCM with a local master key |
| ADR-0007 | accepted | Provider calls use durable outcome receipts; unknown outcomes require human action and block automatic retry |
| ADR-0008 | accepted | Native OpenAI Responses and compatible endpoints use separate adapters |
| ADR-0009 | accepted | Cross-review is opt-in per run, limited to one parallel round, excludes a reviewer's own answer, and shares only validated structured round-0 output |
| ADR-0010 | accepted | Red-team is an explicit member role; its claims are excluded from analyst agreement groups and projected as non-authoritative challenges |
| ADR-0011 | accepted | Evidence state is an explicit durable owner annotation initialized as unsupported; model repetition never promotes it |
| ADR-0012 | accepted | Synthesis coverage is an explicit durable projection; shared claims start included, minority and red-team claims start unresolved, and omission never deletes provenance |
| ADR-0013 | accepted | Shared conversation memory requires explicit capture and per-run selection, is bounded to 20 stored/5 selected entries, and is always labeled unverified context rather than fact or instruction |
| ADR-0014 | accepted | External verification and contradiction require an owner-verified source with a matching relation; URLs are recorded encrypted and are never fetched automatically |
| ADR-0015 | accepted | Every new evidence source freezes an encrypted excerpt and capture time; claim verification additionally requires a separate owner freshness decision of current |
| ADR-0016 | accepted | Provider connections are reusable idle credentials/endpoints; model, reasoning, and supported web-search mode are frozen per member and run, while provider-returned citations remain unverified provenance |
| [ADR-0017](adr/0017-advisory-decision-evaluation.md) | implemented behind default-off gate; live evaluation owner-deferred | Add an optional, separate decision-evaluation boundary; JEV is an experimental candidate subject to Turkish source-grounded quality gates, never a council authority or automatic evidence verifier |
| [ADR-0018](adr/0018-application-managed-retrieval.md) | accepted and implemented | Public web retrieval is owner-initiated, SSRF-hardened, bounded and captured separately; only an exact owner-selected excerpt can enter the existing unreviewed evidence workflow |
| [ADR-0019](adr/0019-local-mcp-result-boundary.md) | accepted and implemented | MCP is loopback-only and owner-invoked; models receive selected immutable text results as untrusted context and cannot call tools |
| [ADR-0020](adr/0020-local-schedules.md) | accepted and implemented | Recurring local runs use paused-by-default encrypted snapshots, explicit activation and occurrence idempotency in the existing worker |
| ADR-0021 | accepted and implemented | Task PDFs use bounded local selectable-text extraction and server verification, then the common text-provider input; provider-native PDF upload and OCR are not assumed. Attachment consent controls both image bytes and PDF text. The owner-facing council uses saved connections, while deterministic adapters remain as internal test fixtures. |
| ADR-0022 | accepted and implemented | Mixed analyst `objection` and other-kind classifications of the same normalized statement cannot create automatic shared ground. Preserve all occurrences and historical owner annotations; call this a classification split rather than semantic contradiction. |
| ADR-0023 | accepted and implemented | Audit exact transfer of validated model claims into report occurrences; keep scope and pairwise relations as encrypted owner annotations without automatic truth, evidence or synthesis changes. |
| ADR-0024 | accepted and implemented | The owner may declare a run or schedule high-risk. The server requires red-team and cross-review before enqueue, and completion requires successful controls and intact claim transfer; no automatic risk classification or correctness guarantee is implied. |
| ADR-0025 | accepted and implemented | Reuse provider prompt builders for a per-member first-round text preview. Freeze a version and digest of rendered text, selected settings and attachment hashes; reject drift at enqueue and fail without a model call if the queued snapshot no longer matches. Keep prompt optimization and later-round preview as separate work. |
| ADR-0026 | accepted and implemented | Preserve provider text that fails structured parsing as an encrypted failed receipt and failed-member detail, including restart replay. Keep it out of claim grouping and peer review; no automatic extraction or truth claim follows from inspectability. |
| ADR-0027 | accepted and implemented foundation | Measure source-level council claim recall offline against exact-span human gold claims and explicit judgments. Count missing, uncertain and unassessed separately; do not infer semantic representation by string match or promote synthetic fixture scores to model-quality claims. |
| ADR-0028 | accepted and implemented | Bind assessed gold judgments to a case/run id and loaded domain report. Derive occurrence ids only from an intact claim ledger; reject a caller-authored inventory. Database run authenticity remains the caller's responsibility. |
| ADR-0029 | accepted and implemented | Keep council-coverage scoring offline. The local persistence entry point loads owner-scoped encrypted reports and checks frozen question identity before scoring; source provenance and human labels remain separate evaluation responsibilities. |
| ADR-0030 | accepted and implemented foundation | Assemble council gold corpora only after two separate review sheets and an explicit third adjudication account for every proposed claim. Freeze source snapshots and hash both corpus and labeling inputs; structural checks do not authenticate people or source authority. |

The Phase 0b implementation uses the accepted PostgreSQL and pg-boss path. No run state depends on web-process memory.

DA-068 decision, 27 September 2026: the first broad correctness group separates technical readiness from human/empirical acceptance. External source families are frozen before labels; gold requires two human reviews, third-person adjudication and an explicit coordinator attestation. Source-level measurement must prove that the exact source bundle reached the persisted prompt, rather than matching only the short question. Held-out results and critical losses gate acceptance independently of pooled recall. Semantic contradiction remains an offline shadow prototype with candidate omissions measured against all-pair human labels until a separately evaluated provider binding exists. See [the complete acceptance contract](evaluation/COUNCIL_CORRECTNESS.md).

- DA-104 retains the existing preflight row as a content-free cancelled tombstone after reviewed payload scrubbing, without changing the schema or deleting linked runs. [ADR-0031](adr/0031-reviewed-preflight-draft-content-deletion.md).

## DA-107 reviewed local schedule deletion

ADR-0032 retains reviewed schedule tombstones, reserves occurrence keys to fenced dispatch and makes enqueue/cursor advancement atomic. [Contract](LOCAL_SCHEDULE_DELETION.md), [ADR-0032](adr/0032-reviewed-local-schedule-deletion.md).

## DA-122 reviewed local source packets

[ADR-0037](adr/0037-reviewed-local-knowledge-packets.md) accepts reviewed bounded local packets with visible omissions, freshness and prospective authorization fencing for the trial. Independent human/model acceptance remains open.

- [ADR-0039: atomic reviewed reusable evidence and manual handoff](adr/0039-reviewed-reusable-evidence.md).
