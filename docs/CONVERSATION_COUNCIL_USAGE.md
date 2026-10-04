# Conversation council usage — DA-118

The saved report's **Konuşma kaydı** offers expandable, independently fetched council
and private usage summaries. **Konsey kullanımını getir** starts only a metadata read.
Each summary shows its own snapshot time; they are not a synchronized combined ledger.
Private origin/copy accounting remains DA-115. Neither summary is an invoice or monetary
budget. This does not extend provider authority or council consensus.

The no-store GET `/api/conversations/[id]/council-usage` reads one owner-scoped,
repeatable-read, read-only snapshot. It includes indexed run provider operations and
authenticated retained run-deletion receipts. Each operation ID appears once; duplicate
live/audit identities or audit/live run overlap fail closed. Reused/copied model replies
without a new provider operation add no operation. Retries with distinct IDs remain
separate, including metered failures. Request/response text, fingerprints, remote IDs,
price/billing evidence and credentials never enter the DTO.

Limits: 200 indexed members, 10,000 live operations, 32 MiB live projected text/metadata
ciphertext plus a conservative fixed-field allowance per row;
8 KiB provider/model/status text per live row;
existing deletion loader bounds of 1,000 rows / 32 MiB and per-audit authentication;
2 MiB projected output. Foreign membership/run ownership/audit ownership, audits outside
membership, pending indexing and unreadable records refuse the read. Missing or foreign
conversation IDs return 404. There is no SQL migration or dispatch/adapter change.

Groups use provider, requested model, round and provider counter conventions. Model
identity is explicitly the requested model; deleted audits cannot reconstruct connection
identity or confirmed returned models. This is separate from private connection/observed
model grouping. Coverage denominators are **operation records**, including prepared
records; they are not actual API-call counts. Old deletion receipts lack submission
timestamps, so the summary does not invent them or reconstruct call counts.

Missing counters remain unknown, provider-reported zero remains zero, and partial totals
show known subtotal plus reported/record denominator. A complete group counter requires
every record's value. Input/output/cache/reasoning/tool-input/provider-total remain
separate. Inclusive counts are not added twice; no provider total or cross-group grand
total is reconstructed. Unknown conventions remain explicit. Pending/retry-authorized
and unknown/discarded states remain visible.

Missing run bodies with no deletion audit and runs with no receipt records are counted
separately; neither proves zero usage. The projection is limited to retained indexed
conversation records, not provider histories or erased external backups. It does not
complete council/private price, invoice or settled-cost reconciliation.

Fetches abort on unmount and fence late responses. Refresh clears old data before reading;
an error does not retain an apparent successful total. ConversationPanel binds the loaded
conversation to its requested run ID so navigation cannot show another run's usage.
Existing retained raw replies, minority claims and detailed receipt inspections remain.

## Verification

Domain cases cover zero/missing coverage, prepared receipts, differing rounds/providers/
models/conventions, duplicates, invalid counters and retry uncertainty. PostgreSQL fixtures
cover independent council/private counting, metadata-only projection, deletion retention,
foreign audits and missing bodies/owners. Real-worker private browser flows also inspect
council metadata, unknown counters, no-store/invalid-ID behavior, failed-refresh clearing
and 390px layout. Current acceptance counts are in CURRENT_STATE.md.

4 October acceptance: 297 units, all 210 isolated PostgreSQL cases (including actual
disposable archive restore), six focused real-worker browser cases, type checks,
zero-warning lint and separate-output production build passed. The 390px council
summary was visually inspected and page-width assertion passed. A final SQL scan-bound
strengthening was followed by the complete isolated integration repeat; integer-overflow
protection was verified by the unit repeat. No full browser sweep, physical-device
acceptance, migration, real owner deletion or paid provider call is claimed. Interactive
3000 remains HTTP 200 with ready database and one worker after browser teardown.
