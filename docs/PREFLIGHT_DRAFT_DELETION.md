# Reviewed preflight draft content deletion (DA-104)

The owner selects a pending clarification task and opens **Taslak silmeyi incele**. A read-only preview identifies the exact draft, whether its encrypted question/request remains, and any linked run. The owner acknowledges the retained records before **Taslak içeriğini kalıcı olarak sil**. Closing review preserves the unsaved clarification and the main question; confirmed deletion clears this panel's local clarification/revision state while preserving the separate main council draft.

## Removed and retained

Deletion sets both content ciphertexts to null and replaces the frozen clarification-question metadata with a strict, content-free receipt. Embedded attachment bytes, original member settings and context selections disappear with the encrypted request; independently stored memory/tool records and existing run inputs remain. A started or legacy-cancelled stub can also be reviewed through the API. A started run, its queue work, provenance, results and accounting are never cancelled or deleted by this operation.

The existing row remains as a tombstone: UUID, owner, original idempotency key, request hash, timestamps, cancelled status, run link and a bounded receipt (version, draft ID, reviewed fingerprint, deletion time, previous status and historical run ID). The receipt is plain metadata, not an encrypted usage audit or proof of physical erasure. No schema migration is required. Backup/export files and underlying database storage/WAL are outside this boundary. Restoring an older pre-deletion backup can restore content and its old intent state; restoring a post-deletion backup preserves the tombstone.

## Review, concurrency and replay

The SHA-256 fingerprint binds the exact PostgreSQL JSON row, including timestamp microseconds. Preview uses a bounded repeatable-read, read-only snapshot. Unknown column/type/FK/trigger changes, a missing owner-key unique index, invalid status, foreign linked-run ownership or a row larger than 24 MiB block new deletion. Apply caps lock waits at 5s and statements at 10s, takes the existing owner serialization lock before the draft table lock, repeats inspection and updates exactly one owned row atomically. Creation, cancellation and run enqueue share owner ordering. If start wins, the old deletion review becomes stale; if deletion wins, no resumed enqueue is allowed.

The BFF requires same-origin, a strict streamed 4 KiB body, matching path/body UUID, exact fingerprint and both acknowledgement flags. The old unreviewed DELETE route refuses with 409; internal legacy cancellation remains compatible. Normal draft reads hide tombstones; repeated matching POST confirmations return the same receipt. After a lost confirmed response, refreshing the deletion preview verifies the tombstone and clears the pending view. Ordinary run creation and selected-member rerun also reject a cancelled draft's original intent key, including legacy cancellations. Intentional new tasks with a new key remain possible.

The existing backup ciphertext inventory remains exhaustive, and restore inspection additionally validates tombstone metadata without printing content. No automatic pruning, paid provider request, external-copy erasure or complete-account deletion is introduced.
