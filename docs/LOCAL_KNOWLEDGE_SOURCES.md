# DA-121: local source foundation

Implemented backend increment, 5 October 2026. [DA-120 scope](KNOWLEDGE_SCOPE.md)
and the owner-accepted [trial protocol](evaluation/KNOWLEDGE_EVALUATION.md) remain
prerequisites. This adds selected-byte intake and read APIs, without library UI,
HTTP upload routes, council context packets, OCR or an external service. DA-122 owns
input routing, immutable evidence packets and the six-excerpt/9,000-character budget.

## Selected files and extraction

`importKnowledgeFiles` accepts individually selected bytes, a leaf filename, an
explicit source UUID and the expected active version. Paths, directories, ZIPs,
HTML/XML/SVG disguised as text, invalid UTF-8, signature/type mismatches and unknown
formats are refused. Each batch is atomic and contains at most six files/12 MiB.
UTF-8 TXT/Markdown is limited to 1 MiB; PDFs to 5 MiB; PNG/JPEG originals to 2 MiB.
Inputs are copied before the first asynchronous operation.

Text normalizes line endings. PDF.js extraction records its installed version,
original SHA-256, complete normalized text, whole-text SHA-256 and numbered page
spans with hashes. Offsets are UTF-16 into that exact normalized text, not byte
offsets into the original PDF. Table text order is the parser's order; no table
semantics or factual correctness is inferred. The original bytes remain available
through explicit scoped export for comparison.

PDF parsing runs in a separate Node process with a 192 MiB JavaScript heap setting,
at most ten seconds, 100 pages, 64,000 characters and 512 KiB output. It receives
selected bytes through stdin and no application credentials/environment. The parent
kills overdue workers. This is process separation, not an OS security sandbox or
a hard RSS ceiling. Recognized active actions/embedded files reject the entire batch.
Malformed PDFs, parser outages, timeouts and extraction overflow retain an encrypted
failed original with a fixed reason and no partial usable text.

Images have no OCR and remain `extraction_unverified`. Any PDF page without text
makes the whole version `extraction_unverified`; candidate page text may be inspected
but cannot become an excerpt or a search hit. `complete` means machine extraction
completed, never human approval of content. Four frozen binary fixture extractions
are recorded in [the mechanical snapshot](evaluation/KNOWLEDGE_EXTRACTION_SNAPSHOT.json).
`pnpm knowledge:extraction:verify` checks it without rewriting or labeling fixtures.

## Versions, retries and storage

Migration 0051 adds source heads and immutable source versions. Original bytes/name
and extracted text/pages are separate authenticated ciphertexts bound to the exact
version and payload kind. Identity, hashes, parser version, status, byte counts,
creation time and source/collection links remain plaintext metadata. No plaintext
search index, embeddings, filesystem original cache or persistent excerpt cache
is created. Backups inherit ciphertext; explicit exports contain plaintext.

An intake lease admits one import per owner. Limits are 120 retained versions and
128 MiB original bytes; those engineering storage limits do not change the accepted
per-batch trial limits. Active-version updates use expected-version checks. Repeating
identical bytes with the same parser reuses their version; a changed source creates
a new version while old quotes remain readable. Names on reused versions stay frozen.

Only an explicit `retryFailed` request against an exact current `timeout` or
`parser_unavailable` version reparses identical bytes. Its deterministic new attempt
identity makes a lost acknowledgement replay safe. The previous failed version stays
inspectable. There is no automatic retry, mutable extraction repair or retry of an
unchanged completed/unverified/invalid file. A new parser release creates new
provenance; it cannot silently replace old quotes or the frozen extraction snapshot.

## Scoped manual and lexical retrieval

Every read verifies current owned local grants before and after a repeatable-read
snapshot. Intake checks grants again after parsing and before atomic publication;
revocation can proceed during parsing and rolls back the batch. A regrant does not
revive old scope revisions. The conversation reader binds the exact selection UUID
and all selected scopes through the application policy gateway. Empty/unselected
scopes deny access before retrieval. Models cannot call these operations.

Listing returns 20 sources per page with an explicit cursor and extraction status.
Manual inspection/export addresses an exact source/version. Selected excerpts are
at most 1,500 characters, wholly inside one recorded page, with exact substring and
hash. A deterministic UUID locator binds version, whole-text hash, page and span;
it grants no access and is checked against the retained version on every read.

Lexical search scans all active sources across the selected one-to-three collections,
limited to 30 sources/1,000,000 UTF-8 text bytes in total. Metadata checks precede
decryption; ciphertext and five-second execution limits also apply. Exceeding a
limit refuses the operation and asks for narrower selection/manual inspection; it
does not silently drop sources. Search never decrypts originals.

`lexical-and-first-window-v1` matches all one-to-twelve normalized query terms in a
source and returns the first matching page window, occurrence count and inspectable
source identity in stable source-ID order. It exposes scanned and unavailable-source
counts. Other matches are not exhaustively excerpted; this is a lexical candidate,
not semantic ranking, relevance/entailment verification or recall acceptance.

## Recovery and operating boundaries

No source table references runs; run retention preserves library versions. Selection
clearing and conversation deletion do not erase sources. There is no source deletion
API in this increment, so storage exhaustion requires future reviewed lifecycle work
or a narrower test scope, never automatic pruning of cited history.

The exhaustive backup auditor authenticates both payloads, byte/text/page hashes,
ownership and active-version relationships. It accepts archives preceding the entire
source era but rejects partial eras. A generated-only custom dump/restore checks
identical ciphertext, raw bytes, old quotes, updated search and revoked access.
Custom SQL update/relationship triggers live in 0051; Drizzle's snapshot records
tables/indexes rather than those triggers. Preserve the SQL during upgrades.

Existing local Node/PostgreSQL tools suffice; no service, GPU or external adapter is
needed. Clean-machine setup time and monthly maintenance burden are unmeasured.
Operators must retain the separate encryption key, rehearse restore and explicitly
review parser/dependency upgrades. The owner database was not migrated. Backend
HTTP/UI integration must verify packaged worker assets before enabling intake.
Independent human format/source reviews and live quality/cost acceptance remain open.
[Verification](DA121_ACCEPTANCE.md), [ADR-0036](adr/0036-local-knowledge-source-versions.md).
