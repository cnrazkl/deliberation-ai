# Scoped knowledge sources and NVIDIA connections

DA-119 update: the owner accepted the [frozen trial contract](evaluation/KNOWLEDGE_EVALUATION.md)
and selected individual files only. [Exact-plan approval](evaluation/KNOWLEDGE_CONTRACT_APPROVAL.json)
ratifies trial scope/limits, not independent labels or measured model quality.
[Technical preparation and open gates](DA119_ACCEPTANCE.md) supersede earlier pending
agreement statements below. DA-120 now implements the [scoped backend foundation](KNOWLEDGE_SCOPE.md).
DA-121 implements [local source versions and reads](LOCAL_KNOWLEDGE_SOURCES.md).
DA-122 implements [explicit library UI and reviewed evidence packets](KNOWLEDGE_PACKETS.md).

Status: 5 October 2026. DA-119 trial contract is owner-accepted; independent gold/model acceptance is pending. DA-120 backend scope/grants/bindings are implemented and verified; DA-121 local source foundation is verified; DA-122 implements reviewed local packets; DA-123–DA-126 remain open. DA-108 is complete in the integrated application history through DA-118. Original planning IDs DA-109–DA-116 are superseded by DA-119–DA-126. Selected-file intake, explicit library UI and frozen council packets are implemented. No external connector or autonomous model retrieval is enabled.

Owner refinement, 5 October: security, output quality and maintainability take precedence over NotebookLM compatibility. This revision supersedes the earlier recommendation to experiment with cookie-based bridges. The policy is requested; the detailed implementation remains proposed.

## Reliability decision and supported scope

- **Exclude unofficial NotebookLM bridges** from implementation tasks and supported options: browser automation, extracted cookies and undocumented private APIs are not an acceptable long-term dependency. A separate account or an experimental label does not waive this rule.
- **Defer official NotebookLM integration.** The reviewed notebook-management API is Preview/Pre-GA; the reviewed pages do not establish the required supported query/excerpt/citation contract. Reconsider only when an official, suitably stable interface meets the acceptance gate below and setup/operating costs are acceptable. NotebookLM is not required even as a benchmark.
- **Exclude Notion integration from this program.** Its official API has useful access controls, but PDF storage alone does not satisfy our retrieval contract. This is a fit/scope decision, not a finding that Notion is unsafe. No Notion-specific archive or manual-addition task is required.
- **Use a local-first source library as the proposed baseline.** It must work without an external notebook product. Existing encrypted persistence, document extraction, research capture and the worker provide foundations; this is new bounded work, not already implemented or a guarantee of security.
- **Keep Open Notebook/RAGFlow as optional evaluation candidates only.** Use documented APIs and isolated deployments if they pass the same tests as the local baseline. Open-source licensing, self-hosting and citation links do not by themselves establish security or correctness. Prefer direct APIs over an extra MCP bridge unless MCP provides a demonstrated operational benefit.

Primary evidence and limits are in the [revised research](research/KNOWLEDGE_CONNECTORS_2026_10_05.md). Concrete synthetic examples are in [the acceptance scenarios](evaluation/KNOWLEDGE_SOURCE_SCENARIOS.md); none is a live product/model test.

## Minimal local baseline and sustainable operation

A notebook is a topic collection in DeliberationAI, not necessarily a vendor notebook. Reuse the current modular monolith and PostgreSQL rather than requiring another notebook application, vector database or always-running service in the first increment. Store immutable encrypted originals/extracted passages and reusable source identities once; runs freeze only selected excerpts and provenance. Imported external material enters the same source contract, with explicit consent and retention for any retained original.

Start with bounded source browsing, manual excerpt selection and deterministic lexical retrieval over only authorized, bounded decrypted text in application memory. This is an inspectable baseline, not a claim of adequate semantic recall. If selected collections exceed the tested corpus/latency limits, refuse automatic retrieval with a visible reason and offer narrower selection; never scan or omit data silently. Semantic search/reranking is a later measured addition if the quality baseline requires it. Ciphertext cannot be directly full-text searched: do not add plaintext text indexes or embeddings as an undeclared exception to encryption. Persisted search indexes require a separate at-rest/access/deletion design and acceptance.

Selectable PDF/text is first; scanned PDFs and JPEGs can be retained as originals but remain `extraction_unverified` until a separately accepted OCR/vision path and page review exist. Do not promise table/image interpretation from text extraction. Version the parser, normalized text and page mapping, retain failed extraction and never re-ingest unchanged bytes on each question. Apply file count/size/page limits, type validation, isolated parsing deadlines and bounded encrypted storage; reject active content and archive/directory expansion unless explicitly supported. Local ingestion does not silently send content to an embedding/OCR cloud provider.

Separate canonical source records from disposable retrieval indexes. Indexes must rebuild from retained permitted source versions; backup/restore must recover source bytes, locators, reviews and grants with the separately protected encryption key. Revocation blocks dispatch and reuse; reviewed erasure inventories originals, chunks, indexes, caches and frozen run copies. A disconnected adapter cannot prevent opening saved evidence or preparing from available local sources; absent uncopied remote content is explicitly unavailable, never fabricated.

Each accepted optional adapter needs a named maintenance responsibility, pinned version/API contract, dependency/license review, documented auth rotation, bounded timeouts/concurrency/queues, explicit unknown outcomes, schema contract fixtures, failure isolation and a disable switch. Disable only the affected adapter on auth/schema failure. Upgrades require a disposable-data contract/recovery rehearsal, backup and a tested compatible rollback or restore plan; old binaries must not be blindly started against a migrated database. Portable source/evidence exports provide an exit route. DA-121 records setup steps, ongoing update/backup duties, measured latency and operating cost; DA-119 agrees acceptable limits before a product is selected.

An optional connector is admitted only after: documented supported read/search/source contracts; effective isolation of approved data including backend credentials/deployment; authentication required and no public exposure; exact raw-source citation round-trip; successful outage, revoke, upgrade and restore tests; and passing the human quality study. Unknown results mean not admitted. A global service credential may be used only in an isolated instance containing approved data behind a policy gateway with tested access controls; it must not expose an unrelated personal corpus. No browser cookies, private APIs or UI automation enter the supported path.

## Product intent

Store substantial documents once in a reusable topic library, then retrieve bounded, inspectable evidence for each question. A conversation may select several notebooks, including notebooks from different connections; different conversations can select different sets. A notebook can serve several conversations without copying its whole corpus into every prompt. DeliberationAI remains the council and evidence-review interface; it does not rebuild a general notebook product.

MCP is a transport, not a token-saving guarantee. Retrieved text still costs input tokens for each receiving member and any later prompt that includes it. Indexing, OCR, embeddings, remote notebook answers and hosting can have separate costs. The intended saving comes from avoiding repeated full-document delivery, with quality measured against a full-source baseline. No saving percentage or quality advantage is established.

## Existing foundation and gaps

Verified against commit `ed47915`, shared by this worktree, primary checkout and fetched `origin/main` at the start of this review:

| Existing boundary | Reuse | Missing capability |
| --- | --- | --- |
| DA-037, `packages/tools/src/index.ts` | Explicit local MCP calls; encrypted saved text | Notebook grants, typed source identity, structured citations, transport authentication and robust long operations |
| DA-035/039 research capture and evidence sources | Bounded public retrieval; frozen excerpts; separate human content/freshness review | Candidate inbox and confirmed publication to an external notebook |
| DA-043 attachments | Local selectable PDF extraction and per-member image/PDF consent | Reusable indexing, OCR quality tracking and large-input routing |
| DA-090–093 conversations | Frozen history and durable conversation identity | Conversation-to-notebook bindings and source-version selection |
| Compatible provider adapter and catalogs | Configurable Chat Completions, normalized receipts/usage | A visible NVIDIA preset and tested per-model capabilities |

The current MCP client uses HTTP loopback, Streamable HTTP, a 15-second deadline, text-only extraction and a 64,000-character slice. It does not implement stdio, remote OAuth, notebook isolation or citation-safe truncation. A tool being listed does not establish that it is safe or read-only. These generic capabilities do not qualify an unofficial NotebookLM bridge for this program; such integrations are excluded by the reliability decision above.

## Proposed user flow

1. **Choose the local library or an admitted service.** Local collections require no external account. For an optional accepted adapter show destination, account identity, acceptance/version status and supported operations. Saving settings performs no retrieval or upload. Keep knowledge services separate from council model connections; excluded candidates are not selectable options.
2. **Grant notebooks explicitly.** Prefer pasting a notebook ID/link; optional discovery is a separate user action showing names only. Default scope is empty. The owner grants exact notebooks for read access and separately selects any write destination.
3. **Bind a conversation.** Choose one or more granted notebooks and a short topic description. Show selected sources before each run. Topic text helps retrieval but never grants access. No default “all notebooks” selection.
4. **Prepare evidence.** Explicit preparation queries only those notebooks, shows excerpts, citations, omitted results, freshness and estimated member input. If no useful evidence is returned, show that gap; continuing without it requires an explicit choice. Do not silently substitute full files or another notebook.
5. **Freeze and deliberate.** The owner reviews the exact shared source packet and member recipients before starting. All receiving round-0 members get the same packet, independently. No model can trigger a notebook call. Heterogeneous sharing must be labeled and cannot be presented as equal-evidence agreement.
6. **Review new sources.** Sources suggested by members, web search or the owner enter an inbox. Show the original URL/file, relevant passage, associated claim, publication/capture dates and conflicting evidence. A citation or model's confidence is not verification.
7. **Save approved evidence.** Content review and authorization to send to a named notebook are separate decisions, which may appear in one review screen. Show exact content, destination/account and sharing effect. If the connector cannot safely write, create a download/copy packet and a task with the destination link; retain `awaiting_manual_addition` until the user confirms and, where supported, a source read-back verifies it.

Example: a tax conversation selects “Official guidance” and “Personal records”; a software conversation selects “Architecture” only. Discovery of the second topic's notebooks never makes their contents eligible for the tax question. Two contradictory official excerpts remain separately visible.

## Connection and application boundaries

Add a provider-independent `KnowledgeSource` port under application orchestration. Proposed operations are `inspectNotebook`, `searchSources`, `readExcerpt`, and separately `preparePublication`/`publishReviewedSource`. Optional discovery must not be part of the search path. Capabilities declare raw-excerpt retrieval, generated answers, citations, source revision, notebook filtering, writes, deduplication and transport/auth support; unknown stays unsupported.

Adapters translate vendor HTTP/MCP envelopes to bounded internal records. Reuse `packages/tools` transport code where suitable; do not put cookies, SDK objects, vendor JSON or vector-store types in domain code. A local policy gateway binds notebook IDs server-side, restricts operation names/arguments, validates all returned source identities and enforces budgets before results reach the application. Never accept an arbitrary tool name/URL/path from a model.

Prefer raw source retrieval. Notebook-generated answers remain labeled secondary model output, with their originating model/service when available. They are not independent evidence and cannot stand in for an inaccessible original excerpt. Feeding one upstream summary to every member creates correlated omissions: expose this dependency and require original-source checks for the quality gate.

For multi-notebook search, issue bounded scoped queries, normalize and deduplicate source versions, retain per-notebook provenance, and reserve coverage per selected notebook before ranking globally. Show no-hit, inaccessible and omitted notebooks separately. A source appearing in several notebooks is not several independent confirmations. Lexical/semantic/hybrid search and reranking are replaceable policies with recorded versions; none is presumed best before evaluation.

## Access and threat model

Application scope and upstream credential scope are distinct. A Google browser session may read the whole account even when DeliberationAI permits one notebook. UI filtering alone is insufficient. Enforce grants before network calls and on responses, cache lookups, source reads, publication and export. Pin the account/profile, connection revision, notebook IDs and grant revision; never rely on a mutable “active notebook.” Reject scope drift and cross-notebook results.

Require least-privilege credentials or an isolated backend containing only approved data, plus tested gateway enforcement. If effective scope cannot meet the admission gate, reject the connector; disclosure or an experimental toggle is insufficient. Broad discovery, cross-notebook tools, sharing, deletion, account switching and arbitrary file access are disabled in the constrained path. Local loopback alone is not authentication: add protected local credentials, origin controls and authenticated gateway calls before exposing sensitive operations. Do not weaken the existing loopback boundary to make a demo connect.

Remote connector OAuth/HTTPS is a later separate transport increment. Keep upstream credentials in the adapter/gateway secret store, not prompts, tool results, URLs or logs. Pin reviewed dependency versions, review license/authentication behavior and disable automatic package upgrades in the supported deployment. Source content and tool descriptions are untrusted data; embedded instructions cannot expand scope or authorize network/writes. URL capture reuses the existing SSRF-resistant retriever. Directory import, if requested, uses an explicit file manifest, rejects symlink escapes/secrets and never grants arbitrary disk access.

## Frozen context and lifecycle

Preparation is a distinct durable operation before council enqueue. State: `requested -> submitted -> ready | failed | outcome_unknown`; a potentially metered query with an unknown outcome is not automatically repeated. Reads that create notebook chat history must be disclosed and isolated by operation, with no accidental reuse of another conversation's session. Polling reads operation status only. A long-running connector uses a separately bounded job rather than raising every MCP timeout indiscriminately.

The prepared packet includes query/topic digest, connection/account/grant revisions, notebook/source IDs, source version or content digest, extraction method, captured time, page/section/span locator, exact excerpt, ranking-policy version, selection/omission counts, sensitivity and review/freshness metadata. Enqueue binds its fingerprint into prompt and risk preflight and rechecks grants; worker dispatch checks revocation before the first submission, without re-fetching source text. Revocation blocks new dispatch; already submitted work is recorded honestly, not claimed recalled.

Historical runs keep the immutable evidence they actually used. Notebook edits cannot rewrite them. Revocation removes future eligibility, including cached reuse; deletion/erasure follows explicit copy-aware review and retention, and explains external copies. Continuation and member reruns retain their original packet by default, subject to new sharing authorization; refreshing sources creates a newly reviewed packet. Existing schedules retain frozen inputs; automatic source refresh is deferred and must never happen unnoticed. Initial scope is council runs; private branches need a separate sharing/preview extension.

Cross-review does not independently query notebooks. Its initial implementation continues the existing structured-peer contract; expose that reviewers have not independently read original sources. Direct excerpt access in reviews requires a separately versioned prompt, common frozen selection and cost preview. External evidence becomes available to later runs only after explicit selection/preparation.

## Proposed persistence (no migration in this change)

| Aggregate | Purpose and invariants |
| --- | --- |
| Knowledge connection and notebook grant | Owned connector/account revision plus exact permitted notebooks/operations; secret references encrypted |
| Conversation knowledge binding | Many-to-many owned conversation/notebook selection; immutable revisions, explicit fork inheritance |
| Source version | Stable local identity plus optional remote mapping, original/extracted digests, locators, parser version, extraction/OCR state and review history; content encrypted |
| Prepared context packet | Immutable selected excerpts and provenance; separate from the remote library and full original corpus |
| Evidence candidate | Frozen original capture and claim links; proposed/rejected/reviewed state, distinct freshness decision |
| Publication intent/receipt | Reviewed payload/destination digest, idempotency identity and remote source ID; submitted/unknown/confirmed state |

Extend existing evidence-source records through explicit links, not a second automatic truth system. Existing source-content and freshness requirements still govern claim annotations. Human acceptance means “owner reviewed this content,” not proof of truth. A changed remote document needs a new version and review. OCR output is a derivative linked to original bytes/page regions, never silently treated as exact original text.

Indexes expose minimal identities and states; titles, URLs, queries, excerpts and responses remain encrypted. Every new ciphertext context enters exhaustive backup/restore checks. Retention/export inventories include prepared packets, candidates, receipts and copied provenance. Disconnecting a service does not imply erasure of remote files, local snapshots or exports.

## Evidence publication and recovery

Bind confirmation to the exact payload, notebook/account/grant revision and capture digest. Immediately before submission, recheck ownership, permission, current reviewed state and destination. Serialize by intent and retain a receipt before calling the external service. Do not treat local DB commit and remote upload as an atomic transaction.

Deduplicate by destination plus source/content identity, without collapsing different versions or conflicting passages. A successful write requires read-back of the returned source identity and meaningful content/version evidence; indexing readiness is separate from upload acceptance. Timeouts become `outcome_unknown`; reconcile remote state before any user-authorized retry. Never claim exactly-once remote delivery when the service lacks idempotency. Partial failures remain visible. No automatic deletion, public sharing, whole-chat export or write-back of model answers as verified primary evidence.

## Input and cost policy proposed for evaluation

Small ad hoc text/images remain possible. Large/repeated PDF and image inputs offer “Add to a knowledge notebook” before enqueue. The owner sees selected files, extraction support, upload destination and estimated repeated council cost. Upload requires a separate action; nothing is silently redirected. Unsupported formats and scanned PDFs remain extraction_unverified; OCR/manual transcription requires a later accepted path and original-page verification. The owner clarified `DIR`: the first increment accepts individually selected files only; directory traversal and ZIP expansion are deferred.

Initial configurable trial ceilings: three notebooks per run, six excerpts total, 1,500 characters per excerpt, 9,000 source characters total and 4,000 characters of optional ad hoc text. These are proposal values, not implemented limits or tokenizer equivalents. Also enforce bytes, retrieval calls, elapsed time and estimated tokens per receiving model; use the smallest applicable context budget after reserving question/history/instructions/output. Show exclusions and request narrower scope when over budget; never silently slice a citation. User-approved exceptions require a fresh preview. Image estimates remain provider-specific.

Show ingestion/OCR/embedding usage, notebook-query usage, council input/output and cache observations separately. Unknown remote cost stays unknown. A cache key binds owner, account, grant, selected notebooks/source versions, query, policy and connector revision; no cross-scope cache. Versionless sources need bounded freshness/revalidation and a visible timestamp. Cache hits avoid some retrieval work, not necessarily council token charges. Quality degradation blocks cost-driven rollout.

## NVIDIA provider preset

Propose a distinct **NVIDIA API Catalog** card/preset (`nvidia`) while retaining `provider = openai-compatible`. Default hosted base URL: `https://integrate.api.nvidia.com/v1`; credentials are required, and the exact model ID is selected explicitly. Locally hosted NIM stays a separate editable compatible connection. Do not infer hosted capabilities from self-hosted NIM documentation.

Represent service identity, wire protocol, endpoint and model capabilities separately. Preserve the service/preset in connection and run provenance, catalog revision binding, usage and pricing records. A catalog check is optional and makes no generation call; failure preserves manual model entry. NVIDIA hosting does not make two instances of the same underlying model independent votes.

Start with web search off, reasoning protocol `none`, no assumed image support and prompt-only structured output until model-specific documentation/fixtures validate JSON object/schema support. Validate all outputs with the existing contract. No silent fallback/retry after schema rejection. Supported reasoning fields, system-role behavior, output caps and usage conventions must be tested per selected model. Do not expose arbitrary provider extras in domain configuration. Existing unknown-outcome receipts and opt-in live tests apply. Do not promise a free tier, universal model eligibility, prices or a successful call.

Today, a manually named “NVIDIA” custom compatible connection can use that base URL and an exact catalog model with conservative settings. This is a configuration path inferred from the adapter and official endpoint, not verified NVIDIA acceptance. This review saves no connection or key.

## Acceptance and implementation order

1. DA-119 agrees this contract and freezes a representative test corpus before picking a production connector.
2. DA-120 implements grants, conversation bindings and normalized contracts with fake connectors; no external writes.
3. DA-121 establishes the local source/version/extraction baseline, then optionally evaluates documented Open Notebook/RAGFlow APIs against it. Cookie-based NotebookLM bridges and Notion are outside scope; an official NotebookLM adapter can be reconsidered only through the admission gate. External evaluation cannot block local delivery.
4. DA-122 implements preparation, context budgets, input routing and frozen council integration. DA-123 adds reviewed candidate intake. DA-124 adds reviewed publication/manual handoff after both foundations are accepted.
5. DA-125 delivers the independently implementable NVIDIA preset and normalized capability checks.
6. DA-126 completes privacy/recovery and quality/cost acceptance before any supported rollout.

Quality study: freeze at least 30 source-grounded questions across Turkish/English documents, selectable/scanned PDFs, tables/images, conflicting/stale sources, multi-notebook and deliberately unanswerable questions. Compare full-source input where it fits with local bounded retrieval under identical council/settings; include an optional service only if admitted. Unsupported extraction cases must show an explicit gap, not masquerade as passed OCR acceptance. Label critical facts and source spans independently of generated answers. Record retrieval recall, citation validity/entailment, unsupported assertions, critical omissions, abstention, latency and all available usage/cost components. Report unmeasured quantities and excluded oversized baselines. The [worked examples](evaluation/KNOWLEDGE_SOURCE_SCENARIOS.md) specify desired behavior, not empirical results.

Proposed release gates: zero unauthorized-notebook disclosure/writes, zero fabricated source IDs, every delivered citation resolvable to its frozen source, zero critical evidence losses on the accepted corpus, and no degradation against the agreed full-source quality baseline. Human-reviewed correctness thresholds must be ratified in DA-119; no universal accuracy claim follows. Test prompt injection, substituted notebook IDs, account switching, stale/revoked grants, scope-changing caches, deleted sources, OCR errors, timeout/crash replay, duplicate writes and external-copy erasure limits. Normal CI uses fixtures only; real accounts and paid queries remain opt-in.

The next coding chat should read this document and its research, confirm which open task is selected, then update the corresponding contracts/domain/application/adapters/persistence/UI and required checks. Do not implement the entire program in one increment. Completed DA-108 and prior correctness/privacy gates retain their recorded status; the knowledge proposal does not supersede them.

## Decisions for owner agreement

- Owner-required policy: exclude brittle private-API/browser-cookie dependencies; prioritize security, quality and maintainability. Proposed implementation: local-first bounded source library; optional documented adapters only after acceptance. NotebookLM and Notion are not required dependencies or benchmarks.
- Recommended: preparation before round 0, exact notebook grants, source excerpts preferred, and separately reviewed write-back with manual fallback.
- The owner accepted the DA-119 trial limits/quality protocol and individual-file scope; independent gold/model measurements remain open. DA-120 is the next contract/fake-adapter preparation. NVIDIA remains separately bounded DA-125 work.

See [dated research and primary sources](research/KNOWLEDGE_CONNECTORS_2026_10_05.md) and [task list](TASKS.md).
