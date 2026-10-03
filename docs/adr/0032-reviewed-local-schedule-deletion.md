# ADR-0032: Reviewed local schedule-template deletion

Status: accepted and implemented, 3 October 2026.

Recurring templates previously used immediate physical deletion and advanced their cursor after enqueue in another transaction. That allowed a previously read active snapshot to enqueue after pause/deletion and freed creation identity on deletion.

Require explicit reviewed removal of a paused template. Retain an authenticated encrypted receipt and the existing paused row as a content-free tombstone. Use owner-scoped creation request identities for lost-response retries. Preserve independent run work and its accounting. Serialize mutation and dispatch on the owner lock and atomically enqueue run/job and advance the exact occurrence timestamp under a validated row fence.

Consequences: additive migration 0048; HTTP callers must provide a creation request UUID and use preview/confirmation rather than DELETE. Tombstone metadata and historical runs/backups remain; this does not cancel queued generation or establish universal erasure. Legacy creation identities remain unknown. Inspection rejects unsupported schema and bounded-history overflow. See [contract](../LOCAL_SCHEDULE_DELETION.md).
