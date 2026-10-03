# Reviewed local schedule-template deletion

DA-107, 3 October 2026. This is bounded deletion of one owned recurring template, not cancellation or deletion of its runs.

## Owner flow

Pause the schedule, open deletion review beneath its card, inspect retained runs and explicitly acknowledge content removal and retained work. Cancelling review preserves the template and the main council draft. Active schedules cannot be deleted. A stale review requires refresh and renewed acknowledgement. A lost successful response can be recovered by manually refreshing the review; matching POST confirmations return the same encrypted receipt.

GET `/api/local-schedules/[id]/deletion` is read-only and uncached. POST requires the matching UUID, exact fingerprint and both true acknowledgements in a strict, streamed 4 KiB body. Cross-origin mutation, oversized/mismatched bodies and unsupported schema are rejected. The old DELETE endpoint returns 409; there is no unreviewed production physical-delete helper.

## Retained identity and removed content

Migration `0048_lethal_mother_askani.sql` adds nullable creation request identity/hash, deletion timestamp and encrypted receipt, an owner/request unique index and a paired paused-tombstone constraint. Existing schedules remain intact; their unknown original creation identities are not invented or backfilled.

Deletion replaces authenticated encrypted name/question with empty strings and members with an empty array, and clears execution limits. Non-null encrypted columns stay authenticated. The paused row retains UUID, request identity/hash when known, cadence/provider/risk flags, timestamps, last-run pointer and the encrypted content-free receipt. Deleted rows disappear from lists and cannot reactivate. A matching old creation request cannot resurrect content. A new deliberately created request is a separate intent.

Web creation requires a UUID `requestId`. Identical payload retries reuse the browser's current creation identity after a lost response; changed payloads and successful/new actions receive another identity. Reloading does not persist the unsent retry identity. Trusted internal legacy callers may omit it and receive a new server identity, so that path cannot identify an original lost create request.

Independent queued/running/completed runs, their frozen question/configuration, results, accounting, operation receipts and conversation membership remain intact. Removing a recurring template does not stop previously queued work or provider calls. Local backups, WAL, exports and external copies remain; an older archive can restore older content. No forensic-erasure claim is made.

## Dispatch and inspection boundaries

Creation, status changes, reviewed deletion and occurrence enqueue serialize on the existing owner lock. Dispatch reads an exact PostgreSQL row snapshot and microsecond occurrence timestamp; enqueue rechecks the active undeleted row under a row lock. Run/job insertion and next-occurrence advancement occur in one transaction. A paused/deleted/changed snapshot does not enqueue, and cursor mismatch rolls the transaction back. Parallel dispatchers cannot enqueue the same occurrence twice. Risk/configuration failure pauses only the matching current snapshot.

Historical millisecond occurrence keys remain compatible; nonzero sub-millisecond precision is preserved. Public ordinary enqueue and selected-member rerun reject the reserved `schedule:` key namespace without the internal occurrence fence. Existing-run retries also check preflight/run tombstones before returning a retained run.

Review binds the exact row, owner and owned occurrence-run IDs, bounds a row at 1 MiB and inspects at most 1,001 run IDs; more than 1,000 prevents deletion. Column/type/nullability drift, unexpected incoming/outgoing FKs, custom triggers or missing valid owner/request uniqueness prevent deletion. Apply rechecks under owner/table locks with bounded waits. Previously deleted receipt replay validates authenticated empty payloads and receipt identity.

The backup auditor includes the new receipt ciphertext and semantic tombstone checks. It supports two explicit schema eras: all four DA-107 columns absent (legacy archive), or all present. Partial additions and any other unexpected encrypted-column inventory fail closed. A post-deletion synthetic custom archive was restored to a disposable database: receipt replay, hidden-list/no-dispatch behavior and original creation rejection passed. Primary owner data was never replaced or deleted by acceptance.

See [acceptance](DA107_ACCEPTANCE.md) and [ADR-0032](adr/0032-reviewed-local-schedule-deletion.md). Broader settings/council-template deletion, external copies, semantic fidelity and controlled human/live-provider acceptance remain separate work.
