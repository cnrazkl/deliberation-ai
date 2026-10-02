# Task history

Archived on 21 September 2026 when the accepted local milestone closed. This file preserves the detailed implementation sequence; it is not an active backlog.

## Recently completed

- DA-093 (1 October 2026): added durable run-based conversations, atomic root/child/rerun membership, legacy grouping, retained unavailable-member metadata and all-recorded-branch export with explicit scope/size limits. Passed 252 unit/122 isolated PostgreSQL/14 browser flows, typecheck/lint/isolated production build, populated restore including conversation metadata and live runtime checks. Preserved PostgreSQL timestamp precision after the restore audit detected initial JS rounding. [Contract](CONVERSATIONS.md).

- DA-092 (1 October 2026): added authenticated source-linked run branch navigation with distinct full/compacted/rerun labels, bounded ancestors and paginated sibling/child views. Backfilled 313 owned legacy rows, preserved drafts and missing-source links, passed 252 unit/116 isolated PostgreSQL/14 browser tests plus typecheck/lint/build and populated disposable backup restore. Conversation aggregates/export remain open. [Contract](RUN_BRANCHES.md).

- DA-001: created a permanent repository and canonical starting documents.
- DA-002: created the strict pnpm workspace, web application, package boundaries, and test commands.
- DA-004-preview: implemented provider contract, two deterministic fakes, failure fixture, and contract tests.
- DA-005-preview: implemented a frozen round-0 snapshot and deterministic in-process orchestration.
- DA-007-preview: retained raw/parsed output and claim occurrences; exact normalized grouping does not discard provenance.
- DA-008-preview: rendered shared and distinct claims without adding outside facts.
- DA-009-preview: added a usable question/result page and an explicit partial-failure switch.
- DA-003: applied the minimal schema to PostgreSQL 18 and added a real database integration test.
- DA-006: connected atomic pg-boss enqueue, separate worker leasing, durable checkpoints, restart recovery, and idempotent fake-job completion.
- DA-009: replaced in-process completion with cursor polling, cancellation, and persisted results.
- DA-010: added cancellation, failure, duplicate-delivery, event replay, restart recovery integration coverage, and the main Playwright flow.
- DA-011-local: added local same-origin protection, AES-256-GCM content/credential encryption, migration backfill, credential deletion, and retention pruning.
- DA-012: added durable provider-operation receipts, encrypted result replay, and automatic-retry blocking for unknown outcomes.
- DA-013-code: implemented and unit-tested the native OpenAI Responses adapter with Structured Outputs and provider-side storage disabled.
- DA-016: implemented validated 2–6 member council configuration, six deterministic perspectives, immutable encrypted run snapshots, and partial status when any configured member fails.
- DA-017: implemented encrypted local council templates with BFF CRUD and browser coverage.
- DA-018: removed the one-connection-per-provider storage constraint; added connection ids to member configuration, multi-connection local management, and per-member role/model/connection editing.
- DA-014: added an operator projection for `outcome_unknown`, explicit discard, explicit retry authorization, immutable numbered attempts, atomic requeue, and browser/integration coverage.
- DA-015: added native OpenAI, Anthropic, and Gemini adapters plus configurable OpenAI-compatible endpoints for Kimi, Qwen, vLLM, Ollama, LiteLLM, OpenRouter, and custom servers; added mixed-provider councils and per-member reasoning levels.
- DA-019: added an optional single cross-review round, peer-targeted support/qualification/challenge assessments, round-aware provider receipts, encrypted review persistence, and browser presentation.
- DA-020: added explicit analyst/red-team member roles, role-aware prompts and reviews, analyst-only agreement grouping, a separate red-team challenge projection, encrypted role persistence, and browser controls.
- DA-021: added explicit claim evidence states, unsupported-by-default semantics, an atomic same-origin update route, durable audit events, legacy hydration, and browser controls.
- DA-022: added non-authoritative synthesis coverage, safe shared/distinct/red-team defaults, atomic durable updates, visible omission, legacy hydration, and a three-column browser ledger.
- DA-023: added encrypted bounded shared memory, explicit claim capture and per-run selection, immutable memory snapshots, provider warning labels, provenance, and browser coverage.
- DA-024: added encrypted source-backed evidence records, manual review states, relation-aware claim-state guards, protected deletion, and browser controls without automatic URL retrieval.
- DA-025: added required encrypted immutable source excerpts, optional publication dates, server capture timestamps, separate freshness review, freshness-aware claim guards, protected downgrades, and database-enforced snapshot immutability.
- DA-026: separated reusable connections from per-task model selection; added key-preserving connection edits, idle/active state, clearer OpenRouter/LiteLLM guidance, per-member reasoning and web-search controls, bounded native search tools for OpenAI/Anthropic/Gemini/OpenRouter, and encrypted citation provenance.
- DA-027: researched Jev using primary product documentation and published experiments; documented limits, a conditional advisory design, and an accuracy-first evaluation gate. Updated the architecture and next-step plan. Documentation only; no working Jev integration or measured accuracy improvement is claimed. See [research](research/JEV_ASSESSMENT.md) and [ADR-0017](adr/0017-advisory-decision-evaluation.md).
- DA-028: implemented the provider-independent offline evaluation foundation: a Turkish-first synthetic fixture, immutable claim/excerpt corpus schema, exact-span and document-split guards, semantic-vs-operational outcome separation, deterministic safety/calibration metrics, seeded paired document-clustered intervals, labeling protocol, and frozen live-pilot pre-registration. Seven offline tests pass. This does not integrate or measure Jev.
- DA-029: implemented the separate `DecisionEvaluator` contract, deterministic fake and injected direct TypeSafe adapters, exact Jev version pinning, encrypted decision connections/assessment snapshots/results, durable operation receipts, cancellation, stale-input detection, explicit retry/discard, and a no-blind-retry worker queue. Normal checks use injected clients and make no live request.
- DA-031-code: implemented the owner-initiated source-support panel and BFF routes. The UI requires an explicit hosted-text-sharing confirmation, shows the immutable excerpt, rubric/model versions, full probabilities, provider confidence with a non-correctness warning, stale status, and unknown-outcome controls. It cannot update evidence or synthesis state. Execution remains globally disabled by default and advisory promotion remains locked behind DA-030.
- DA-032: implemented owner-initiated application-managed public web retrieval. The retriever validates HTTP(S) URLs, resolves and rejects non-public A/AAAA targets, pins each connection to a validated address, revalidates bounded redirects, and enforces time, header, body, content-type and extracted-text limits. Encrypted immutable captures remain unreviewed until the owner rejects them or selects an exact frozen-text excerpt for a new unreviewed evidence record. Provider citations, claim state and synthesis remain separate.
- DA-013-live: configured seven encrypted cloud connections and ran opt-in low-cost smoke tests. OpenAI, Gemini, Claude, direct DeepSeek, OpenRouter Qwen, and Alibaba Qwen passed live generation and reasoning-level checks. Native OpenAI/Claude and OpenRouter returned normalized live search citations; Gemini accepted its grounded request without returning a citation for that prompt. Kimi reached Moonshot but the supplied account is suspended for insufficient balance. The compatible output budget was corrected for reasoning-heavy Qwen models. See [live provider validation](LIVE_PROVIDER_VALIDATION.md).
- DA-033: made red-team operation explicit in the main workflow with a one-action configuration control. It adds or assigns an independently configured red-team member, preserves the existing analyst/challenge separation, and renders the complete analyst ledger beside the red-team challenge ledger with labeled cross-review challenge counts. The comparison infers no semantic match, winner or truth score.
- DA-034: made durable SSE the primary progress transport while preserving cursor polling as an automatic startup fallback.
- DA-035: added bounded selectable-text PDF capture beside direct HTML/plain-text capture, with a separate parse deadline and page/character limits.
- DA-036: added encrypted immutable task-image snapshots, per-member delivery consent, native multimodal request translation, and text-only cross-review.
- DA-037: added loopback-only Streamable HTTP MCP connections, explicit owner tool invocation, encrypted result snapshots, manual selection and deterministic lexical top-3 retrieval. Models cannot authorize or invoke tools.
- DA-038: added paused-by-default daily/weekly local schedules with encrypted frozen run input, explicit activation, occurrence idempotency, durable run links and worker restart catch-up.
- DA-039: added optional isolated browser-rendered public capture. All browser requests pass through the same DNS-pinned SSRF boundary and strict method, resource, request-count, byte and time limits.
- DA-040: widened task images to six with browser decoding, server signature/digest checks and a database constraint; added a no-provider-call approximate first-round token preview and loopback-only web binding.
- DA-041: corrected the empty-input token display and separated user input from remote council overhead; clarified fake perspectives, passed member roles into real provider instructions, and audited the historical PLAN.md against the running app.

## Externally blocked or excluded

- DA-030: owner-deferred live Jev/LLM/baseline pilot after a real key and exact comparison models are selected. Enable the decision worker explicitly, keep the first run in shadow mode, and use the frozen [evaluation plan](EVALUATION.md). Inconclusive or failing results keep the feature in shadow/off mode.
- Kimi live retest: repeat the existing `kimi-k2.6` smoke test only after the Moonshot account balance/suspension changes; no application change is currently indicated.

## Held by the local-only boundary

- DA-031-promotion: unlock advisory presentation only after DA-030 passes the quality gate. The implemented panel remains a shadow result viewer until then; no automatic verification, synthesis selection, research skipping or model routing is permitted.
- Public deployment, authentication and multi-owner isolation remain held while the product stays on this computer.

