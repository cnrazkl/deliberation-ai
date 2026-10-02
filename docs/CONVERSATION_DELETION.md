# Explicit empty-conversation metadata deletion — DA-095

**DA-101 extension:** owned private branch content can now be removed through its separate reviewed leaf-first policy. Any surviving private branch still blocks DA-095 metadata deletion. Content-free `private_branch_deletions` audit has logical conversation identifiers without FKs and remains after eligible identity deletion; this preserves usage/replay evidence and is not complete metadata/account erasure. [Policy](PRIVATE_BRANCH_DELETION.md). Earlier DA-095/096 private-body absence statements below describe those increments.

**DA-096 dependency extension:** the schema guard registers `conversation_private_branches` and its restrictive conversation FK. Any branch, including a zero-message copied seed, returns `private_branches` and blocks identity removal. Foreign private rows block too; another conversation's private source references are retained references. Apply also protects the private table against direct inserts. This extends the blocker, never the deletion target. Private bodies and backup/export copies remain retained. [Contract](PRIVATE_BRANCHES.md).

## Scope

`empty-conversation-deletion-v1` lets the local owner remove one conversation's identity and retained membership **only after every member run body is already absent**. A body row still counts as available when its report is null, incomplete, cancelled or unreadable. This feature does not delete run bodies, copied continuation/private archives, attachments, provider receipts, accounting, schedules or other conversations. Existing run-retention rules are unchanged.

Metadata is retained by default, with no automatic cleanup. The **Kayıtlı konuşmalar** library offers **Kayıt silmeyi incele** for metadata-only entries. The preview identifies the conversation, shows the membership count and bounded run IDs, and explains which copies remain. The owner reviews a checkbox and separately clicks **Konuşma kaydını kalıcı olarak sil**. Opening/cancelling/refreshing a preview writes nothing and sends no model request. The draft/model selections are preserved.

After deletion, the conversation and its retained memberships are unavailable to discovery/detail/export. This intentionally removes those historical grouping pointers; it does not claim that the corresponding content has been erased from every copy. Existing database backups and downloaded JSON files remain unchanged, and restoring/importing older copies can bring the metadata back. Backup/export file deletion, full-account erasure, model-private message deletion and deletion of conversations with retained bodies are separate policy work.

## Eligibility and reviewed snapshot

Preview uses an owner-scoped read-only repeatable-read transaction. Deletion is blocked when:

- Any selected membership still has an owned run body, or the anchor itself still has a body.
- Any private draft branch belongs to the selected conversation, regardless of message count or source-body availability.
- Owned run/conversation indexing is incomplete.
- Membership/body ownership is inconsistent.
- A retained owned run or another conversation's membership references the selected member IDs or anchor. Unavailable external memberships also count.
- More than 1,000 selected owned membership rows exist. An oversized preview does not expose a partial membership list.
- The reviewed metadata schema changed: unexpected columns/types, foreign-key dependencies or noninternal triggers on either metadata table require a new policy. Declared FK dependencies for future message/branch tables block deletion. Future aggregates must register logical references in this policy; the catalog checks do not infer arbitrary logical references elsewhere.

Eligible previews carry a SHA-256 fingerprint of the version, owner, conversation identity/anchor/origin/exact creation timestamp and sorted complete memberships including exact PostgreSQL timestamps, source IDs and kinds. The fingerprint is a state-binding guard, not authentication or a reusable permission to delete other conversations.

Apply acquires the existing conversation owner lock before table locks, serializing enqueue/backfill/deletion in the established order. It locks the metadata tables and protects run-body/reference absence, repeats schema/eligibility/snapshot checks in the same transaction, deletes exactly the reviewed owned memberships and then the single owned conversation. Count mismatch or any failure rolls back. No cascade deletion is introduced. Table locks can briefly delay concurrent writes; local lock waits are capped at five seconds and SQL statements at ten seconds. A timeout fails the transaction; it does not authorize a retry or a broader deletion.

A changed eligible snapshot requires new review. A newly ineligible target is preserved. Concurrent confirmed deletes yield one successful removal; later requests report unavailable rather than affecting another identity. If a response is lost after commit, refreshing the library/preview establishes the current state; no automatic repeat is sent.

## API

- `GET /api/conversations/:id/deletion`: current preview; absent/foreign/invalid identity returns 404. `fingerprint` is null when blocked.
- `POST /api/conversations/:id/deletion`: strict JSON `{ conversationId, fingerprint, confirmMetadataDeletion: true }`; the body identity must match the path. Same-origin mutation checks apply. The actual streamed confirmation is bounded to 4 KiB. Invalid confirmation returns 422, oversized body 413, blocked/stale snapshot 409, unavailable target 404. Success returns the identity and deleted membership count. All responses use `no-store`.

This remains under the existing loopback/single-owner application boundary. It is not public multi-user authentication, a provider action or a model quality gate. No credential/question/report/archive body is loaded or logged by preview/apply.

## Verification

Eight isolated PostgreSQL regressions cover read-only preview, exact deletion scope, unreadable retained bodies, ownership, sub-millisecond stale snapshots, incomplete grouping, retained external links, concurrent deletion/membership writes, the 1,000-member cap and schema/trigger drift. Drift fixtures are confined to the generated isolated database. Two browser flows cover actual generated-metadata deletion, strict/origin/size/stale guards, explicit review/cancel/retry, blocked previews, preserved draft and zero generation. No real owner conversation was deleted during acceptance.

No migration, ciphertext inventory, provider prompt or dispatch change is required. Backup restoration is not repeated for this unchanged schema; old copies retain the state they captured. [ADR](adr/0025-empty-conversation-metadata-deletion.md).

Primary acceptance on 2 October 2026 passed 252 unit / 135 isolated PostgreSQL / 19 browser tests, type checking, lint and a separate-output production build. [Evidence](DA095_ACCEPTANCE.md).
