# DA-119 knowledge contract and evaluation protocol

Status: technical preparation, 5 October 2026. The owner explicitly selected individual
files for the first version; directory traversal and ZIP expansion are deferred.
The engineering limits below are reviewable trial defaults, not measured capacity or
ratified quality results. Independent human labels and format assessment remain pending.
This protocol does not authorize uploads, paid calls or a production connector.

## Contract for the first local increment

Reuse the modular monolith, PostgreSQL and encrypted persistence. A collection is an
owned local topic library. A conversation selects exact granted collections; empty
selection denies retrieval. Scope includes owner, collection, grant and source-version
identities. Topic text cannot grant access. No source, title or existence hint from an
unselected collection enters results, caches, prompts, logs or exports.

Only explicitly selected UTF-8 text/Markdown and selectable-text PDF files enter the
initial extraction path. Preserve immutable original bytes, byte/text digests, parser
version and page/span mappings. Selected images/scanned PDFs may be retained as bounded
originals, but remain extraction_unverified and supply no invented evidence. HTML,
office documents, archives, recursive folders, symlinks and cloud OCR are deferred.
No absolute disk path, credential or hidden file is accepted as a retrieval argument.

Preparation is explicit and separate from enqueue: inspect scoped sources, retrieve
or manually select exact passages, show omissions and review recipient members. Freeze
the exact packet and bind it to prompt/risk review. Revalidate authorization when
enqueuing and before the first provider submission; never silently fetch updated text.
All receiving round-0 members get identical source bytes independently. A source copied
to two collections is one evidence origin. Cross-review keeps the existing peer contract;
private branches, automatic schedule refresh and autonomous model retrieval are deferred.

Local reuse requires separate content and freshness review. External publication needs
separate exact payload/destination consent and durable intent/read-back; no connector
is admitted by this preparation. Unknown remote outcomes never cause blind resend.
Revocation blocks future use, including continuation/cache reuse; historical frozen
copies stay inspectable until separately reviewed erasure. Backups/exports remain copies.

## Trial ceilings and operating targets

All limits are intersected: exhausting any one produces a visible refusal and narrower
selection/manual fallback, not silent slicing. Count JavaScript UTF-16 code units for
character ceilings and decoded bytes for byte ceilings; token estimates are separate.

| Boundary | First trial ceiling/target | Verification |
| --- | --- | --- |
| Selected collections | 3 per preparation | Empty/foreign/substituted grants denied |
| Selected file batch | 6 files, 12 MiB decoded total | Reject before parsing or storing |
| Individual original | Text/Markdown 1 MiB; PDF 5 MiB; image 2 MiB | Signature/encoding checks; no archive expansion |
| Extraction | PDF 100 pages; 64,000 characters/source; 10 seconds/file | Complete extraction or explicit failure; no hidden truncation |
| Local automatic search | 30 active source versions and 1,000,000 decrypted UTF-8 bytes across selected collections | Preflight bounded inventory; refuse before body scan when exceeded |
| Context packet | 6 whole excerpts; 1,500 characters each; 9,000 total | Exact spans/citations; budgets include provenance overhead |
| Extra ad hoc text | 4,000 characters | Existing question limits remain independent |
| Receiving-model input | Minimum of 8,000 estimated source-packet tokens and each member's known remaining context | Reserve question/history/instructions/output; unknown capacity denies automatic delivery |
| Local preparation | One active preparation per owner; 5 seconds total deadline | Cancellation/timeout visible; no dispatch after expiry |
| Optional adapter | At most 3 read calls per preparation, 10 seconds total; disabled initially | Admit only after auth/scope/receipt/recovery study |
| New infrastructure | No new database/service/GPU/cloud credential required locally | Clean-machine setup checklist |
| Local setup/maintenance | At most 30 minutes excluding dependency download/initial extraction; at most 30 minutes/month routine duties | Record actual timed steps on the owner's host; proposed until measured |
| Search responsiveness | p95 at most 2 seconds on the bounded trial corpus | 30 cold + 30 warm preparations on recorded host; no model time included |
| Memory | At most 256 MiB incremental process RSS during bounded retrieval | Measure baseline/peak; fail or narrow workload above target |

The file/extraction limits deliberately reuse existing attachment/parser ceilings where
possible; they do not change current attachment routes. Larger collections require a
later measured budget/index design. No plaintext persistent index or embedding store.
Failed extraction cannot be marked complete merely because some text was obtained.

## Frozen cohort and coverage limits

[KNOWLEDGE_EVALUATION_PLAN.json](KNOWLEDGE_EVALUATION_PLAN.json) binds the exact bytes of
this protocol and the existing [40-case external suite](COUNCIL_EXTERNAL_SUITE.json),
plus its source/intake manifest hashes and all case identities. It reuses historical
captured excerpts without claiming live verification of their URLs. Twenty development
and twenty held-out cases remain separated by document, content and question family.
There are 26 Turkish, 10 English and 4 mixed questions over 11 English source snapshots.
Existing conflict/numeric/qualification cases are retained, rather than rewriting them
after retrieval results. This is an implementer-selected candidate cohort, not a
representative or independently labeled gold corpus. No existing human reviews are
implicitly accepted for this new retrieval study.

The plan also freezes ten synthetic boundary challenges: empty scope, foreign source,
scope-aware cache, revocation, injection, versions, unknown publication, no-answer,
unsupported scan and duplicate evidence. Their policies are mechanical expectations,
not independent semantic labels. They are not counted toward the 40-case quality denominator.

Four binary fixtures and eight additional format questions are frozen in the plan:
an English selectable PDF derived from the existing Sun excerpt, a Turkish synthetic
status/version table, an image-only scanned PDF and its deliberately ambiguous source
PNG. All three PDFs were rendered and visually inspected; text-layer checks distinguish
the selectable files from the empty-text scan. These are evaluation inputs, not accepted
parser/OCR outputs or independent evidence. Source families and derivatives stay in
development; DA-121 must freeze the extracted spans/parser provenance before format
results are examined. Binary hashes bind both reviewer format forms to their originals.
At least 30 independently labeled questions must cover the agreed formats, languages,
conflicts, staleness, multiple collections and deliberate no-answer cases before the
DA-126 quality gate can pass. The text cohort alone cannot satisfy that requirement.
Unsupported scan/image cases require explicit abstention; they do not establish OCR quality.

## Independent labels and experiment

`pnpm knowledge:prepare` writes two new blank text/format reviewer sets and an approval form under
ignored `.local/knowledge-evaluation/`. It refuses existing files. Reviewer forms omit
split/risk labels and model output and retain exact questions/source snapshots. Two
distinct humans supply source-grounded claims, criticality and exact unique quotes;
the existing compiler checks immutability/spans. Format forms require inspection of the
original page/image; they have no prefilled claims, OCR labels or judgments and are not
accepted by the text compiler. A third human adjudicates all text claims
and exclusions using `knowledge:adjudication:prepare` / `knowledge:adjudication:compile`, with coordinator attestation
of independence and corpus coverage. Do not auto-fill names, judgments or acceptance.
Use `pnpm knowledge:compile-reviews` to validate these new review forms; they do not
overwrite or consume earlier `.local/external-council-labeling/` evidence.

Freeze labels, corpus extension, settings and protocol hashes before any held-out model
result is examined. Compare full-source input, manual bounded excerpts and the local
lexical policy with identical council members, risk, rounds, output caps and source
versions. Full-source means the entire retained snapshot, not an invented complete
remote document. Ineligible context-size baselines remain explicit exclusions. Record
all attempts, failures and unknown outcomes; no favorable-run selection or silent model
substitution. Models never supply gold labels. Paid/live runs remain separately opt-in.

## Metrics and release gates

| Measure | Definition and trial gate |
| --- | --- |
| Retrieval critical recall | Human critical facts with supporting/conflicting exact spans in delivered packet / all labeled critical facts; 100% on accepted eligible corpus |
| All-fact retrieval recall | Delivered labeled facts / all labeled facts; at least 95% overall and each required language/format slice |
| Citation identity validity | Resolvable frozen source/version/span with matching bytes / all delivered citations; 100% |
| Citation entailment | Independently judged supported claims / all evidence-backed generated claims; at least 95%; zero critical unsupported assertions |
| Answer coverage | Represented gold facts / all gold facts; unknown/failed outputs count missing; at least 95% overall and required slices |
| Baseline comparison | Paired raw counts and per-case differences; zero additional critical loss versus full-source baseline; no decline in observed coverage/entailment |
| No-answer behavior | Every gold unanswerable/unsupported-extraction case explicitly exposes insufficiency; no invented critical facts |
| Scope/operation safety | Zero unauthorized source disclosure/writes, fabricated source IDs or duplicate remote submissions in fixtures |
| Recovery | Originals, spans, grant revisions, revocation and historical packet equality survive disposable restore; old binaries never open an unreviewed migrated DB |

Report denominators and excluded/unknown cases beside every score. Empty required slices
block acceptance; do not make a percentage from missing labels. Include source-family
clustered paired uncertainty estimates in DA-126; 40 correlated questions alone do not
establish population non-inferiority. An inconclusive comparison blocks a quality/savings
claim. Any protocol/label/fixture change creates a newly hashed study version before
results, never an edited favorable held-out result.

Record observed/estimated input/output/cache counters by provider convention, extraction,
retrieval and council latency separately, plus setup/update/restore effort. Unreported
price, invoice, OCR/embedding cost or usage is unknown, not zero. Cost savings cannot
compensate for critical loss, unauthorized access or unsupported assertions.

## DA-119 completion boundary and next task

Technical preparation can pass hash/split/duplicate/tampering checks and prepare blank
forms without model or database calls. It does not complete independent labeling,
ratify all trial thresholds, admit any adapter or pass DA-126. DA-119 remains partial
until the owner reviews the concrete protocol and independent labels/format coverage
are frozen. Format binaries/questions are frozen; format reference labels are not.
DA-120 may be prepared against these contracts with fixtures; acceptance
must retain those open dependencies. Runtime ingestion belongs to DA-121/122.
