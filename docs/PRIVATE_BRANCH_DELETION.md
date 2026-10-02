# Reviewed private branch content deletion — DA-101

Accepted locally on 2 October 2026. This removes the stored content of one owned
private branch, after explicit review. It is not a cascade, partial-message editor,
provider cancellation/refund, secure storage wipe or complete conversation/account erasure.

## Owner workflow and scope

Open an owned branch and choose **Dal içeriğini silmeyi incele**. The read-only preview
identifies the target, saved message/receipt counts, copied origins and blockers. Read
the retained-record/external-copy explanation, check the confirmation and separately
click **Özel dal içeriğini kalıcı olarak sil**. Preview/cancel/refresh sends no model
request and removes nothing. Branch switching and editing are disabled during review.

Copies must be removed individually first. Both parent links and authenticated message
or delivery origin links count, including detached/cross-conversation owned copies.
Prepared, submitted and outcome-unknown deliveries block deletion. Existing cancellation
or acknowledged closure controls resolve those states; deletion cannot silently discard
them. A worker still executing blocks apply even after acknowledged unknown closure.

Confirmation removes exactly one `conversation_private_branches` row: copied seed,
saved owner messages, frozen requests, results and reply text. Source council reports,
other private branches and conversation metadata remain. Cancelling preserves unsaved
text; successful confirmation moves it to the separate read-only **Silinen dalın
kaydedilmemiş taslağı** display on the current page. This draft is not in the database
or retained audit and is lost on page reload/close. The owner can copy it beforehand.

## Retained records and limits

`private_branch_deletions` stores deleted branch ID, owner, logical conversation ID,
original creation/fork request ID, deletion time and encrypted audit. There are no
foreign keys: later eligible empty conversation metadata deletion retains this audit.
The strict `private-branch-deletion-audit-v1` payload keeps source/parent identifiers,
review fingerprint, saved message count and per-receipt operation/origin/connection
identifiers, terminal status/timestamps and nullable observed usage. It excludes source
question, seed, owner messages, request/result/reply/error text and credentials.
Identifiers are retained metadata, not anonymous information.

Copied receipts keep their origin and are not fresh calls. Missing provider counters
remain unavailable. Deletion does not undo usage, settle billing or refund charges.
Terminal pg-boss identity jobs can remain until normal queue expiry; replay finds no
branch and performs zero provider requests. Audit records have no automatic prune.

Owned conversation export adds `privateBranchDeletions` beside active `privateBranches`
within the existing envelope version. Deleted content is absent from active branches.
AES-GCM context `private-branch-deletion:<id>:audit` is registered in the exhaustive
backup encrypted-field inventory, with strict JSON/metadata validation. Historical
archives predating the entire table remain supported. Existing backups/downloads stay
independent copies; restoring an older archive may restore content. No forensic or
all-copy erasure is claimed.

## HTTP and transaction boundary

- `GET /api/private-branches/:id/deletion`: owned read-only preview, `no-store`.
- `POST /api/private-branches/:id/deletion`: same-origin, strict JSON with matching
  `branchId`, SHA-256 `fingerprint`, `confirmContentDeletion: true` and
  `acknowledgeRetainedMetadata: true`. Actual streamed bytes are limited to 4 KiB.
- `GET /api/private-branches/:id/deletion-receipt`: owned retained audit, even after
  branch removal. Absent/foreign/invalid IDs return 404; confirmation errors return
  422, oversize 413, blocked/stale state 409. Responses are `no-store`.

Preview uses a read-only repeatable-read transaction and ten-second SQL timeout.
It validates target ownership/content, exact supported columns/types/FKs, absence of
custom triggers, copy provenance and audit capacity. Any foreign private row closes
the local-owner boundary without exposing foreign IDs. Unreadable peer content also
blocks. Inspection is limited to 1,000 owned active branches and 32 MiB encrypted
content across the installation; audit capacity is 1,000 records per conversation,
with a 64 KiB maximum generated audit. Limits block deletion, never truncate checks.

Apply takes the established owner lock, tries the worker advisory lease without
waiting, then takes share-row-exclusive locks on branch/audit tables. It repeats all
checks and compares the fingerprint of the complete target row, including revision,
ciphertext and timestamps. It atomically inserts audit and deletes exactly one row;
count mismatch or failure rolls back. Lock waits are capped at five seconds and SQL
statements at ten seconds. New copies/content/state require new review.

Concurrent or manually repeated confirmations with the same fingerprint return the
same retained audit; a different fingerprint is rejected. The UI does not automatically
resend. A lost committed HTTP response preserves review for manual retry. Original
create/fork request IDs are tombstoned: replay cannot recreate the deleted branch.
A genuinely new reviewed creation with a new request ID is a separate intent, not a
hard financial reservation.

## Rollout and evidence

Additive migrations `0045_mature_network.sql` and `0046_tired_cable.sql` create the audit
table/index and add the original request ID/unique owner-request constraint. Both were
applied before acceptance; no retained owner rows were removed. The initial migration
was applied locally before the replay key was added, so the second preserves append-only
migration history. Deploy both together before exposing this feature; there is no
supported intermediate-version audit backfill.

[Acceptance](DA101_ACCEPTANCE.md) covers 272 unit tests, 162 isolated PostgreSQL tests,
25 browser flows and a populated actual archive restore. All destructive cases use
generated fixtures. [Decision](adr/0028-reviewed-private-branch-deletion.md).

Next: reviewed retained run-body deletion beyond age-based retention, with copied
archives, unresolved receipts, accounting and metadata consequences defined. Partial
message removal, cascading copies, external archive erasure and full account deletion
remain separate policy work.
