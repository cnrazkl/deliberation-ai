# Restored queue target reconciliation

DA-126 recovery preparation now extends `pnpm db:backup:rehearse` with aggregate
target reconciliation in the disposable restored database. Backup creation and
verification run the same check. This is a diagnostic, not a cutover approval or
cleanup command. It starts no PgBoss instance, worker or provider request.

The inspector checks the fixed council `runId`, decision `assessmentId`, and
private `branchId`/`operationId` payload fields inside PostgreSQL. Objects must
contain string UUIDs in canonical hyphenated form (either case); invalid/missing
values are `malformed_payload`. Additional fields are ignored as in worker target
selection. No payload, output, job/target identifier, owner or question is returned.
The installed queue partitions are included via the parent job table.

Counts are separated by queue category and all six stored job states:

| Relation | Meaning |
| --- | --- |
| `malformed_payload` | Required target fields fail the limited shape check. |
| `schema_unavailable` | Valid-shaped target, but its entire feature table is absent. |
| `missing_target` | Target table exists, but no row has that identifier. |
| `linked_job` | Council/decision row records this exact job ID. |
| `different_job` | Council/decision row records a different job ID. |
| `unrecorded_job` | Council/decision row has no recorded job ID. |
| `branch_present_receipt_unchecked` | Private branch exists; delivery receipt is not checked. |

Present council/decision targets also contribute separate stored application
status counts. `partially_completed` is the persistence council status. A waiting
job can point to a terminal record; linkage does not authorize dispatch. A different
job may reflect a later retry; a missing terminal target may reflect retention or
deletion. No cause is inferred, and no job is cancelled, repaired or resent.

The private check intentionally reads no branch ciphertext. Branch existence does
not establish that the named delivery exists, originated in that branch, is current,
is dispatchable, or has a known provider outcome. Delivery/audit reconciliation is
still required. Unknown queue names remain counted only by the separate `other`
[state inventory](RECOVERY_QUEUE_INVENTORY.md); their targets are not inspected.
The diagnostic does not validate ownership/authorization, receipt history, job
dependencies, stale connection revisions or current-versus-archive changes.

Absent feature tables are explicit for valid jobs. Empty queues yield zero counts;
schema availability also remains visible in the existing
[operation inventory](RECOVERY_OPERATION_INVENTORY.md). Present but incompatible
tables, invalid aggregate states/statuses/counts and query errors refuse verification
with a fixed message, hiding underlying database diagnostics. Only fixed internal
table/field identifiers are interpolated; archive values stay SQL parameters or
database expressions. No runtime schema or API changes are introduced.

## Observed saved archive

The saved 6 October post-migration archive was restored again on 7 October. All
246 `created` decision jobs have valid target shapes but missing assessment rows.
Council `completed` jobs comprise 68 missing targets, 54 exact recorded links and
9 different recorded links; the 16 cancelled council jobs have missing targets.
The 186 completed and one failed private job have missing branch targets.
No malformed job is observed in these known queues. These are archive observations,
not the current database or an instruction to remove/resume anything. The archive
also passes exhaustive encryption verification: 12,005 values in 11 populated tables.

## Verification and remaining acceptance

Three offline cases cover projection, unknown/inconsistent/duplicate/overflowing
aggregates, historical missing schemas and fixed error redaction. A generated
PostgreSQL case uses real current tables and queue partitions: malformed scalar,
array, object and UUID inputs; uppercase UUID; missing/exact/different/unrecorded
targets; absent historical tables; unreadable private ciphertext; unchanged queue
states/timestamps and payload/output hashes. The existing synthetic decision test
checks an actual queued assessment link. Actual private dump/restore compares the
same target inventory before and after restore. No owner history is changed.

Private origin receipts/deletion audits, current-versus-archive reconciliation,
manual replacement cutover/rollback, historical binaries and independent human,
model and cost acceptance remain open. DA-126 is incomplete.
