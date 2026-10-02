# Run branch navigation — DA-092

DA-093 subsequently adds [durable run-based conversations and all-recorded-branch export](CONVERSATIONS.md). The immediate-link navigation contract below remains unchanged.

Opened results show previous sources, other runs from the same immediate source and direct children. Full-history continuation, reviewed compacted continuation and selected-member reruns have distinct labels. Opening a link loads saved details without changing the question, models or continuation draft and starts no generation. Missing sources are explicitly unavailable; sibling links still work after their shared source is deleted.

This is run navigation, without conversation identity, message storage, branch editing, model-private conversations or conversation-wide export. Single-run exports preserve existing delivery/archive semantics. Summary fidelity and real-provider acceptance remain unverified.

## Durable links and rollout

Migration `0042_volatile_luckman.sql` adds `runs.branch_source_run_id`, `branch_kind` and `branch_index_version`. Kinds are `independent`, `continuation-full`, `continuation-compacted` and `member-rerun`. New enqueue transactions store version 1 alongside authenticated source snapshots. A rerun uses its immediate rerun source, even if inherited continuation points further back. Replay preserves the existing link. No source foreign key or deletion cascade is added.

Existing rows default to version 0. Apply `pnpm db:migrate`, stop/restart old application/worker processes, then run `pnpm db:branches:index` with the normal database/encryption environment. The command authenticates existing continuation/rerun pointers in row-locked batches of at most 100. Only link metadata changes; reports, inputs, timestamps and jobs remain intact. A failed batch rolls back; earlier batches remain valid, and repeating resumes pending rows. Version-1 links are never overwritten. A restored backup with pending rows needs the same indexing command.

Navigation returns 503 while any owned row is pending, instead of showing an incomplete tree as complete. Corrupt snapshots fail indexing with a generic error and require separate recovery. Foreign-owner pending rows do not block the local owner.

## Read boundary

`GET /api/runs/:id/branches` reads one repeatable-read, read-only owner-scoped snapshot. Projected links are checked against authenticated encrypted provenance. Responses contain only run id, question, status, creation time and kind; raw outputs, private archives and credentials are excluded.

Ancestors are nearest-first, limited to 64. Longer chains are explicitly marked; opening the oldest visible source continues traversal. Cycles and mismatched indexes fail closed. Missing/foreign sources share an unavailable marker without exposing a foreign record. Independent runs are not siblings.

Siblings and direct children each use pages of 20 ordered by creation time and UUID descending. `siblingsBefore` and `childrenBefore` are owned UUID cursors belonging to the selected relationship; the current run cannot be its own sibling cursor. Invalid UUIDs return 400; unknown/wrong-branch cursors return 404. Request cancellation prevents stale pages entering another view. Pages are current snapshots, not frozen conversation exports.

## Verification

PostgreSQL tests cover enqueue/replay, full/compacted siblings, deleted sources, immediate rerun parents, tied-date pagination, owner/cursor boundaries, authenticated backfill, corrupt snapshots, index drift, long ancestry and cycles. Browser tests use a loopback mock and verify source/child navigation, unchanged drafts and no extra provider calls. Backup restore includes additive metadata and the unchanged encrypted-field inventory.
