# Reviewed retained run-body deletion — DA-102

Local functional verification: 3 October 2026. The original dependency finding is
resolved in the current graph by [DA-103](DEPENDENCY_MITIGATION.md).
This removes one owned terminal run's stored content without waiting for retention age.
It does not erase a complete conversation/account, independent inputs or every copy.

## Owner workflow

In **Son çalışmalar**, choose **Çalışma silmeyi incele**. The read-only preview identifies
the exact run, affected record counts, retained records and blockers. Review the checkbox,
then separately choose **Çalışma içeriğini kalıcı olarak sil**. Opening/cancelling or
refreshing removes nothing and sends no model request. History navigation is disabled
during review. Confirmation removes the active report view if that run is open; the
owner's question draft and model choices remain. Local unsaved context/selections are
separate ephemeral copies, not a storage-erasure boundary.

Only completed, partially completed, failed or cancelled runs are candidates. Pending
prepared/submitted/outcome_unknown/retry_authorized provider operations block removal.
A live council execution fence also blocks apply even after an acknowledged unknown
closure. All decision-assessment aggregates are outside this version, including terminal
ones: their execution path has no equivalent session fence. Deletion does not discard,
cancel, retry, retrieve or refund any provider operation, and does not enable JEV.

## Content removed and records retained

The reviewed closure is `runs`, `model_runs`, `claims`, `claim_occurrences`,
`memory_entries`, `evidence_sources`, `research_captures`, `provider_operations`,
`run_events` and the registered decision tables (which must be empty for an eligible
target). The existing declared cascades remove the question, report, raw replies,
attachments, frozen input/history/original compaction archives, risk/preflight/prompt
snapshots stored on the run, claim quotations, run-owned memory/source/capture content
and provider result/error text. One recorded council queue job is removed atomically;
stale worker delivery finds no body and performs zero provider requests.

Before removal, an encrypted content-free audit retains run/conversation identity,
hashed creation intent, reviewed fingerprint, deletion time and terminal status.
Each provider receipt preserves operation/member/provider/model identifiers, round,
attempt, status, timestamps, nullable observed input/output counts, validated token
details and optional price snapshot ID. It excludes question/report/raw/result/error
text, attachments, citations, credentials and raw creation keys. Metadata is not
anonymous information; observed usage is not an invoice, refund or spending budget.

Conversation identity/memberships remain and project the removed body as unavailable.
An owned conversation export adds `runDeletions` beside active runs/private branches
within the existing export version. The audit uses logical identifiers without FKs
and survives later eligible DA-095 empty metadata deletion. Exact confirmation replay
returns the same audit; a different fingerprint is rejected. Original creation/rerun
intent keys cannot recreate deleted content; genuinely new reviewed intents remain possible.

Independent billing/correction/payment/statement evidence remains. Preflight draft
questions/requests and schedule templates remain, with only their run/last-run FK set
to null. Independent MCP tool results and downloads/backups remain. Existing backups
can restore removed content. Local unsaved text/context and underlying storage remanence
are outside this scope. Existing age-based `db:prune` policy is unchanged and does not
create DA-102 audits; no general accounting-retention guarantee is inferred from this feature.

## Copy, ownership and schema guards

Owned continuation, rerun, original archive, report and selected-memory/tool snapshots
are inspected for source identifiers, including nested JSON saved as text. A surviving
owned copied run/private branch blocks source-body removal. Each leaf needs separate
review; there is no cascade through logical source relationships. Unavailable intermediate
sources do not hide original JSON provenance. This checks managed structured references,
not semantic similarity or all possible free-text copies.

Target and associated content ownership/membership/relationships must agree. Foreign
targets return unavailable; foreign source references and cross-run cascade relationships
block removal without exposing foreign IDs. Unrelated foreign rows are preserved and do
not disable this target. Only owned bodies are decrypted; this does not add multi-owner
authentication or promise deletion of opaque foreign/external copies.

Exact columns/types/nullability and reviewed FK targets/actions are checked across the
protected tables. Unexpected incoming cascade dependencies or custom triggers block.
The existing evidence/research immutable update triggers are permitted only with the
reviewed names, update-only type, language, enabled state and full normalized function
bodies. New tables/relations require deliberate registration and policy review.

Inspection is bounded to 1,000 owned run/private bodies and 64 MiB across the installation,
10,000 affected content rows/64 MiB per target, 500 provider receipts, 1,000 records per
related retained category and 1,000 owner deletion audits. Structured provenance walks
are bounded to one million visited nodes per inspected value. Generated audit is at most
512 KiB; conversation audit export is bounded to 32 MiB. Oversize, unreadable or incomplete
inspection closes the boundary; checks are not silently truncated.

## HTTP and atomicity

- `GET /api/runs/:id/deletion`: owned read-only repeatable-read preview.
- `POST /api/runs/:id/deletion`: same-origin strict JSON with matching `runId`,
  SHA-256 `fingerprint`, `confirmContentDeletion: true` and
  `acknowledgeRetainedRecords: true`. Actual streamed body is capped at 4 KiB.
- `GET /api/runs/:id/deletion-receipt`: owned retained audit after removal.

All responses are `no-store`. Invalid/absent/foreign IDs return 404, invalid confirmation
422, oversize 413, blocked/stale state 409. Unreadable unexpected failures return a fixed
error without leaking content. No automatic confirmation repeat occurs. A lost committed
response preserves the reviewed fingerprint for a manual repeat.

Apply takes the conversation owner lock, tries the existing council worker advisory lease
without waiting, then locks the protected tables. It repeats inspection and fingerprints
all target/affected content rows, including exact PostgreSQL timestamps, plus relevant
membership/retained-record identities. It inserts audit, removes the recorded queue job
and deletes exactly one owned run atomically; any failure/count drift rolls back. Owner
serialization also prevents creation/rerun intent replay after deletion. Table locks may
briefly delay writes; lock wait is five seconds and SQL statement timeout ten seconds.

## Rollout and remaining scope

Additive `0047_kind_supreme_intelligence.sql` creates `run_deletions`, indexes and unique
owner/hashed-intent constraint. It was applied locally and deletes no rows. Run
`pnpm db:migrate` before using this version and restart processes still running old code.
The audit context is `run-deletion:<id>:audit`; exhaustive backup inventory authenticates
strict JSON and row metadata. Historical archives predating the entire table remain
supported. Populated actual disposable restore verifies ciphertext equality and absent body.

[Functional verification](DA102_ACCEPTANCE.md), [decision](adr/0029-reviewed-run-body-deletion.md).
DA-103 resolved the lint dependency gate. Reviewed preflight draft content deletion
is the next bounded privacy increment (DA-104).
Decision execution fences, age-retention accounting unification, partial/cascading copies,
backup/export erasure and full account deletion remain separate work.
