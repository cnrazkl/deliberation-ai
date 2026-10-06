# Restored queue inventory

`pnpm db:backup:rehearse` now includes a separate `pgboss.job` inventory from
the restored archive. Queue job states supplement the existing application
[operation inventory](RECOVERY_OPERATION_INVENTORY.md); they are not provider
outcomes, live worker status or permission to resume work.

The installed pg-boss 12.33.0 schema stores six states: `created`, `retry`,
`active`, `completed`, `cancelled`, `failed`. The read-only aggregate query covers
the parent job table, including its partitions. It reports all six counts for
the council, decision and private delivery queues. Other queue names are grouped
as `other`; their names, IDs, payloads and outputs are never selected or printed.
An empty present job table yields zero counts. A missing/incompatible table,
unknown state or invalid aggregate refuses verification with a fixed error.
Review this contract when upgrading the queue schema.

`futureStartAfter` counts only `created`/`retry` jobs whose stored `start_after`
is later than the reported `checkedAt` inspection time. It is a subset of their
state counts, not additional work. This is not the archive's creation time and
does not establish when a job will run: dependencies, blocking, queue policies,
worker availability, expiry and reconciliation still apply. An archived `active`
job is a stored state, not proof that a provider is currently executing.

Before starting a replacement worker, inspect created/retry/active jobs in every
category, including `other`, together with application operations and schedules.
A zero application count cannot establish an empty queue; a completed queue job
cannot establish a successful provider result. The inspector neither starts
PgBoss nor registers/consumes/cancels/retries/purges any job. It does not compare
payload targets against run/branch receipts or provide an automatic cutover gate.
Actual replacement cutover, current-versus-archive reconciliation, historical
binary compatibility and external backup/export deletion remain open.

## Verification

Three offline cases cover pending/active/terminal states, deferred work, other
queues, invalid/duplicate aggregates, metadata-only SQL and fixed error redaction.
A disposable PostgreSQL case provisions the real queue schema without a worker,
then inspects all six states and deferred private/decision/other jobs. Job state,
timestamps and payload/output hashes remain unchanged; a missing job table is
refused. The existing actual private custom-format dump/restore checks identical
queue inventories between its synthetic source and restored databases. Normal
CI includes the offline cases; generated PostgreSQL evidence remains local.

The saved 6 October owner archive restores successfully and contains 246 created
decision queue jobs despite empty decision assessment/operation tables. This is an
archive observation requiring target reconciliation before cutover. It does not
describe current live work, enable the decision adapter or authorize deletion/replay.
