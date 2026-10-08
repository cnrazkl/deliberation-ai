# Security

Reviewed synthesis requires an exact frozen fingerprint and explicit live flag.
Owned source/connection revisions are revalidated before and after each attempt.
Context-bound encrypted local plans, execution claims and immutable phase receipts
are written/flushed before dispatch; interrupted submissions cannot be resent.
Only bounded claim/annotation/review data is shared, not raw answers or source files.
Local preview/explicit Markdown export are plaintext independent copies outside
database backup/retention. No sensitive content or credentials reach general logs.
[Boundary](REVIEWED_SYNTHESIS.md).

8 October maintenance updates runtime Next.js to 16.3.8 after six advisories were
observed in 16.3.6. The reviewed 16.3.6 lint plugin/alias/patch remains independently
pinned and checked. [Security evidence](DEPENDENCY_SECURITY_2026_10_08.md).

The Windows session task binds the checkout/action/current owner SID and refuses
altered definitions. It runs with limited interactive rights, no automatic trigger
or restart and no stored account password. Task arguments contain paths only;
existing private configuration is read at runtime. Stop/removal retain data and
the exact process-identity guard. [Boundary](WINDOWS_SESSION_RUNTIME.md).

Replacement uses a separate authenticated loopback cluster and exact current/archive
checks without overwriting the owner DB. Changed clones survive failed rollback.
Selected local unlink binds path/hash review to encrypted replay-protected receipts,
protects newest backups and refuses redirected roots/keys. Unlink is not secure
erasure. [Operating and external-copy boundary](LOCAL_RECOVERY.md).

Connection reviews are owned/no-store; explicit POST/PATCH reject foreign origins
and strictly validate streamed bodies up to 2 KiB. Encrypted submitted identities
prevent replayed provider calls. Fixed input excludes owner content; provider raw
output/error bodies never enter history/logs. Redirects are refused; response bytes
are bounded to 64 KiB. Unacknowledged submitted/unknown receipts block removal;
expired uncertainty can be acknowledged without a call. Timeout/requested caps do
not certify remote cancellation, enforcement or charges.
[Boundaries](CONNECTION_GENERATION_CHECK.md).

Restored target reconciliation reads required payload identifiers only within SQL
for shape checks/metadata joins. Only fixed aggregate categories/statuses escape;
no job/target/owner identifiers, payloads, outputs or private ciphertext are exposed.
Errors hide database details; inspection authorizes no dispatch or owner mutation.
[Scope](RECOVERY_QUEUE_TARGETS.md).

Conversation cleanup discovery returns only bounded owned body/branch identities.
It reads no additional ciphertext and authorizes no deletion by itself; each reused
content/metadata mutation retains its existing snapshot, owner, worker and copy
guards. Separate confirmations never automatically cascade to dependent copies.
[Scope](CONVERSATION_CLEANUP.md).

Restored queue inspection selects aggregate states/timing only, excluding job
payloads, outputs and IDs. Unknown queue names are collapsed into a fixed `other`
category; errors expose a fixed message. It starts no queue service or worker.
[Scope](RECOVERY_QUEUE_INVENTORY.md).

Saved-backup recovery inspection exposes only aggregate decision/private states.
Private bodies use the existing authenticated bounded decoder; invalid data emits
a fixed error without content, identifiers or underlying database/parser details.
It runs only in the temporary restored database and starts no dispatch.
[Scope](RECOVERY_OPERATION_INVENTORY.md).

Worker migration mismatches/database-read errors expose only a fixed explanation
and class name before queue startup. Logical history matching does not certify DDL,
SQL hashes, restored job reconciliation or historical executable safety.
[Scope](WORKER_MIGRATION_COMPATIBILITY.md).

6 October 2026 dependency maintenance: MCP client/core 2.2.0 and transitive sharp
0.35.5 replace affected versions without overrides or suppressions. The
[MCP OAuth advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h) and
[sharp/librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) prompted
the update. Existing loopback-only MCP policy remains; passing dependency audit
does not certify full application security or live connector acceptance.

Knowledge query feedback exposes only public limits. No-match feedback is emitted
after owned selection/grant checks; missing/foreign/revoked scopes retain generic
access errors without source existence/content hints. [Boundary](KNOWLEDGE_QUERY_FEEDBACK.md).

DA-125 fixes the NVIDIA hosted destination, refuses redirects and requires an
explicit replacement credential when switching to/from that service. Its queued
connection revision is frozen and checked before worker execution; catalog writes
remain revision-fenced and encrypted. No live key is used in normal tests.
[Boundaries](NVIDIA_PRESET.md).

DA-124 rechecks source review/current grant/version and exact target consent under owner serialization. Encrypted immutable receipts use `evidence-publication:<id>:body`; exhaustive archive audit checks identities and exact copied source text. The byte-bounded same-origin route never fetches target URLs or sends a tool/provider request. Manual confirmation is not remote read-back. Published copies block reviewed run-body deletion. [Contract](EVIDENCE_PUBLICATION.md).

DA-123 candidate intake has a 32 KiB streamed strict local-origin/no-store BFF. Model
citations resolve stored identities and never masquerade as original source passages;
local excerpts reauthorize grants before creating copies. Current grant/version checks
block changed/revoked candidates from new qualifying claim annotations. Historical
copies remain inspectable; human decisions do not prove truth. New encrypted provenance
and local quote round-trip enter the exhaustive archive audit. Candidate TypeSafe
transmission is refused. [Contract](EVIDENCE_CANDIDATES.md).

DA-121 stores originals/names and extraction/pages as separate AES-GCM payloads with
version/payload-kind AAD. Current grants fence every source read/export and final
intake publication; a revoked scope cannot read old quotes. Lexical search decrypts
only bounded extraction in memory and persists no plaintext/embedding index. PDFs
run in a time/output/heap-bounded child with application secrets omitted; this is not
an OS sandbox. Images/scans/failures cannot provide usable excerpts. Explicit exports
contain plaintext and do not grant access. No library HTTP route or remote adapter is
enabled. [Contract and threat limits](LOCAL_KNOWLEDGE_SOURCES.md).

DA-120 denies empty/unselected knowledge scopes and matches exact owner/account/collection/grant/revision before and after adapter reads. Persistence accepts only the derived local owner/account. Titles/topics use context-bound AES-GCM; relationships/grant state remain metadata. Revocation/regrant never revives old selections. No external adapter or model input is enabled. Exporting retained topic/scope metadata does not authorize retrieval. Conversation deletion blocks retained selections and registers exact schema/FK/trigger protections. Backup auditing verifies authenticated payloads and ownership/relationships. [Contract](KNOWLEDGE_SCOPE.md).

DA-119 adds offline integrity checks and only public historical/synthetic fixtures.
Human review forms stay under ignored `.local/`; prepare refuses existing destinations.
No credentials, provider requests, database calls or runtime permissions are introduced.
Exact-plan owner approval cannot accept human labels/model quality; empty reviews and
source/fixture/split drift block compilation. Local-file-only import is a future
contract, not an implemented filesystem access boundary. Linux CI checks the frozen
knowledge plan/fixtures and metadata-only status without network model calls.
[Evidence](DA119_ACCEPTANCE.md).

DA-118's council-usage GET enforces owned conversation/membership/run/audit boundaries,
bounded metadata scans and authenticated audit/metadata decryption in one read-only
snapshot. Raw texts, remote IDs, fingerprints and price/billing evidence are excluded
from projection. Missing history is not zero usage. [Limits](CONVERSATION_COUNCIL_USAGE.md).

DA-117 stores only an allow-listed numeric private output default in a versioned browser
preference key. It stores no conversation identities/content/credentials. Invalid or
inaccessible values fall back to 1024; failed writes are not reported as saved. The
preference cannot change an existing branch selection or frozen review/retry intent.

DA-115's private usage GET is owner-scoped and no-store. One bounded read-only snapshot
authenticates branch/audit ciphertext and rejects foreign membership or conflicting
receipts. Only usage/count metadata crosses the BFF; sensitive content and remote
response identifiers are excluded. [Limits](CONVERSATION_PRIVATE_USAGE.md).

DA-113 binds the private output cap to the reviewed fingerprint, frozen encrypted request
and retry identity. Invalid or changed caps are rejected before enqueue/submission.
The maximum remains 1024 and the existing storage reservation is retained even for lower
limits. This is not monetary enforcement. [Boundary](PRIVATE_DELIVERY_SETTINGS.md).

DA-111 stores only light/dark/system appearance in localStorage. Navigation and theme controls dispatch no model requests and do not persist question/report/credential content in browser preferences. Existing owner/same-origin and reviewed deletion boundaries remain; collapsed/hidden views do not alter execution or retention. [Design](UI_DESIGN.md).

DA-109 Markdown attachments reuse owned export DTOs and same-origin checks. Input-sized
literal fences and escaped heading metadata keep embedded fences/HTML from becoming active
content. UTF-8/no-store/nosniff and oversize refusal apply; plaintext independent copies
retain existing export exclusions. [Contract](MARKDOWN_EXPORTS.md).

DA-108 uses strict same-origin 4 KiB confirmations, bounded inspection and exact-state fingerprints. Schema/FK/trigger/check/index drift blocks mutation. Receipts use context-authenticated encryption and exhaustive restore auditing. Names/descriptions are cleared and encrypted members become empty. Creation identity/hash and member count remain as replay metadata; independent snapshots, exports, backups and storage copies remain. [Contract](COUNCIL_TEMPLATE_LIFECYCLE.md).

**Remaining proposed work, DA-122–126:** [Knowledge security](KNOWLEDGE_SOURCES.md#access-and-threat-model) enforces grants before calls and on sources, authenticated gateway access, revocation-aware caches and separate write consent. Cookie/private-API bridges are excluded; warning labels do not waive effective isolation. Require local encrypted originals/excerpts and a separately reviewed design for persisted search indexes; no implicit plaintext/embedding exception. Optional backends require auth and approved-data isolation, with empty grants denying all access. No connector or transport change is implemented here.

**DA-104:** Strict same-origin 4 KiB confirmations, schema/FK/trigger/unique-index checks, a 24 MiB inspection cap, exact-state fingerprints and owner/table serialization protect draft deletion. Ciphertexts are nulled, and original intent replay is denied. Receipts are plain content-free metadata; independent records, old backups and physical storage remain. Destructive acceptance uses generated fixtures only. [Contract](PREFLIGHT_DRAFT_DELETION.md).

**DA-103:** the active lockfile removes the lint-only fast-glob/micromatch/braces chain through an exact parent-scoped tinyglobby alias and reviewed utility compatibility patch. Full and production audits report no known vulnerabilities; no advisory is ignored. Security CI adds frozen install/compatibility tests and preserves full audit/history scanning. This closes the dependency finding, not all application-security or original-plan gates. [Maintenance](DEPENDENCY_MITIGATION.md), [checks](DA103_ACCEPTANCE.md).

**DA-102:** strict same-origin 4 KiB confirmation, owned bounded copy inspection, exact affected-row fingerprints, worker/owner/table fencing, registered FK closure and checked immutable trigger bodies protect manual run deletion. Content-free usage/intent audit is encrypted; independent inputs and external copies remain. Its publication audit failed on the lint-only braces advisory; DA-103 resolves the current dependency graph. [Deletion policy](RUN_DELETION.md), [historical finding](DEPENDENCY_SECURITY_2026_10_03.md).

**DA-101:** read-only deletion preview authenticates bounded owned encrypted copies; missing ownership, unsupported schema/FKs/triggers, unreadable peers, pending receipts or capacity overflow preserve content. Same-origin confirmation is strict and streamed-byte bounded to 4 KiB. Exact fingerprints and transactional lease/locks reject drift; content-free audit is encrypted and old intent replay cannot restore deleted content. Backup/export copies, local unsaved drafts and underlying storage are outside this deletion boundary; no forensic or complete-account erasure claim. Tests delete generated fixtures only. [Policy](PRIVATE_BRANCH_DELETION.md).

**DA-100:** Gemini uses the owned preview/claim boundary, official default URL only for matching Google targets, `x-goog-api-key` rather than query credentials, no redirects and bounded one-attempt HTTP. Strict text parts reject thought/tool/media/unknown data and safety blocks; failed raw content and opaque signatures are not retained/logged/resent. Missing remote finish stays unknown without polling/resubmission. Local checks use generated fixtures; no paid call or owner-history deletion. Text-only stateless reconstruction is not original reasoning continuity or a provider zero-retention guarantee.

**DA-099:** Responses preserves owned review/claim checks, encrypted receipts and bounded no-retry HTTP. Only matching OpenAI targets receive the official default URL. Response storage and automatic truncation are disabled; this does not establish zero retention. Unexpected output/visible reasoning is rejected rather than promoted to private text. Opaque reasoning state is not persisted/exported/logged/resent. Remote pending stays unknown; observed usage survives no-text/invalid-output failures. Acceptance uses generated fixtures without paid calls or real owner deletion.

**DA-098:** native private delivery keeps reviewed fingerprints, encrypted receipts and no-blind-retry controls. Frozen source/owned connection providers must match at preview and claim. The default endpoint is resolved only for Anthropic; endpoint/provider/revision drift is refused. The shared 90s/128KiB response boundary refuses redirects. Unsupported blocks/stops are not silently stripped into a successful reply; failed raw content and credentials stay out of browser errors/logs. Acceptance uses local fixtures and deletes no real owner content.

**DA-097:** explicit exact-input review binds branch/input/connection state; unsupported settings and actual high-risk input are refused. Owned no-store byte-bounded routes and encrypted private receipts keep credentials out of browser payloads/exports/logs. Unknown outcomes require acknowledged closure and never authorize blind resubmission. Permanent request slots and bounded output/storage are local limits, not monetary enforcement. Generated replies remain untrusted private content. [Contract](PRIVATE_BRANCHES.md).

**DA-096 private drafts:** copied question/raw reply/member settings and owner drafts are authenticated encrypted local content, never automatically model input. Strict intents cannot inject seed bodies, credentials or assistant messages. Same-origin writes/downloads bound actual bytes and return generic no-store errors. Exports explicitly include plaintext drafts; source pruning does not erase copies. Private branches block identity deletion; unknown schema/FK/trigger drift fails closed. Backup auditing binds decrypted bodies to metadata. No private-content or backup/export erasure is claimed. [Policy](PRIVATE_BRANCHES.md).

**DA-095:** deletion is confined to one reviewed owned metadata-only identity, with complete membership binding and repeated body/reference/index/ownership checks. The same-origin POST requires strict matching identity/fingerprint/explicit confirmation; streamed JSON is capped at 4 KiB. Apply uses the existing owner lock, schema/body-stabilizing table locks and bounded SQL/lock waits; failures roll back. Metadata schema/FK/trigger drift blocks deletion. No content/credential is loaded or logged and no provider action is created. Real owner history was not deleted during acceptance; destructive checks use generated fixtures. Backup/export erasure and future message deletion are outside this boundary. [Contract](CONVERSATION_DELETION.md).

**DA-094:** conversation discovery remains under the existing loopback/single-owner boundary. Cursor lookup, membership counts and latest-run selection are owner-scoped. Only the visible page's selected question ciphertext is decrypted; reports, private archives, attachments, credentials and provider accounting are absent. The read-only transaction creates no job/event/provider call. Generic errors and `no-store` responses preserve the existing content boundary. No encryption field or retention behavior changes. Primary local acceptance is verified; stale history-read suppression changes only client state and dispatches no provider call. [Audit](REPO_AUDIT_2026_10_02.md).

DA-093 scopes conversation identity/membership/body reads to the owner and applies same-origin checks to download POSTs. Available source links must match authenticated run provenance and one valid conversation anchor; cycles/drift fail closed. Export uses explicit fields and exposes raw/private history as plaintext while excluding credentials, storage envelopes, request hashes and intent keys. Limits are 200 members/32 MiB with no partial export. Retained membership contains only IDs/kind/time, and the UI states legacy missing-bridge limitations. [Contract](CONVERSATIONS.md).

DA-092 scopes rows, parent lookups and cursors to the owner. Foreign/missing sources share an unavailable marker. Indexed links are verified against authenticated provenance; cycles, drift and pending legacy indexes fail closed. Read-only snapshots bound ancestry to 64 and sibling/child pages to 20, excluding raw/private/provider fields. Backfill changes only derived metadata and prints no content on errors. Source IDs/kinds are plaintext query metadata; questions/snapshots stay encrypted. Navigation starts no generation or mutation. [Contract](RUN_BRANCHES.md).

DA-091 accepts strict owner-reviewed summary selections bound to an owned source digest; client archival bodies cannot replace server-resolved history. Source text is bounded to 2 MiB UTF-8 and summary to 8000 characters. Original/omission/summary/delivery fingerprints are reconstructed before dispatch; archives use authenticated `run:<id>:continuation-archive` encryption and stay outside provider work. Original risk controls cannot be lowered by omitting risky words. Archive matching traverses at most 64 delivered ancestors and fails closed. Descendants retain their own private original through source retention and never automatically retransmit omitted originals. JSON exports include private archives as plaintext. Backup inventory covers the new ciphertext. [Limits](CONVERSATION_COMPACTION.md).

DA-090 requires owned completed/partial continuation sources and a reviewed digest. Historical text is untrusted, bounded to 256 KiB UTF-8 and copied into authenticated `run:<id>:continuation-context` ciphertext after a locked recheck. It participates in prompt/receipt fingerprints and risk checks; source high-risk controls cannot be lowered. Ancestor retention does not erase descendant copies; each has its own retention lifetime. Credentials, attachment bytes and separate memory/tool/evidence records are not replayed. Plaintext JSON export includes copied report/raw text. Backup auditing enumerates the new ciphertext. [Limits](CONVERSATION_CONTINUATION.md).

DA-089 requires strict bounded payment packets/manifests, absolute source paths, owned current invoice evidence and locally matched document digests. Manifest ids are checked before referenced files are read; distinct source byte limits are checked before hashing and while streaming. No source path/content is printed on errors and no provider/bank API is invoked. Transaction references and accounting provenance appear only in protected operator reports. Hashes do not authenticate payments. [Limits](BILLING_PAYMENT.md).

DA-088 validates bounded strict account packets and source SHA-256, owned statement ids, current head fingerprints and authenticated billing history. Duplicate line/response checks cross the explicitly declared connections; sensitive account references and mapping reasons appear only in protected operator artifacts. No URL is fetched, credential used, provider contacted or account/payment authority inferred. The inspector uses a read-only transaction; account packets/reports remain outside backups. [Limits](BILLING_ACCOUNT.md).

DA-087 requires owned source evidence and an exact owned submitted target receipt/frozen member. Authenticated reallocation payloads bind both immutable roots and the reviewed source head; hydration verifies claim ownership/metadata and rejects invalid linked evidence. Only explicit reallocation transfers current identity reservations; void alone does not release them. A populated disposable restore checked the new ciphertext. Source authenticity/payment remain unverified; database administrators still have write authority. [Limits](BILLING_REALLOCATION.md).

DA-086 encrypts full owner-reviewed statement packets and inspection snapshots under authenticated version contexts. Owned identities, reviewed head fingerprints and transaction/unique guards prevent lost updates or duplicate appends. Hydration and domain folding reject altered/gapped chains and inconsistent arithmetic; unreadable current billing denies freshness. Original source bytes remain separate; saved statement packets join backups. Database administrators retain write authority. No provider/payment authenticity is inferred. [Limits](BILLING_STATEMENT_HISTORY.md).

DA-085 inspection requires an owned current connection or owned historical statement records, authenticates encrypted ledger payloads and rejects invalid source digests/reviews. The CLI emits generic failure messages; explicit reports contain sensitive billing identifiers and amounts and need protected local storage. Hashes do not prove provider authenticity; balanced packets do not establish payment. No statement/source bytes are persisted. [Limits](BILLING_STATEMENTS.md).

DA-084 requires an owned attribution, selected evidence digest, a reason and the reviewed current fingerprint. Original-row locking and unique identities make identical retries idempotent and reject conflicting stale edits. Authenticated event payloads and chain validation fail closed on altered/gapped history. Source/call identity cannot change through replacement. Void does not certify zero spend or refund. Database administrators retain write authority. [Scope](BILLING_CORRECTIONS.md).

DA-083 imports only owner-reviewed local attribution whose file digest and exact submitted receipt/frozen connection match. Original document bytes are not uploaded or saved to the ledger. Authenticated encrypted records and fingerprints protect provenance; owned unique identities reject duplicate charges. Receipt identity drift is excluded from billed subtotals. Run retention preserves accounting evidence; deletion/correction policies remain open. A matching hash does not prove source authenticity or contents. [Policy](PROVIDER_BILLING.md).

DA-082 records only owned connection prices, encrypted with authenticated record contexts. Source references prohibit credentials/query/fragment values and are never fetched. Fingerprints bind the price payload/revision and receipt usage. Price integrity failure after submission preserves its result with unknown cost. The usage response contains calculation metadata without credentials, prompts or output text. Operator rates are observations, not invoice evidence. Both ciphertext fields join the exhaustive backup inventory. [Policy](PROVIDER_PRICING.md).

DA-081 limits are owner-selected, frozen encrypted run/schedule configuration; a provider or returned tool text cannot change them. Submission reserves capacity atomically under the owned run lock, and neither unknown-outcome resolution nor retry authorization restores it. New per-attempt reservations are non-sensitive integer metadata; ordinary logs/events still exclude questions, responses and credentials. The backup ciphertext inventory must include both execution-limit fields, with both populated fields verified through a fresh disposable restore on 1 October 2026. [Acceptance evidence](REPO_AUDIT_2026_10_01.md). These controls govern council generation dispatch only, not account-wide monetary spend, input/tool charges or separate decision/MCP/retrieval calls. [Boundary](EXECUTION_LIMITS.md).

DA-080 token details remain in the existing context-bound encrypted receipt metadata. The owner-scoped usage DTO allow-lists counts/conventions and excludes full metadata, citations, response text and secrets. Failure metadata is non-enumerable and is not added to logs/events. A transaction idempotency lock and retained browser intent key prevent accidental duplicate enqueue on concurrent or uncertain start responses; they do not establish a spending limit. [Scope](PROVIDER_USAGE_DETAILS.md).

The selected-member follow-up route is an explicit same-origin owner action. It rejects incomplete source runs and unresolved provider attempts before enqueue, stores copied raw/parsed member outputs only in the child run's context-bound encrypted snapshot, and uses the normal receipt boundary for fresh calls. Its event payload contains ids and status only; no prompt or response text. The saved connection for the selected member may have changed since the source and is not attested as the same backend. [Scope](MEMBER_RERUN.md).

Prompt revision text and its mechanical audit are encrypted on the run with a context-bound envelope. A selected candidate must preserve the full original exactly once; an invalid candidate cannot reach enqueue even through the direct API. A change invalidates the reviewed first-round prompt/risk digests. The exact diff and local risk comparison do not certify semantic equivalence, harmlessness or accuracy of added instructions. The owner-requested plaintext report export includes revision provenance; history and content-free events omit it. [Limits](PROMPT_REVISIONS.md).

Pending critical-context questions are kept as owner-scoped, context-bound encrypted drafts. They contain no provider credentials beyond whatever references the original run request already held; the full original request, selected attachment bytes and optional image dimensions remain encrypted until the owner starts or cancels. Both paths scrub draft ciphertext. The accepted answer/original-choice provenance is encrypted on the run and appears in the owner-requested plaintext JSON export. Preview and list responses use no-store and same-origin mutations; question text and answers are not written to ordinary logs/events. Unanswered drafts have no expiry yet, so the local owner must cancel obsolete ones. [Boundary and limitations](MISSING_CONTEXT_PREFLIGHT.md).

The current deployment is a single-owner application bound to this computer. It does not expose public registration or remote multi-user access. Browser mutation routes compare `Origin` with `APP_ORIGIN`; non-browser local processes remain inside the trusted operating-system account boundary.

Single-run JSON export is an explicit same-origin POST available only after a terminal report exists. The route uses the owner-scoped run lookup and an allow-listed projection; provider keys, internal request/idempotency identifiers and attachment bytes are excluded. The exported question, raw model outputs, quotes, citations and review notes are plaintext in the downloaded file, so the UI warns the owner before local download. `Cache-Control: no-store` and an attachment disposition prevent this response from becoming an ordinary cached page. Export does not create a persistent server-side file or send content to another service.

The local history endpoint is read-only, owner-scoped and uncached. It decrypts questions only for the bounded page returned to the local UI, and its response omits report content, provider credentials, internal request keys and attachment bytes. A pagination cursor must identify a run owned by this local owner; invalid or unknown cursors are rejected. Reopening a run uses the existing owner-scoped detail endpoint and does not invoke a provider.

The run-usage endpoint is also owner-scoped and uncached. It exposes only provider/model/member identifiers, attempt status and stored token counts; it does not select prompts, raw responses, encrypted result metadata or credentials. A missing count is reported as unavailable, and ambiguous outcomes remain visible so an unknown charge cannot be mistaken for zero.

Local retention pruning is a manual operator command. Its default path counts eligible local-owner terminal runs without deleting them; a separate `db:prune:apply` command deletes only runs with a finish time older than the configured cutoff. Unresolved provider and decision attempts block eligibility so their operator/billing trail is not erased. An apply transaction removes recorded pg-boss jobs and cascades through run-owned database records; a fixture-only integration test verifies each known dependent table, schedule link handling, queue jobs, preservation of an independent decision connection and rollback on invalid job metadata. Previously created backups or downloaded JSON exports are not erased. This is not full account deletion, live recovery cutover or key rotation.

Backup manifests are published only after a disposable restore passes checksum, schema and every non-null encrypted-field decryption check. A failed new backup is not exposed as the latest usable manifest. Recovery rehearsal prints status counts rather than encrypted contents and does not start workers or replay provider calls. The verifier never logs plaintext, ciphertext, credentials or row identifiers on failure; it reports only a table, field and row ordinal. Replacement-installation cutover, queue/receipt reconciliation and key rotation remain open.

The local diagnostics endpoint reads only aggregate run, unresolved-attempt and schedule counts for the fixed local owner plus heartbeat timestamps. It returns no question, key, model output or queue payload. Worker readiness requires both a fresh heartbeat and a matching active PostgreSQL session, so a recent row copied by a database restore is not enough. This is still a local same-origin status view, not public monitoring or an authorization boundary.

Local database backups are stored under the Windows user's `%LOCALAPPDATA%\DeliberationAI\backups` directory, outside Git. The custom PostgreSQL archive includes encrypted content and potentially sensitive plaintext metadata; it is not an encrypted whole-file vault. The archive manifest contains no credential or prompt. Verification checks the SHA-256 digest, restores only into a generated disposable database, and decrypts all non-null ciphertext fields in bounded pages without logging their contents. It rejects a changed encrypted-column inventory and malformed encrypted JSON. `.env.local` and the administrator secret are excluded from the archive. Loss of the matching `DATA_ENCRYPTION_KEY` still makes stored encrypted content unreadable. A real replacement-installation cutover has not been exercised.

`DATA_ENCRYPTION_KEY` is a 32-byte local master key. AES-256-GCM envelopes use a random 96-bit IV and context-specific authenticated data so ciphertext cannot be moved between records or fields without detection. Questions, run member snapshots, council-template members, reports, raw and parsed outputs, claim statements, quotes, provider results, provider-returned citation URLs/titles, and API keys are encrypted before they reach PostgreSQL. Hashes, state names, template names, provider/model identifiers, member counts, timestamps, token counts, and queue metadata remain searchable plaintext.

Provider keys are accepted only by the local server route and never returned by lists/reviews. They are decrypted for worker generation and explicit owned catalog or reviewed generation checks. Local Ollama, vLLM and LiteLLM can be keyless. Base URLs/capability settings are non-secret metadata. General logs must never contain request bodies, prompts, raw outputs or credentials.

The catalog route sends credentials only to the saved connection URL or fixed native provider URL, never to an arbitrary request URL. It validates the stored URL scheme and rejects embedded URL credentials, disables redirects, sets a ten-second deadline, caps response bytes at 4 MiB and returns at most 300 sanitized model ids and coarse failure status. It does not read or log provider error bodies. Compatible endpoints may intentionally be loopback for local servers; this owner-only feature is not the public-source retrieval boundary. It must not be exposed to untrusted owners without a separate egress policy and authorization design.

Official catalog metadata is allow-listed into bounded display names, positive token limits and enumerated reasoning signals; provider descriptions, prices and unknown fields are discarded. Generic compatible servers cannot inject capability claims into this projection. The browser renders the text as ordinary escaped content; these observations are not trusted authorization or generation-policy inputs.
The normalized catalog/history envelope is stored as context-bound AES-GCM ciphertext on its owner-scoped connection row. A connection revision prevents an in-flight catalog from attaching to edited credentials or endpoints; editing clears only the latest catalog while preserving bounded history and generation identities. The browser reads content-free observation metadata after reload; no key, raw provider response or error body is included. Backup verification validates this encrypted field's legacy/new formats in its exhaustive inventory. Observations remain untrusted as authorization or generation-policy inputs.

Provider-native web search is off by default and frozen per member/run when enabled. Tool calls are bounded in adapter request configuration. Returned citations remain provider-supplied data and are rendered as external links; they are not treated as trusted instructions, owner-reviewed evidence, or automatic evidence-state changes.

Provider calls use durable receipts. A call moves through `prepared`, `submitted`, and a terminal outcome. Only the worker that atomically changes a prepared receipt to submitted may make that outbound call; overlapping workers cannot both claim one attempt. Submitted and unknown calls are not retried automatically. A successful result is encrypted on the receipt and can be replayed without another remote call. Unknown outcomes require a same-origin operator mutation: discard closes the attempt, while retry authorization preserves it and creates a new attempt with a new idempotency key. Both decisions are written to the run event ledger.

Returned malformed provider text is sensitive even when validation fails. It is attached to an internal non-enumerable error field, encrypted on the failed receipt and final report/model-run record, and shown only to the local owner under the failed member or review. Error messages and event payloads contain no raw response text. A failed response cannot be used as a claim, evidence or cross-review input.

Cross-review minimizes lateral disclosure between providers. It shares only validated structured summaries and claims from successful round-0 members. It excludes raw response text, credentials, operation metadata, and the reviewer's own output. Review artifacts are encrypted under the same content controls as analysis artifacts.

Council roles are non-secret configuration metadata. Red-team content remains sensitive run content: raw output, parsed challenges, and report projections are encrypted. Role separation is enforced again in the domain projection rather than trusted solely to provider instructions.

Evidence-state changes require the same local-origin mutation boundary. The claim statement remains encrypted; the event ledger stores only the non-sensitive report-local claim id and enum state. Updating a state rewrites the encrypted report within the same database transaction as the claim index and event.

Synthesis-coverage changes use the same boundary and transaction. Their events contain only the report-local claim id and coverage enum; claim text, quotes, and surrounding model output remain encrypted.

Owner scope and claim-relation notes use the same local-origin mutation boundary and stay inside the context-bound encrypted report. A locked transaction increments the run version and emits only report-local claim ids, relation kind, or a scope-present boolean; note text and claim statements never enter the event payload. Scope notes and relation notes are bounded to 500 characters, relations to 100 unordered claim pairs. No new content is sent to a provider by these post-run edits.

The effective high-risk profile is run/schedule metadata with a database enum check. DA-069 enforces a rule-based floor on the server even when the caller selects standard or omits a preview digest. The question, delivered text context and uninspected images can require red-team/review; external text cannot instruct the policy to downgrade a match. The versioned assessment and bounded source-kind reasons are encrypted with `run:<id>:risk-assessment`, included in the exhaustive backup inventory, and excluded from event logs. Prompt/risk preview digests detect drift and are not authorization tokens. The worker also checks frozen controls before dispatch, and the existing post-run gate rejects incomplete high-risk participation. Lexical misses and false positives remain possible; this is not a general prompt-injection defense or semantic risk certification. [Policy limits](RISK_PREFLIGHT.md).

Shared-memory creation and deletion use the local-origin mutation boundary. Memory content and each run's selected-memory snapshot are encrypted with separate context-bound associated data. List responses expose decrypted content only to the local owner UI. Provider requests receive no source run id or claim id, only the frozen text, source type, and evidence state. The stored library is capped at 20 entries and each run at 5 to bound disclosure and prompt growth.

Evidence-source mutations use the same origin boundary. Source titles, URLs, notes, and excerpts are encrypted with field-specific authenticated context; relation, review status, freshness status, and timestamps remain searchable metadata. Excerpt, publication date, and capture time are write-once fields enforced by a database trigger. Manual source creation never fetches the submitted URL, and source records are not sent to model providers. Each claim is capped at 10 sources.

Application-managed retrieval has its own same-origin command and [ADR-0018](adr/0018-application-managed-retrieval.md) network boundary. Only HTTP(S) ports 80/443 are allowed. Embedded credentials, localhost, every non-public DNS answer, private/link-local/reserved/documentation/metadata ranges and unsafe redirect hops are rejected. A validated IP is pinned into the actual connection to close the DNS-check/use gap. There are no automatic redirects or retries; the request has a 10-second deadline, 16 KiB header limit and 1 MiB body limit. HTML/plain text is decoded and executable/decorative markup is discarded. PDFs are parsed only from the bounded byte snapshot with rendering disabled, a 100-page cap and a separate ten-second deadline. All formats retain at most 64,000 characters. Requested/final URLs, title and content are encrypted; the digest and size are non-secret metadata. Each claim is capped at five captures.

Browser-rendered capture uses a new non-persistent browser/context for one owner request. Service workers, permissions, downloads, dialogs, images, media, fonts, manifests, WebSockets, event streams and every non-GET request are blocked. Every allowed HTTP(S) request is fetched by the same DNS-pinned public-target retriever before fulfillment; Chromium does not receive unrestricted network access. A render is capped at 20 requests, 5 MiB total and 15 seconds. Only normalized `body.innerText` leaves the context, and the digest covers that rendered text snapshot.

Captured text is untrusted data. The UI renders it only as plain text and never executes it, sends it to a model, treats it as instructions, or promotes it automatically. Evidence promotion requires an exact substring from the immutable capture and still starts unreviewed. Public/shared deployment additionally needs infrastructure egress filtering; application validation is not a substitute for a network policy.

Task attachments are untrusted model input. The browser and server allow JPEG, PNG, WebP, GIF and selectable-text PDF, with at most six files, 2 MiB per image, 5 MiB per PDF and 12 MiB in total. Each digest and declared file signature is checked before encrypted persistence. PDF text is extracted locally with a 100-page, 64,000-character and ten-second limit; the server repeats extraction at enqueue and rejects a mismatch with the browser's preview text. Image-only PDFs are rejected because OCR is not enabled. A member receives image bytes or extracted PDF text only when the owner enables that member's task-level attachment switch. Attachment content is labeled untrusted, cannot authorize retrieval, is excluded from cross-review and is never written to ordinary logs. The preflight token estimate sends the question, image dimensions and extracted PDF text only to the loopback application route; it makes no provider call and persists no preview. It is explicitly approximate because providers tokenize images and structured requests differently.

The same-origin preflight response now includes each member's rendered first-round instruction and user text, so it can contain selected memory, tool results and PDF text. It uses `Cache-Control: no-store` and is displayed only in the local owner UI; the full text is not logged or persisted as a new prompt artifact. A SHA-256 fingerprint and prompt version are stored as plaintext run metadata. The digest detects drift between review, enqueue and worker execution; it is not an authorization token, a secret or proof of provider behavior.

DA-072's later-round prompt plans can contain the owner's question, selected shared memory and successful peers' validated claims. They are stored only in the existing encrypted run report, returned to the local owner with run detail and included in an explicitly downloaded plaintext report. They are not written to events, logs or a plaintext database column. A failed attempt's plan may never have crossed the network; its presence is not a delivery receipt.

Local MCP connections accept only loopback HTTP and store their labels/endpoints encrypted. Tool discovery does not execute a tool. Invocation requires an owner action and JSON arguments, revalidates the current tool list, has a 15-second deadline, retains only 64,000 text characters and closes the session. Arguments/results are encrypted. Models cannot request an invocation; selected successful results are frozen as untrusted round-0 context and excluded from cross-review.

Local schedules start paused and expose explicit activate, pause and delete actions. Their names, questions and member snapshots are encrypted. Each due occurrence reuses ordinary provider receipts and idempotency. A schedule cannot run while the local worker is stopped; public deployment would require per-owner authorization and rate/cost controls before enabling this feature.

The local threat model does not protect against an attacker who already controls the Windows account and can read both `.env.local` and the database process. Public or shared deployment requires authentication, per-owner authorization, secret-manager integration, audit review, rate limiting, and a key-rotation mechanism.

## Offline human review artifacts

DA-073 writes paired prompt text and blank drift-review worksheets under ignored `.local/prompt-comparison/`. They may contain the frozen external source excerpts and later human notes in plaintext, but no provider credentials. The shipped commands neither contact a model nor log prompt/source contents. Keep the files local and treat reviewer identifiers as coordinator-attested, not authenticated identities. [Protocol](evaluation/PROMPT_COMPARISON.md).

DA-068's offline correctness worksheets under ignored `.local/external-council-labeling` and `.local/contradiction-labeling` can contain plaintext report/claim text when the operator explicitly prepares a human review. They contain no provider credentials. The shipped preparation/scoring commands do not make model requests, log source/output contents or overwrite existing files. Run loading uses the local-owner boundary and rejects extra input context in controlled measurements. These local review artifacts have the same disclosure implications as downloaded reports and are not covered by encrypted database retention. Human identity/independence is coordinator-attested rather than authenticated by reviewer-id strings.

## Decision-assessment disclosure boundary

Source records are not sent to council providers. [ADR-0017](adr/0017-advisory-decision-evaluation.md) adds a separate, default-off workflow with explicit selection of one claim/excerpt pair and a TypeSafe decision connection. The server requires `confirmExternalShare: true` and refuses assessment creation while the decision feature flag is off. Hosted inference sends only the frozen claim/excerpt and fixed rubric metadata outside this computer; it is not local inference. The complete evidence library, unrelated history, review notes, URLs, and credentials are excluded from model input, and the adapter never falls back to another provider.

Decision keys, assessment inputs/results and successful operation results use context-bound encryption and owner scoping. Ordinary logs/events contain no excerpts, prompts or outputs. Source instructions remain untrusted; the fixed rubric and validated schema reduce risk but cannot establish semantic correctness. Assessments cannot authorize tools, fetch URLs, alter evidence states or bypass the later retrieval boundary's SSRF checks. Submitted or unknown outcomes are never retried automatically; explicit retry creates a new attempt and preserves history. Vendor training and retention policies must be checked for the chosen endpoint/account before live use; do not infer zero retention from a no-training claim.

## DA-107 reviewed local schedule deletion

Schedule template removal requires read-only bounded review, paused status, exact confirmation, same-origin mutation and strict 4 KiB bodies. Schema/FK/trigger/index drift blocks removal. Authenticated encrypted receipts retain no template content and prevent original creation replay; backup auditing validates their semantic integrity. Historical runs, WAL/backups/exports remain. [Contract](LOCAL_SCHEDULE_DELETION.md), [ADR-0032](adr/0032-reviewed-local-schedule-deletion.md).

## DA-122 reviewed local source packets

The strict knowledge BFF accepts only explicit owned local operations, caps streamed JSON/base64 intake and returns no-store results. Reviewed packets require current exact grants, selection revision, active-version inventory and 15-minute freshness; enqueue repeats authorization under the owner lock. Each new round-0 submission rechecks scope. Backups authenticate source-linked quotations and historical packet ownership. Revocation is prospective, and run deletion preserves independent preparations/library versions. [Contract](KNOWLEDGE_PACKETS.md).
