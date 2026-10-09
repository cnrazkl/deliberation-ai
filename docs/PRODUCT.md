# Product

The blue/navy brand mark uses three equally sized interlocking conversation loops.
Entry, account bar, workspace navigation and public help share the same scalable
asset; the browser tab uses the matching favicon. The emblem conveys multiple
perspectives without assigning an authoritative member.

## Blue/navy interface

Settings and council controls use spaced action groups, aligned checkbox/radio labels
and centered geometric disclosure icons. Original/candidate prompt choices occupy
separate cards; selection and submission semantics are unchanged. Private output
defaults retain explicit browser-local save/reset actions with separate fields/actions.

Before saving a new connection, **Modelleri getir** explicitly queries that provider's
catalog using the entered key/endpoint. It does not persist a connection or generate
an answer. The returned model selector updates only the starting-model field; manual
entry remains available. Changing provider/key/endpoint invalidates the transient list
and pending lookup. Saved connection catalogs still use their existing revision-bound
checks. Reasoning level stays per council member/model; transport protocol and output
format are progressively disclosed under advanced endpoint settings. Catalog presence
does not establish generation, payment or reasoning support.

All browser surfaces share a light blue light theme and a navy dark theme: account
entry/registration, workspace/history, connections/tools, scheduler, reports/evidence,
private branches, account administration and the public guide. Clear input boundaries,
readable secondary text, consistent primary/secondary/danger actions and progressively
disclosed advanced controls support first use. Existing risk, source and private colors
remain distinct; visual agreement never represents accuracy.

The pinned account bar provides help and an avatar disclosure for password change,
reviewed deletion and logout. Escape returns focus to the disclosure; outside click
closes it. Entry and root administration now expose the existing browser theme choice.
Theme changes, menu actions and workspace navigation do not send model requests or
reset active drafts. Existing explicit submit/review/deletion boundaries remain intact.

The signed-in account bar remains at the top during page scrolling. Desktop navigation
stays directly below it; the mobile drawer uses the same measured offset. History can
scroll within the available height. Conversation/run list refresh controls use a single
icon with their existing accessible names, tooltips, pending guards and read-only actions.

## In-app help

The public `/help` Turkish guide is linked as **Yardım** on login/registration and
the account bar for ordinary users/root. It opens separately to retain the workspace
draft. Twenty-six chapters cover first use, accounts, connections/presets, council
configuration/rounds, prompt/context preparation, files/library/evidence/research,
report/assessment/history/private branches, manual compaction, scheduler, settings/MCP,
risk/usage/export/deletion and troubleshooting. Chapters include examples and explicit
technical limits. Local search filters the topic index while retaining all articles;
anchors and related links navigate the guide. Print/PDF expands technical details
and restores prior collapse state afterward. Reading needs no account or API calls.
CLI-only experiments and pending human quality acceptance are labeled distinctly.

The owner-selected isolated homelab installation may be accessed from the private LAN
at its explicitly configured IP/port. Registration/login and exact Host/Origin/session
scope checks remain required; the Windows installation/data are not migrated.
Public/Cloudflare hosting remains a separate step. [Deployment boundary](NON_HUMAN_VALIDATION.md).

Opt-in non-human diagnostics can select the complete frozen comparison cohort in a
separate generated account/database. Failed/unobserved arms remain visible and model
accuracy remains unassessed. An isolated remote Docker rehearsal and sampled 30-day
operating observation are verification tools, separate from ordinary browser flows
and future public hosting. [Scope](NON_HUMAN_VALIDATION.md).

Local membership now offers registration, username/password login, logout and password
changes. Registration needs only a chosen username and password. Each user owns their
API connections and full workspace and can review/confirm complete account deletion.
Root retains legacy records but uses only user administration: list/edit accounts,
reset passwords, manage saved connections and review/delete ordinary users. Root cannot
read/create chats, run models or open the council workspace.
API keys are usable/editable through connection management but never displayed in
account summaries. [Use and scope](LOCAL_ACCOUNTS.md).

Account entry uses a responsive introduction and a clearly labelled form in both
light and dark themes. Username/password fields have visible borders, placeholders
and keyboard focus. Registration explains the username format and password minimum;
an accessible button reversibly reveals the entered password. Pending submission
disables entry/actions, and failures or successful registration appear inside the form.
Account-management/password-change fields use the same visible input treatment.

The signed-in workspace highlights the question composer with writing guidance,
placeholder, character count and its existing explicit submit action; detailed council
configuration follows the composer and remains reachable through **Konseyi düzenle**. API setup has
a separate first-step callout when no connection exists and leads the settings page;
appearance and advanced tools follow it. Navigation, form fields and action buttons
share clear styling across themes and screen sizes. Changing views preserves drafts
and makes no provider request. Root can filter the already loaded user list by username
or display name; user cards separate connection/edit actions from reviewed deletion.

An opt-in local synthesis command generates a claim-linked draft and asks a separate
model to check meaning against the complete supplied ledger. At most one repair is
allowed; failure preserves the deterministic ledger. Drafts remain model judgments,
with original minority/red-team claims and provenance intact. The workflow is local
CLI/export only; there is no new browser control. [Contract](REVIEWED_SYNTHESIS.md).

The separate local contradiction shadow command can call one hosted model against
frozen claim pairs; it cannot create production relations or certify truth. Frozen
round/prompt diagnostic studies dispatch selected source cases through the existing
council worker and retain every failed/unknown arm. Independent quality acceptance
remains pending. Terminal council runs with unfinished submitted receipts now appear
in the existing operator-decision controls, without automatic retry. Reported output
above a requested cap is preserved as a failure. [Scope](NON_HUMAN_COMPLETION.md).

Daily local startup runs the app in a hidden Windows session task, without separate
Node/Next terminal windows. Requested stop preserves the database/history. It adds
no automatic login/reboot/crash restart. [Operating contract](WINDOWS_SESSION_RUNTIME.md).

Local recovery supports a held read-only replacement, separately parked restored
jobs and verified return to the preserved original. Settings show separate private/
decision/probe backlogs, queue age and backup metadata with notices. Selected local
backup/export removal requires an exact review. [Operating contract](LOCAL_RECOVERY.md).

Settings connection cards now expose **Üretim testi ve model geçmişi**: versioned
per-model catalogs and a separately reviewed fixed generation test. Viewing never
generates; intent replay prevents an extra call. Rejections, unknown outcomes and
reported usage above the requested cap stay visible without billing or universal
capability claims. [Workflow](CONNECTION_GENERATION_CHECK.md).

Saved-backup rehearsal now distinguishes malformed queue targets, absent schemas,
missing records and recorded council/decision job links. Private branch existence
is separate from unchecked delivery receipts; counts permit no automatic recovery.
[Scope](RECOVERY_QUEUE_TARGETS.md).

Conversation cards now expose deletion review for populated history as well as
empty records. The same review guides separately confirmed private/run deletion,
then metadata removal, showing existing blockers and preserving the draft.
[Workflow and limits](CONVERSATION_CLEANUP.md).

Saved-backup rehearsal also shows queue job states and future start times for
council/private/decision work, with other queues counted separately. Inspecting
them resumes no jobs. [Scope](RECOVERY_QUEUE_INVENTORY.md).

Saved-backup rehearsal now separates council, decision and private operation
states, with copied private history and unavailable old schemas explicit. No work
is resumed automatically. [Scope](RECOVERY_OPERATION_INVENTORY.md).

Settings diagnostics now explain non-ready workers with running council work and
unknown council provider outcomes, retaining uncertainty and inspection guidance.
Refresh remains read-only. [Scope](LOCAL_DIAGNOSTICS_ALERTS.md).

The worker now checks logical migration history before starting queue/schedule work.
An incompatible or unreadable history blocks startup with a fixed explanation;
no automatic migration or restore is performed. [Scope](WORKER_MIGRATION_COMPATIBILITY.md).

Knowledge preparation now requires explicit search words, shows the existing limits
and explains a no-match result without confusing it with source access failure.
Blank input never reuses the council question. [Behavior](KNOWLEDGE_QUERY_FEEDBACK.md).

DA-126 now has an offline local measurement command. It preserves failed/empty
retrieval outcomes and cannot mark quality or cost acceptance complete. Application
behavior and provider consent remain unchanged. [Observed limitations](DA126_ACCEPTANCE.md).

DA-125 adds an explicit NVIDIA hosted connection preset, fixed hosted address and
conservative text-only settings. Manual model choice remains available without a
catalog. Pending hosted results remain unknown without automatic resend. Live
key/model acceptance is separate. [Contract](NVIDIA_PRESET.md).

DA-124 adds separately reviewed saving of approved/current candidates to an exact local collection and owner-selected manual handoff packets. Original provenance survives in immutable receipts; no claim promotion, automatic selection or external upload occurs. [Contract](EVIDENCE_PUBLICATION.md).

DA-123 adds an explicit claim-linked candidate inbox for owner submissions, stored
model citations and frozen local excerpts. Originals/conflicts remain inspectable;
human content and freshness decisions are separate. A citation alone cannot count
as verified source text; intake/review changes no claim evidence state. JSON inbox
export and existing reviewed run deletion cover candidates. [Contract](EVIDENCE_CANDIDATES.md).

DA-121 adds a bounded local source backend: selected TXT/Markdown/PDF/PNG/JPEG bytes,
encrypted immutable originals/extraction, page-linked manual quotes and inspectable
lexical search. Failed/unverified files retain status and cannot supply evidence.
Old quotes survive source updates; revocation blocks reads. DA-122 adds reviewed
library UI and council packet routing. [Contract](KNOWLEDGE_PACKETS.md).

DA-120 adds the backend [scoped knowledge foundation](KNOWLEDGE_SCOPE.md): owned local collections, explicit revisioned grants and encrypted conversation selections. Creation grants no retrieval; revoke invalidates old selections. Current topic/scope metadata remains inspectable in JSON/Markdown exports. DA-122 provides explicit local retrieval and reviewed packets; DA-119 human quality acceptance remains open.

**DA-119 preparation:** the owner accepted a local-first knowledge trial contract with
explicitly selected files and bounded evidence preparation; folder/ZIP import is deferred.
Offline source/format fixtures and blank independent review forms are prepared. No
extraction/retrieval UI or connector was implemented in that increment; independent
labels and real quality measurements remain open. [Scope](DA119_ACCEPTANCE.md).

**DA-118:** saved conversation reports offer council operation usage beside private usage,
with separate snapshot times. Retained deleted-run receipts contribute; missing histories
and counters stay explicit. This is not a combined monetary ledger. [Scope](CONVERSATION_COUNCIL_USAGE.md).

**DA-117:** Ayarlar can save a private output-cap default for this browser, with reset
to 1024. First-opened branches and new forks use it; open branch drafts and approved
receipts remain unchanged. [Contract](PRIVATE_DELIVERY_SETTINGS.md#da-117-browser-local-default).

**DA-116:** private output-cap drafts remain selected per branch while the panel is open,
across saving, replies, refresh and branch navigation. New forks and reopened panels
start at 1024. Every send still requires fresh review. [Scope](PRIVATE_DELIVERY_SETTINGS.md#da-116-draft-continuity).

**DA-115:** an optional conversation-wide private usage summary includes retained and
deleted-branch usage, counts each origin send once and marks missing provenance/model
or counters explicitly. A manual fetch shows its snapshot time. [Scope](CONVERSATION_PRIVATE_USAGE.md).

**DA-114:** an expandable private-branch usage summary counts its own sends, excludes
copied receipts and shows provider-reported counters with missing-value coverage.
Cache/reasoning conventions remain separate. [Scope](PRIVATE_USAGE.md).

**DA-113:** private model sends offer a reviewed 128/256/512/1024 output-token cap.
Changing it clears approval; encrypted receipts retain the exact cap and retries cannot
change it. The draft defaults to 1024 when reopened. [Scope](PRIVATE_DELIVERY_SETTINGS.md).

**DA-112:** forms adapt to the available workspace column, including narrower screens
and magnified content. Attachments expose a visible **Dosya seç** action; long names
wrap, and mobile controls remain usable. [Responsive design](UI_DESIGN.md).

**DA-111:** the owner-requested workspace opens in a simpler Sohbet view. Conversation/run history stays in a left sidebar; Zamanlayıcı groups scheduling and linked latest outputs, and Ayarlar contains provider/MCP/worker details. Navigation preserves drafts. Detailed task controls open on demand; light, dark and system themes share semantic colors and persist appearance locally. [Design principles](UI_DESIGN.md).

**DA-109:** **Konuşmayı indir (MD)** exports retained history, raw replies, private branches
and missing-content notices. **Sentezi indir (MD)** exports included/unresolved/omitted
claims with minority/red-team provenance. Downloads preserve drafts and start no generation;
JSON remains available. [Scope](MARKDOWN_EXPORTS.md).

**DA-108:** saved council templates use durable creation identities and reviewed deletion beneath the selected card. Acknowledgement clears that reusable configuration; current drafts, frozen runs and schedules remain. Lost responses can be retried safely, deleted identities remain blocked, and a fresh identity can reuse the name. [Contract](COUNCIL_TEMPLATE_LIFECYCLE.md).

## Reusable topic libraries — original proposal and current acceptance

DA-120–125 implement the local scope/source/packet/review/save foundations and the
NVIDIA preset. DA-126 now provides the partial diagnostic above; independent quality
and supported rollout remain open. The paragraph below records the original proposal.

The owner requests exact notebook selection per conversation, including multiple notebooks, with security, quality and maintainability first. Propose local reusable collections and bounded source-linked excerpts; large/repeated files need not depend on an external service. New evidence is reviewed before reusable save or separately authorized external publication. Unofficial NotebookLM bridges and Notion are excluded; official NotebookLM is deferred until stable required capabilities are verified. Other adapters are optional and must pass admission tests. Small inputs and the distinct NVIDIA proposal remain. Pending implementation in DA-119–DA-126. [Proposal](KNOWLEDGE_SOURCES.md), [worked examples](evaluation/KNOWLEDGE_SOURCE_SCENARIOS.md).

**DA-104:** Pending clarification tasks now offer a read-only draft deletion review and separate acknowledgement. Confirmed deletion clears the stored question/request while retaining a content-free tombstone; existing runs and the main council draft remain. Original-intent replay is refused. [Contract](PREFLIGHT_DRAFT_DELETION.md).

**DA-103 maintenance:** the Next lint dependency finding is removed from the current graph while preserving lint settings; product/provider/data behavior stays the same. Full dependency audit and local compatibility checks pass. Next bounded product work is reviewed preflight draft deletion. [Evidence](DA103_ACCEPTANCE.md).

**DA-102 functional scope:** reviewed removal of one owned terminal run body is available before retention age. Copies, unresolved provider work, the live worker fence and schema/ownership drift block deletion. Content-free usage/intent audit and conversation membership remain; independent billing, preflight/schedule inputs and external copies remain. Decision aggregates are excluded. The original dependency gate is resolved by DA-103. [Workflow](RUN_DELETION.md), [verification](DA102_ACCEPTANCE.md).

**DA-101:** the owner can review and confirm deletion of one private branch's stored content. Copies must be removed separately first; queued/submitted/unknown work blocks deletion. Content-free encrypted usage/provenance and replay records remain, as do source reports and external backups/exports. Cancelling preserves the draft; confirmed deletion preserves unsaved text separately in the current page. This is not complete conversation/account erasure. [Workflow](PRIVATE_BRANCH_DELETION.md).

**DA-100:** reviewed native Gemini private text is available for matching source connections with default reasoning/search off. The owner reviews the same saved text/order before one durable submission. Candidate-output, separate thought tokens and reported total retain native conventions; textless cap failures and unfinished candidates never trigger automatic resend. Thought signatures are excluded from retained text history. Broader settings, erasure/accounting and real-cloud/model acceptance remain open; earlier provider-absence notes are historical. [Workflow](PRIVATE_BRANCHES.md#da-100-native-gemini-generatecontent).

**DA-099:** reviewed private replies now also support native OpenAI Responses with default reasoning and search off. Reviewed text history, provider matching and durable intent controls remain in force. Inclusive cache/reasoning counters, truncation and metered-but-textless failure are explicit; remote pending work stays unknown until acknowledged closure. Gemini, other settings, private erasure and live/model-quality acceptance remain open. [Workflow](PRIVATE_BRANCHES.md#da-099-native-openai-responses).

**DA-098:** reviewed private send/reply also supports Claude/Anthropic source members with default reasoning and search off. Exact input, provider matching and durable intent controls remain in force. Truncated replies are visible; native uncached-input and cache counters are labelled separately. Native OpenAI/Gemini, other settings and private erasure remain open. [Workflow](PRIVATE_BRANCHES.md).

**DA-097:** saved private owner messages can be explicitly reviewed and sent to a supported OpenAI-compatible source model. Exact input/connection review, conservative risk blocking, bounded permanent request slots, durable unknown outcomes and observed usage remain separate from council authority/billing. Opening/saving drafts stays idle. Other providers/settings and private-content deletion remain open. [Workflow](PRIVATE_BRANCHES.md).

**DA-096 draft foundation:** a saved successful member reply can seed an owner-reviewed private branch. Owner message drafts are encrypted and immutable; forks copy a saved prefix and progress separately. Branches reopen through **Kayıtlı konuşmalar** after source retention and enter explicit plaintext exports. Drafts are not sent to a model. Actual private chat and private-body/copy deletion remain open. [Workflow](PRIVATE_BRANCHES.md).

**DA-095:** metadata-only entries in **Kayıtlı konuşmalar** offer **Kayıt silmeyi incele**. The owner sees the exact identity and membership count, reviews which backup/export copies remain, and separately confirms deletion. Retained bodies, source references, ownership/indexing problems and changed snapshots block removal. Preview/cancel preserves the draft and sends no generation. This does not delete available conversations or model-private messages. [Policy](CONVERSATION_DELETION.md).

**DA-094, local acceptance verified:** a standalone **Kayıtlı konuşmalar** panel discovers owned conversations without first finding a run. It lists newest-created conversations in 20-item pages, shows saved and unavailable content counts, and opens the latest accessible run while preserving the new-run draft and model choices. Conversations whose bodies were pruned remain visible with opening disabled. Refresh/retry does not generate a model request. The primary installation passed local checks. Saved-run history also rejects late older-page responses after refresh, preserving the current list and draft. [Contract](CONVERSATIONS.md), [review](REPO_AUDIT_2026_10_02.md).

DA-093 adds durable **run-based conversations**. Continued questions and member reruns share their source's conversation identity even after ancestor content is pruned. The conversation panel lists members and downloads all recorded branches, raw reports and frozen delivery/private archives in one bounded plaintext JSON snapshot; unavailable bodies and legacy reconstruction limits remain explicit. Opening/exporting preserves the draft and starts no generation. [Workflow](CONVERSATIONS.md).

DA-092 adds **run branch navigation**: previous sources, same-source siblings and direct children with full-history, compacted-history and member-rerun labels. Links open saved results without changing the new question draft or starting generation. Missing sources remain explicit, with surviving siblings accessible. Conversation identity, branch editing and conversation-wide export remain open. [Workflow](RUN_BRANCHES.md).

DA-091 adds **reviewed manual history compaction**. The owner writes a summary, reviews the full original and a list of replaced report/history sections, and then previews the new council input. Editing the summary clears review. Source question/provenance and original risk controls stay explicit; a private encrypted original retains raw/minority details after source deletion and is excluded from provider calls, including later full-context descendants. Details/JSON export distinguish delivery from archive. Summary fidelity is not certified. DA-092 adds run branch navigation; conversation-wide export remains open. [Workflow](CONVERSATION_COMPACTION.md).

DA-090 lets the owner review a completed/partial report's copied question and full report, then continue with a new question. All members answer anew; historical minority/raw outputs stay inspectable and the source report remains intact. The normal preview includes historical input estimates and risk controls. Oversize history is refused visibly. Prior attachments, memory/tool inputs and external evidence records are not separately replayed. DA-091 adds reviewed manual compaction; DA-092 adds run branch navigation; conversation-wide export remains open. [Workflow](CONVERSATION_CONTINUATION.md).

DA-089 compares current invoice evidence with owner-reviewed exact-invoice payments/refunds. Selected source bytes, unique transaction/line ids, allocation, review dates and exact net amounts are checked locally; missing sources and stale invoices deny a complete result. Provider/bank authenticity and actual payment status remain unknown. The operator command writes nothing and initiates no payment/refund. [Workflow](BILLING_PAYMENT.md).

DA-088 adds read-only invoice inspection across declared connections. The owner binds reviewed current statement versions and account mapping reasons; the inspector detects duplicate invoice lines/responses, date/provider drift and exact total differences while keeping shared charges separate. Account identity remains owner-declared, authenticity unverified and payment unknown. [Workflow](BILLING_ACCOUNT.md).

DA-087 lets the owner correct a wrong invoice-line or call identity through an explicit reviewed reallocation. The original evidence/history remains visible; one new attribution contributes to the subtotal. The old call returns to pending if its charge is no longer attributed there. Operator commands perform the change, and the usage panel shows both directions with reasons. [Workflow](BILLING_REALLOCATION.md).

DA-086 saves owner-reviewed statement packets and shared charges as immutable encrypted versions. Corrections and withdrawals preserve earlier evidence; reopening shows a separate check of whether the current billing ledger still matches. Withdrawal is not a refund or zero-spend claim. Entry and inspection use local operator commands. [Workflow](BILLING_STATEMENT_HISTORY.md).

DA-085 adds read-only owner-reviewed statement inspection: compare a declared total with version-bound attempt lines and separate shared charges, flag missing known records and retain unknown authenticity/payment. This is local technical reconciliation, with no change to run subtotals or dispatch. [Workflow](BILLING_STATEMENTS.md).

DA-084 adds append-only replacements and voids for the same reviewed billing attribution. The original amount/source remains inspectable; only the current valid amount enters the subtotal. Voided calls return to pending billing because withdrawal is not a provider refund. The owner sees reasons/history and cannot silently change the call or invoice-line identity. [Workflow](BILLING_CORRECTIONS.md).

DA-083 adds owner-reviewed billing evidence for an exact submitted attempt. The usage panel separates its recorded subtotal and pending/mismatched coverage from token estimates. Document digests, receipt matching and component arithmetic are checked locally; document contents and provider/payment authenticity still require review. No real invoice has been imported. [Operator workflow](PROVIDER_BILLING.md).

DA-082 shows auditable token estimates for new calls with a current owner-entered price observation and complete compatible usage. Each attempt retains its price version; a replacement never rewrites earlier calculations. The panel separates calculable token subtotals from unavailable attempts and exposes component rates/fingerprints. Price entry currently uses local operator commands. Invoice settlement and monetary ceilings remain open. [Policy](PROVIDER_PRICING.md).

DA-081 adds optional, frozen council generation limits: submitted-call count, per-call output cap and cumulative reserved output capacity. Reservations survive failures, unknown outcomes, discard and retry; actual provider usage stays separate. Schedules receive a fresh allowance per occurrence, and a selected-member child inherits the configuration with a fresh run allowance. These are local dispatch controls; monetary, input-token and tool-charge ceilings remain open. Local acceptance verification passed on 1 October 2026. [Verification evidence](REPO_AUDIT_2026_10_01.md). [Execution limits](EXECUTION_LIMITS.md).

Saved-run usage shows observed provider total/cache/reasoning/tool-input counts with reporting completeness and native input/output conventions. Missing counts stay unavailable, including older receipts; these are not prices or spending limits. Invalid-output responses can still report usage. [DA-080 scope](PROVIDER_USAGE_DETAILS.md).

DeliberationAI lets one owner submit a question to a council of 2–6 model members. Round 0 is independent. Later reviews may challenge claims and propose revisions, but no model is an authority and agreement is never presented as proof.

After a completed remote council, the owner can [rerun one selected member](MEMBER_RERUN.md) in a separate follow-up. The other first-round answers are frozen copies, while the chosen member and any selected cross-review rounds make fresh provider calls. The old result stays available; the new result shows copied provenance and the planned call upper bound before the owner starts it. The regenerated claim ledger is not a semantically validated final answer.

The owner may opt into bounded self-revision during a selected cross-review round. A reviewer then sees its own unchanged first-round structured answer and may suggest up to five qualifications or withdrawals, each linked to an original claim and carrying a reason. These are visible alongside peer reviews; the original claim and any minority/red-team view remain in the report. Suggestions are not promoted into verified facts or an automatic final answer. The option can add input/output tokens and is unavailable with zero review rounds.

For a few concrete legal, medication-dose and tax decisions, the local preflight can ask for critical missing details before any model job exists. The owner can add context, explicitly keep the original question, or cancel; after a reload the pending task remains available. A new preview shows the exact first-round text, token estimate and effective risk before starting. This is [a bounded lexical workflow](MISSING_CONTEXT_PREFLIGHT.md), not a guarantee that all necessary facts were identified or supplied.

The owner can also compare the unchanged question with an optional, editable structured candidate before the first round. The local candidate keeps the question verbatim and adds a short response frame; the interface shows additions and recalculates the first-round preview after a choice or edit. The accepted revision and its mechanical audit are encrypted with the run. This is [revision control](PROMPT_REVISIONS.md), not a model-optimized or empirically superior prompt.

The [offline prompt-comparison preparation](evaluation/PROMPT_COMPARISON.md) freezes paired source-bound questions and blank independent semantic-drift worksheets. It has no live optimization control or accuracy claim; human review and paired model/output measurement are pending.

A local operator can retrospectively inspect saved review rounds with a [read-only early-stop shadow command](evaluation/EARLY_STOP_SHADOW.md). It shows why exact output repetition cannot yet justify ending a council early. The running product continues every selected review round unless an existing failure barrier or the selected round ceiling ends it.

The first broad correctness package has [an independent acceptance workflow](evaluation/COUNCIL_CORRECTNESS.md): externally sourced candidate questions, human labeling/adjudication, persisted source-bound run measurements and held-out recall gates. Its full human/model-quality study remains pending. An opt-in hosted contradiction CLI is shadow-only; the running UI continues to expose owner-authored relations. Limited diagnostic runs are recorded separately and do not attach a factual-accuracy badge to ordinary reports.

## First acceptance slice

The original local acceptance slice used 2–6 deterministic fake providers and no API key. Those adapters remain for automated tests and historical runs, while the owner-facing council now uses saved provider connections. A run retains the original question, immutable member configuration, raw and parsed outputs, claim occurrences, shared claims, distinct claims, failures, and provenance. Any configured member failure makes the run partial; one successful member is a partial single-model result, not council consensus.

After a run has a terminal report, the owner can explicitly download a versioned JSON snapshot of the question, selected risk profile, prompt version/fingerprint, counts and complete report, including raw model text and claim provenance. The export excludes connection credentials, internal queue/idempotency keys and attachment file bytes. The downloaded file is plaintext and should be handled as sensitive; it is a single-run report, not conversation history or a complete database backup.

The local “Son çalışmalar” panel lists the newest saved runs in bounded pages. The owner can reopen a run after refreshing the page, inspect its current or final state, and download an existing report. Opening a past run does not replace the draft question, selected models or attachments in the task form, and it does not send any new model request. This is access to separate saved runs, not a conversation that carries prior context into future runs.

For an open run, the UI separately shows input/output token counts returned by providers for each recorded attempt and the sum of available counts across rounds and retries. Missing counts stay marked “bildirilmedi”; ambiguous or failed attempts remain visible because they may have been billed. These are reported tokens, not an invoice, a price calculation or an enforced spending limit. Deterministic test providers normally return no usage count.

Local retention is an operator action, not an automatic background deletion. `pnpm db:prune` previews how many of the local owner's terminal runs finished before the configured cutoff; runs with an unresolved provider or decision attempt are withheld even if their parent is terminal. `pnpm db:prune:apply` explicitly removes eligible runs, their dependent database records and recorded queue jobs in one transaction. A schedule that pointed to a deleted run remains but loses that last-run link. This is separate from single-run export and is not a backup, deletion of old backup/export files or a full account-deletion workflow.

The operator can create a local database archive with `pnpm db:backup`. Its manifest becomes discoverable only after checksum, disposable-database restore and decryption of every non-null encrypted database field succeed. The verifier also rejects an unrecognized encrypted column and checks encrypted JSON can be parsed. `pnpm db:backup:rehearse` reports restored run/operation status counts and active schedules for manual recovery planning. The archive stays local and does not contain `.env.local`, which must be preserved separately. This verifies stored encrypted fields in the backup artifact and surfaces work to reconcile without replacing the running database or proving a full disaster-recovery cutover.

The local “Yerel çalışma durumu” panel shows whether this browser can read the database, whether a worker has sent a recent heartbeat from a still-connected database session, and owner-scoped counts of queued/running runs, unresolved provider attempts and active schedules. It refreshes every 30 seconds and on demand without calling a model. A recent heartbeat is an operational signal, not proof that every queued job will complete or that a provider connection works. If the database cannot be read, the panel shows an error instead of reporting everything as healthy.

When a provider returns text that cannot pass the council output contract, the member remains failed and contributes no claims. The returned text is retained encrypted and can be expanded under that member's failure, including after a worker restart. The same applies to a failed cross-review. The partial report names failed reviews and warns that claim extraction completeness is unknown. This makes the information loss visible; it does not extract missing claims, make the text trusted, or convert the failure into a completed review.

Analyst claims enter the shared projection only when the same normalized statement comes from at least two distinct selected model identities. Repeating one model through multiple seats or connections preserves every occurrence but does not manufacture independent agreement; repeated demo perspectives follow the same rule. This is a conservative identity check based on selected model ids, not a guarantee that differently named models are independent. Existing reports are reclassified from their frozen member configuration when read; their claim ids, evidence annotations and coverage choices remain intact.

If analysts attach an `objection` classification and another classification to the same normalized statement, the group stays under different views even when multiple model identities repeat the text. The UI shows both member attributions and says why it was withheld from shared ground. This is a classification disagreement, not proof that the underlying propositions logically contradict one another. Historical reports are reclassified on read without erasing owner annotations.

The Phase 0b gate was satisfied by PostgreSQL persistence, a separate pg-boss worker, restart recovery, cancellation, cursor-replayable progress, integration tests, and a Playwright browser flow. The product remains local and single-owner.

## Outside the first acceptance slice

The original Phase 0b slice excluded live providers, evidence retrieval, MCP, multimodal input and schedules. The local increments below now implement the bounded forms documented here. Public SaaS, automatic evidence verification, broad autonomous research and claims of current legal correctness remain outside the product.

## Local Phase 1 increment

The owner may store multiple encrypted OpenAI, Anthropic, Gemini, and OpenAI-compatible connections. Kimi, Qwen, vLLM, Ollama, LiteLLM, OpenRouter, and custom endpoints use the compatible family. A saved connection may remain idle and only supplies a reusable credential, endpoint, and starting model. Every member selects a connection, exact task model, optional reasoning level, and supported web-search mode; a single council may mix provider families. There is no local demo-mode switch in the owner-facing UI. Provider output must satisfy the same claim schema, ambiguous outcomes must not be retried automatically, and enabling a real provider does not make the system an authority.

The owner can explicitly inspect one saved connection's model list. This read-only catalog request never generates an answer; returned model ids become optional suggestions in task member fields without changing the selected model. A response from an official native-provider or OpenRouter user-filtered catalog endpoint indicates that the list request was authenticated. Custom URLs and other compatible `/models` replies may be public and do not establish key validity. Any catalog result is separate from generation availability, reasoning-level support and pricing; an unsupported list endpoint leaves manual model entry available.

When an official catalog supplies model metadata, the selected task-model field also shows the reported display name, token limits, context window or reasoning signals that are actually present. Claude's catalog can name individual supported effort levels; Gemini's `thinking` field and OpenRouter's parameter list do not specify which UI levels work. OpenAI's list currently provides no such level map. The latest observation is timestamped and stored encrypted with its connection so it returns after a page reload. Editing clears the latest suggestion snapshot while preserving bounded versioned history; a check started before the edit cannot overwrite the new configuration. Catalogs never disable a manually chosen level, change a connection, estimate price, or prove generation success. The separate reviewed generation check records only the selected model and fixed request.

When the owner sets a member's web-search mode to automatic, native OpenAI, Anthropic, Gemini, and OpenRouter adapters include their bounded provider-native search tool. The model decides whether to use it. Provider-returned source links remain labeled citation provenance; they do not become verified evidence or enter the owner's evidence library automatically. Compatible endpoints without one stable search-tool contract keep this setting unavailable.

Before submitting a task, the owner sees approximate tokens in the written question, selected PDF text and images; an empty question shows zero rather than counting hidden instructions as user input. A separate initial-round council estimate and per-member breakdown includes the council instructions, selected member roles, memory/tool context and attachments for members explicitly opted in. It does not call or charge any provider. Provider-specific image processing, structured-output framing and tokenizer differences can change actual usage; generated responses, reasoning, provider web search and later review rounds cannot be known before execution and are excluded. A task can contain up to six JPEG/PNG/WebP/GIF images or selectable-text PDFs in total, capped at 2 MiB per image, 5 MiB per PDF and 12 MiB combined. A PDF is locally converted to at most 64,000 characters of page-marked text; scans without selectable text are rejected until OCR is available.

The owner can expand a per-member preview of the first-round system instruction and user text, including selected PDF/context text only for the intended recipients. The displayed prompt version and a fingerprint of the rendered request settings are checked again at submission and before worker execution. Changed context requires a new preview; a queued mismatch fails without a model call. This is a review of the existing prompt, not automatic prompt rewriting, a prediction of provider-internal framing, or a preview of later rounds.

## Bounded cross-review increment

A run may request zero to three cross-review rounds; one is the default and high-risk runs require at least one. After round 0 completes, each successful member receives the validated summaries and claims of the other successful members. Rounds 2–3 begin only after the preceding round has completed and share one frozen set of its successful validated reviews. No reviewer receives its own round-0 answer, another provider's raw response, or an unfinished same-round review. A failed or incomplete review round stops later rounds. Every assessment identifies its target member and records `support`, `qualify`, or `challenge`; these stances remain inspectable observations and do not become a truth or majority score. Additional rounds make additional provider calls and may add cost; their effect on answer quality has not been measured.

The canonical claim ledger remains based on independent round 0. Reviews are additional diagnostic observations, not automatic revisions to the original claims or a new final answer. The [offline round-comparison preparation](evaluation/REVIEW_ROUND_COMPARISON.md) can verify matching saved runs and show reported usage/time; its accuracy field stays pending until independent output review exists.

After each cross-review attempt, the owner can expand the application-generated instructions and input for that reviewer and round, including the actual successful peers and prior-round reviews when applicable. These strings are saved with the encrypted report and remain available when the run is reopened or explicitly exported. A failed review may have stopped before network submission, so the display does not claim delivery; older reports without saved review prompts are labeled unavailable instead of reconstructed with newer rules. Provider-hidden framing is not included.

## Red-team increment

Each member has an explicit `analyst` or `red-team` council role, and every council must retain at least one analyst. Red-team members receive instructions to test assumptions, counterexamples, failure conditions, and irreversible risks without acting as a judge. Their claims are preserved in a dedicated challenge projection and excluded from analyst shared/distinct grouping. Their cross-review assessments remain labeled with the reviewer role.

The configuration screen also provides a one-action red-team comparison control. Enabling it adds an independent red-team member when capacity permits, or converts the final member when the council already has six members. The owner can still edit that member's connection, model, reasoning level, web-search mode, name, role and perspective. The report places the complete analyst ledger beside the complete red-team challenge ledger and reports red-team cross-review challenge counts. This is a presentation comparison only: it does not infer semantic pairing, agreement, a winner or a truth score.

## Evidence-state increment

Every grouped claim starts as `unsupported`, including claims repeated by multiple models. The owner may explicitly mark it `model-supported`, `externally-verified`, `contradicted`, or `stale`. The state is a durable human annotation, not an automatic truth score; this increment does not retrieve, store, or validate external sources.

## Synthesis-coverage increment

The report includes a non-authoritative synthesis-coverage ledger. Shared analyst claims start `included`; distinct analyst claims and red-team challenges start `unresolved`. The owner may explicitly set any claim to `included`, `omitted`, or `unresolved`. Omitted and unresolved claims remain visible with provenance, and no model acts as a synthesis chair.

The report also displays a mechanical transfer audit: every structured claim returned by a successful member must appear exactly once in the analyst or red-team projection with its member, kind, statement and quote intact. The owner can record a bounded scope note on a claim and an explained `supports`, `contradicts`, `qualifies`, or `different-scope` relation between two report claims. These are owner interpretations, separate from source-backed evidence and synthesis coverage. The audit does not establish whether the models found every important claim in the question or attachments, and a relation is not an automatic semantic or factual judgment.

The result also has a `report-quality-v1` mechanical assessment, recalculated when a saved report is opened or its evidence/coverage annotations change. It distinguishes completed processing from validated meaning, flags a broken claim ledger and visibly counts unresolved, omitted, adverse-evidence and included-but-not-externally-verified claims. A sound ledger is the deterministic fallback display; a broken one explicitly requests source review. There is no free-form synthesis to certify, semantic validation has not run, and the assessment never marks factual correctness as passed.

The default profile is **automatic, at least standard**. DA-069 applies a visible Turkish/English rule floor to the question and delivered PDF/memory/tool text; uninspected images conservatively require high controls. The owner can raise the profile but cannot lower a matched rule. A button adds the missing red-team/review setup for inspection before submission. The server applies the same floor to immediate runs and schedules, and stores an encrypted assessment with each new run. A high-risk report is complete only when red-team succeeds, every successful member reviews every other successful member, no required review fails, and structured claims transfer intact. Otherwise the report is partial or failed. These lexical rules can miss indirect risks and flag general quotations; no-match is not a safety judgment, and passing controls is not factual correctness or professional approval. See [the preflight scope](RISK_PREFLIGHT.md).

## Bounded shared-memory increment

The owner may explicitly copy up to 20 claim snapshots into local shared memory and explicitly select at most 5 for a later run. Selection is per run and defaults to empty. The chosen text, source type, and evidence state are frozen with the run and shown to every member as historical, potentially stale or unsupported context that is neither a fact nor an instruction. Removing a library entry does not change a run that already froze it.

## Source-backed evidence increment

The owner may attach up to 10 encrypted source records to a claim, including a title, URL, relation (`supports`, `contradicts`, or `context`), review note, required source excerpt, and optional publication date. The server records capture time; the encrypted excerpt, publication date, and capture time are immutable. Content review moves explicitly among `unreviewed`, `verified`, and `rejected`, while freshness review separately moves among `unreviewed`, `current`, `needs-review`, and `stale`. The application does not fetch the URL or decide credibility or freshness. A claim can become externally verified only with a verified, currently accepted supporting source and contradicted only with a verified, currently accepted contradicting source. A source required by the current claim state cannot be downgraded or deleted until that state changes.

## Optional source-support assistant

The owner now has a separate JEV panel for a selected claim and immutable source excerpt. Saving a TypeSafe connection does not contact the provider. Assessment creation requires a completed run, one specific source snapshot, an explicit checkbox acknowledging that the selected claim and excerpt leave the computer, and the global decision-worker switch. That switch defaults off. Results are presented as shadow observations with all class probabilities, exact rubric/model versions, the original excerpt, stale-state detection, and a warning that provider confidence is not correctness.

The assistant cannot mark evidence verified, choose the final answer, hide minority claims, certify source freshness/credibility, or authorize research and tools. No flag means no conclusion about correctness. Advisory promotion remains unavailable until the Turkish-first live comparison in [EVALUATION](EVALUATION.md) passes; a failing or inconclusive pilot keeps the feature off or in shadow mode. The boundary is defined in [ADR-0017](adr/0017-advisory-decision-evaluation.md).

## Application-managed research retrieval

For a completed claim, the owner may explicitly ask the application to fetch one public HTML, plain-text or selectable-text PDF URL. An optional isolated browser mode can capture text created by page JavaScript. The application blocks local/private/reserved network targets and nonstandard ports, validates every DNS answer and redirect, pins every allowed browser request to a checked address, and limits duration, redirects, response bytes, browser resources, PDF pages and extracted text. The requested and final addresses, readable text, capture metadata and content digest are stored as one encrypted snapshot.

Every capture begins as unreviewed research material. It cannot change the claim, run, synthesis or JEV state. The owner must inspect the captured plain text and select a verbatim excerpt before creating a normal evidence-source record; that new record still begins with content and freshness unreviewed. Provider-returned citations never enter this path automatically. Image-only PDFs require OCR and are rejected; media and authenticated pages remain outside this increment. See [ADR-0018](adr/0018-application-managed-retrieval.md).

## Task attachments

A run may freeze up to six JPEG, PNG, WebP, GIF or selectable-text PDF files. The browser shows each selected file and any rejection reason; additional selections append to the current list. Each member has a separate task-level consent switch. Consenting members receive image bytes and locally extracted, page-marked PDF text in round 0; non-consenting members and cross-review receive neither. The feature supplies model input only and does not perform OCR, evidence promotion or tool authorization.

## Local MCP results

The owner may connect a loopback Streamable HTTP MCP server, inspect its current tool list and explicitly invoke one tool. Bounded encrypted text results form a small local library. At most three are selected manually or by deterministic word overlap and frozen as untrusted round-0 context. Models cannot invoke tools or choose arguments. See [ADR-0019](adr/0019-local-mcp-result-boundary.md).

## Local schedules

The owner may freeze the current question and complete council configuration as a daily or weekly schedule. It starts paused and runs only after explicit activation while the local worker is available. Pause and delete controls remain visible, and every occurrence creates an ordinary durable run with the same provider receipt protections. See [ADR-0020](adr/0020-local-schedules.md).

## Offline council coverage evaluation

The local evaluation library can compare human-authored, source-anchored gold claims with persisted council reports without contacting a provider. An offline labeling gate requires two separate review sheets and an explicit third adjudication before it assembles a frozen corpus; every review claim must be resolved. A frozen 40-question candidate intake uses authentic local project-document excerpts. Two separate local worksheets let humans enter material claims and exact source quotes; a third worksheet appears only after both reviews are complete and requires an adjudicator to link or reject every claim. Compilation refuses changed or incomplete inputs and derives evidence offsets before emitting a corpus and manifests. The candidate has no completed human gold claims, adjudication, representative external sources or model predictions. These are structural preparations, and the application does not display a model-accuracy score to the owner.

## Checked model selection and inline connection editing (DA-105/DA-106)

A successful model-catalog check exposes its model IDs in a connection-card dropdown, refreshed after every completed check. Selecting an ID opens a default-model edit draft; the owner saves it with “Bağlantıyı güncelle”. Existing council member model choices remain unchanged. Unlisted models can still be typed manually. Editing opens directly inside the selected card; only one edit form is active. Cancelling discards its unsaved fields. Saving invalidates the catalog for the revised connection, requiring another explicit check. Catalog availability is not generation or capability verification.

## DA-107 reviewed local schedule deletion

Recurring schedule deletion now requires a paused-template preview and explicit content/retained-run acknowledgement. The review opens beneath the selected card. Lost-response creation retries reuse a request identity; template removal keeps already queued and historical runs. [Contract](LOCAL_SCHEDULE_DELETION.md), [ADR-0032](adr/0032-reviewed-local-schedule-deletion.md).

## DA-122 reviewed local source packets

DA-122 adds explicitly selected local collections, file intake and owner-reviewed bounded source packets. Exact quote/version/page/span and exclusions are visible before sharing with every independent first-round seat. Unsupported OCR/images remain unavailable; no source becomes verified automatically. [Packet contract](KNOWLEDGE_PACKETS.md).

The source disclosure guides collection setup/selection, file intake and packet review
in three numbered sections. Labels, actions and collection cards align and stack in
narrow workspaces; long names/excerpts wrap. A Turkish file-selection button keeps
the existing selected-file intake and destination/permission limits. File extraction
status, coverage/exclusions, explicit review and optional packet-free continuation
remain visible; opening the panel does not fetch sources or contact a model.
