# Local operational warnings

The settings diagnostics panel derives visible warnings from its existing read-only
snapshot. A non-ready worker with queued or running council work or active schedules
warns that work may not progress; a stored running state is not proof of execution.
Unknown council provider outcomes warn even with a healthy worker. The owner is
directed to inspect the operation in the relevant run; provider receipt is uncertain
and resending may produce another call/charge. Multiple live worker observations
keep their existing separate warning. Independent warnings are retained together.

Counts remain owner-scoped council operation/run counts from the existing endpoint.
The label and hint explicitly exclude private chats and decision evaluations; zero
does not certify that every application operation has a known outcome. Worker
heartbeat is a local observation, not provider connectivity or model health.
Refresh/polling only reads status and initiates no retry, job, model request or write.
Warnings disappear when a newly fetched snapshot no longer contains their condition.
Database/read failure retains the existing unreadable-state notice, not a zero count.

This is an initial bounded increment of the open Group 5 operational alerts task.
Historical metrics, recovery/cutover acceptance, provider checks, notifications and
private/decision operation monitoring remain open. No database/schema migration,
adapter admission, new task numbering or DA-126 human/model acceptance is introduced.

7 October validation: 396 unit cases / 63 files pass; four focused alert cases cover
idle states, stale running work, unknown outcomes and concurrent warning conditions.
Two real-browser cases cover the existing live diagnostics panel and synthetic stale/
unknown snapshots followed by recovery, with zero POST requests. Browser checks use
the already running 3000 app without spawning or stopping an additional worker.
Workspace/scripts typecheck, zero-warning lint, production build and full dependency
audit pass. Normal CI includes the four offline alert cases.
