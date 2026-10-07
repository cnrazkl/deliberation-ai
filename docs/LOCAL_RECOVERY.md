# Local replacement recovery and operating policy

This is the complete implementation scope of the Group 5 main task for replacement
installation/cutover/rollback, backup/export deletion and deeper operational alerts.
It targets the Windows, loopback-only installation. Public deployment, independent
human quality acceptance, authoritative billing, another physical machine and a
month of maintenance observation remain separate gates.

## Managed daily runtime

`pnpm app:start` starts the provisioned portable DB if needed and a managed web/worker
pair on 127.0.0.1:3000. `pnpm app:status` checks DB readiness and exactly one worker.
`pnpm app:stop` refuses known pending/uncertain work and stops only process trees
whose command lines contain the stored random identity. DB records remain. Logs
and process identity live in ignored `.local/runtime/`. This is a current-session
launcher, without automatic login/crash restart, upgrades or migration.
An occupied TCP listener blocks a second launch even when HTTP is slow; unknown
listener/diagnostic state refuses launch/stop rather than guessing readiness.

## Replacement rehearsal and reconciliation

Stop editing, pause schedules, inspect unresolved council/private/decision/probe
outcomes and stop web/worker before a version change. Explicit resolution must
preserve uncertainty. Terminal council runs with prepared/retry-authorized receipts
and no submission timestamp are counted separately as terminal history without a
recorded submission. This does not certify historical provider charges or prove
what an older binary sent. Submitted/unknown attempts still block even if their
run is terminal; no historical record is rewritten or resubmitted by the rehearsal.

1. Run `pnpm db:backup`: it publishes a manifest after a disposable restore and
   exhaustive encrypted-field/context validation. Retain the key separately.
2. Stage reviewed source. `pnpm recovery:rehearse` uses the exact index tree, rejects
   unreviewed tracked edits/private archive paths/symlinks, and requires the original
   DB on 5432 with no web/worker or unresolved work. This explicit owner-data operation
   is absent from normal CI/tests.
3. Create fresh checkout/home/dependency store/PG data under ignored `.local/recovery`
   with checked short paths to avoid Windows MSIX/long-path failures. Keep persistent
   receipts in the local application recovery directory. Install without lifecycle scripts; require
   unit/extraction checks. Start a separate SCRAM loopback PG cluster on 5433.
4. Verify archive size/SHA, restore in the separate cluster, compare migrations and
   authenticate every encrypted field. Hash retained public/drizzle/queue records,
   columns/defaults, constraints, indexes, triggers and RLS definitions with fixed
   UTC formatting and PostgreSQL's pretty constraint deparser, which preserves
   semantics while normalizing harmless dump/restore parentheses. Only worker
   leases are excluded. Bounds: 128 tables, 100,000
   rows/table and 256 MiB record text. This is not a full server-role/extension/
   sequence/function/hardware audit. Original and restored fingerprints must match.
5. Reconcile authenticated private receipts, copied origins, deletion audits and
   private queue targets. Missing/copied/deleted categories stay separate and never
   authorize dispatch. Later grant/deletion/publication/source changes make the
   retained-record comparison fail before cutover.
6. Start the replacement on actual port 3000 in recovery hold: API mutations return
   503; worker opens only a heartbeat without queue/schedule registration. UI says
   **Salt okunur kurtarma**. Require readiness, a refused POST and unchanged records.
7. Explicitly park created/retry/active restored jobs as cancelled; keep rows/payloads
   and all application receipts. This is not success or resend. Start normal clone
   registration with generation fenced; create/delete a synthetic local connection
   through the real API. Stop clone, then require all application/drizzle records
   equal the original. Only queue maintenance differences are allowed here.
8. Recheck the stopped original, start its runtime on 3000 and verify readiness and
   application equality. Never overwrite the original by restore. An encrypted
   receipt records index tree, archive/baseline hashes, parked count and phase times.

`DELIBERATION_RECOVERY_HOLD=true` blocks API writes and queue registration for that
runtime; it cannot freeze another process/direct SQL client.
`DELIBERATION_RECOVERY_FORBID_GENERATION=true` rejects council/private/probe generation
before adapter fetch. These are process settings without DDL. Catalog/connectivity
reads are distinct; the rehearsal performs neither on saved owner connections.

On failure there is no resend or speculative receipt repair. A replacement that
may contain later writes, or has an active runtime, stays for reconciliation. Keep
it isolated and review/export changes before forward recovery or rollback. Do not
restore an older backup over them. Successful unchanged generated targets are stopped
and removed only after resolved UUID/path checks; the encrypted receipt survives.

## Backup and export deletion

History deletion leaves backups/downloads. Archives contain encrypted records;
explicit private exports may contain plaintext. No automatic age-based deletion
is added. Keep the newest published backup pair, separate key and an independent
storage copy appropriate to recovery needs. External copies are outside this helper.

Create an ignored JSON request with a fresh actual UUID and exact selected paths:

```json
{
  "requestId": "00000000-0000-4000-8000-000000000001",
  "paths": ["C:/Users/OWNER/Downloads/deliberationai-report-00000000-0000-4000-8000-000000000002.json"]
}
```

`pnpm local-copies:preview <request.json>` returns names/sizes/fingerprint.
`pnpm local-copies:apply <request.json> <fingerprint>` applies that exact review.
Up to 20 selected inputs are supported. An old backup manifest includes its matching
dump; validate both pair SHA/size and the protected newest pair. Refuse dump-only/
newest selection, unrelated names, duplicate/changed files, symlinks/junctions, hard
links and redirected roots. App exports must sit directly in Downloads or the local
application exports directory; names support report/synthesis/conversation/private-
branch/candidates/evidence JSON/Markdown. Maximum 512 MiB/file; no recursive directory,
DB/key/source removal. No owner copy was selected/deleted by implementation tests.

An encrypted submitted receipt is flushed before unlinking, with recorded progress
and final state. Replay returns the prior outcome and cannot delete a replacement
file. Multi-file unlink is not atomic: interruption leaves partial/unknown outcome;
count is last acknowledged progress. Inspect the receipt, never automatically retry
with a new identity. Stop concurrent writers during review/apply. Unlink is not
secure erasure and cannot establish external/provider/snapshot removal; those
copies remain `unknown`.

## Operational counters and alerts

Settings retain council counters and separately show owned private pending/unknown,
copied historical receipts, decision work and uncertain generation probes. Queue
pending/active/oldest-due age is DB-wide, separate from owner operation totals. An
uninitialized queue is unavailable, never zero. Alerts cover worker/work mismatch,
unknown outcomes, disabled decision work, recovery hold, overdue queue, missing/stale
backups and slow diagnostics. Refresh is GET only and triggers no retry/provider call.

Backup count/size/date means metadata/file-size presence, not a new checksum,
decryption or restore. Query time is an instantaneous local read, not model latency,
uptime or a percentile. Inspection stops at 256 branches/32 MiB or 256 connections;
overflow fails instead of showing zero. Rehearsal timings stay in its encrypted
receipt. No spending limit or invoice total is inferred from output caps.

## Verification record

Completed 7 October 2026, 23:41 Istanbul, including the final launcher-guard repeat.
The fresh source backup `deliberation-20261007T203820Z-d7798f99a839.manifest.json` restores 434 runs,
7,457 encrypted rows, 12,005 authenticated values and 504 conversations.

- [x] Clean reviewed source/dependency installation and independent authenticated PG cluster.
- [x] Exact current/archive records, authenticated private origin/copy/deletion-audit reconciliation and unknown-outcome gates.
- [x] Real-port held cutover, explicitly parked clone jobs, operational API write/remove, verified rollback and protected failure cleanup.
- [x] Selected backup/export preview/apply, newest-pair protection, encrypted replay receipts and external-copy policy.
- [x] Managed runtime, separate operational counters and read-only alerts.

The successful rehearsal uses source index tree
`a8e77858cc4ffb39f646ab783146deb3caa3aa19`; final evidence documentation follows
without changing the verified production code. Initial Windows virtualized/long-path,
daemon pipe inheritance and equivalent CHECK formatting issues were corrected before
this successful run. Constraint changes and changed receipt bytes still fail closed.

Fresh install/unit/extraction: 76.123 s; independent PG: 7.192 s; authenticated restore
and exact state: 2.645 s; held actual-port cutover: 8.832 s; operational cutover:
9.330 s; rollback: 5.691 s. Phase totals are 109.813 s, excluding wrapper/cleanup;
they do not measure installation on a blank OS or a month of maintenance.
All 225 pending clone jobs were parked without resubmission; the original retains
its records and 225 pending DB queue jobs. These are separate from zero current
application work and the age warning remains visible. Provider calls: zero.

Encrypted receipt `5cfcb4be-ff0a-46f6-9105-dce8e4a3244f.receipt.enc` remains in the
local application recovery directory outside Git and was authenticated after the
run. The generated cluster/checkout/store were stopped/removed. At 23:41 Istanbul,
the original returns HTTP 200, DB/one worker are ready, recovery hold is off and
council/private/decision/probe pending/uncertain work and active schedules are zero.

418 unit cases/72 files, 262 isolated PostgreSQL cases/36 files, five final focused
DB cases and six generated-database browser cases pass. Typecheck, zero-warning lint,
separate-output production build and dependency audit pass. Only synthetic backup/
export files were deleted in cleanup tests; no owner history/copy, migration or
paid provider request was changed by this task.
